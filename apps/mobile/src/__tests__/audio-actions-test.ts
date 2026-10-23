import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  presetById,
  presetWorkflow,
  type AskRequest,
  type RunResult,
  type Workflow,
} from '@morph/core';

import type { LocalKind, LocalUi } from '../runtime/local';
import type { PickedFile } from '../runtime/platform';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeMedia, FakeSpeech } from '../test-utils/fake-files';

// 音频工具（D-150–D-156）：录音和选音频、压到指定大小 / 音质、转格式、剪一段、合成一段、取视频的声音、
// 语音转文字。原生模块 morph-media 换成 FakeMedia（按码率和时长算出大小），morph-speech 换成 FakeSpeech。

const registry = createRegistry(BUILTIN_TOOLS);
const MB = 1024 * 1024;
const minutes = (n: number) => n * 60_000;

function toolWorkflow(id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId: 'audio' }], {
    registry,
    locale: 'zh',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

const preset = (id: string) => presetWorkflow(presetById(id)!, 'zh', id);

let ids = 0;
function setup(
  workflow: Workflow,
  opts: {
    answers?: Record<string, unknown>;
    trim?: { startMs: number; endMs: number }[] | null;
    recorded?: PickedFile | null;
    confirm?: boolean;
    incoming?: PickedFile[];
  } = {},
) {
  const files = new FakeFiles();
  const media = files.media as FakeMedia;
  const opened: { kind: LocalKind; input: unknown }[] = [];
  const confirms: string[] = [];
  const packs: string[] = [];
  const ui: LocalUi = {
    confirm: async (title) => {
      confirms.push(title);
      return opts.confirm ?? false;
    },
    choose: async () => null,
    open: async (kind, input) => {
      opened.push({ kind, input });
      if (kind === 'record') return (opts.recorded ?? null) as never;
      // 排顺序：保持原来的顺序。
      if (kind === 'reorder')
        return (input as { items: unknown[] }).items.map((_, i) => i) as never;
      return (opts.trim ?? null) as never;
    },
  };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 23, 9, 5),
        newId: () => `id${++ids}`,
        ui,
        // 只回答这一步问到的参数。
        askParams: async (request: AskRequest) => ({
          ...request.params,
          ...Object.fromEntries(
            Object.entries(opts.answers ?? {}).filter(([k]) => request.keys.includes(k)),
          ),
        }),
        ensurePack: async (id) => {
          packs.push(id);
          return true;
        },
        ...(opts.incoming ? { incoming: opts.incoming } : {}),
      })
    ).result;
  return { files, media, run, opened, confirms, packs };
}

function audioOf(result: RunResult) {
  if (result.status !== 'succeeded' || result.value?.type !== 'audio') {
    throw new Error(`no audio: ${JSON.stringify(result)}`);
  }
  return result.value.items;
}

function textOf(result: RunResult) {
  if (result.status !== 'succeeded' || result.value?.type !== 'text') {
    throw new Error(`no text: ${JSON.stringify(result)}`);
  }
  return result.value.text;
}

const failure = (result: RunResult) =>
  result.status === 'failed' ? { code: result.error.code, detail: result.error.detail } : result;

describe('audio tool', () => {
  it('installs seven quick actions and an audio file list', () => {
    const result = applyOps(
      createDefaultWorkspace('zh'),
      [{ op: 'installTool', toolId: 'audio' }],
      {
        registry,
        locale: 'zh',
      },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.config.workflows.map((w) => w.name)).toEqual([
      '语音转文字',
      '录音',
      '压小音频',
      '音频转格式',
      '剪一段音频',
      '几段合成一段',
      '提取视频里的声音',
    ]);
    const page = result.config.pages.find((p) => p.id === 'tool-audio')!;
    expect(page.components.find((c) => c.type === 'fileList')?.props).toMatchObject({
      mimeType: 'audio/*',
    });
  });

  it('picks recordings from Files without copying them', async () => {
    const { files, run } = setup(toolWorkflow('audio-compress'), { answers: { maxMB: 50 } });
    files.nextPick = [files.offerAudio('会议.m4a', { size: 3 * MB })];
    const [item] = audioOf(await run());
    expect(files.lastPickTypes).toEqual(['audio/*']);
    expect(files.adopted).toEqual(['picker://会议.m4a']);
    expect(item).toMatchObject({ name: '会议', ext: 'm4a', mimeType: 'audio/mp4', size: 3 * MB });
  });

  it('rejects files that are not audio', async () => {
    const { files, run } = setup(toolWorkflow('audio-compress'));
    files.nextPick = [files.offer('a.pdf', new Uint8Array(10))];
    expect(failure(await run())).toMatchObject({ code: 'wrongType', detail: { kind: 'audio' } });
  });

  it('records with the recording screen and names the recording with the date', async () => {
    const files0 = new FakeFiles();
    const recorded = files0.offerAudio('rec.m4a', { size: 2 * MB, durationMs: minutes(3) });
    const { files, opened, run } = setup(toolWorkflow('audio-record'), { recorded });
    files.disk = files0.disk;
    files.videos = files0.videos;
    const [item] = audioOf(await run());
    expect(opened).toEqual([{ kind: 'record', input: { name: '录音 2026-10-23_09.05' } }]);
    expect(item).toMatchObject({ name: 'rec', ext: 'm4a', durationMs: minutes(3) });
  });

  it('closing the recording screen cancels the run', async () => {
    const { run } = setup(toolWorkflow('audio-record'), { recorded: null });
    expect((await run()).status).toBe('cancelled');
  });

  it('a shared recording fills the first step instead of the recorder', async () => {
    const files0 = new FakeFiles();
    const shared = files0.offerAudio('语音备忘录.m4a', { size: 1 * MB });
    const { files, opened, run } = setup(preset('voice-memo-archive'), { incoming: [shared] });
    files.disk = files0.disk;
    files.videos = files0.videos;
    const result = await run();
    expect(result.status).toBe('succeeded');
    expect(opened.filter((o) => o.kind === 'record')).toEqual([]);
    expect(audioOf(result)[0]!.name).toBe('语音备忘 2026-10-23_09.05');
  });

  it('compresses to at most 2 MB as M4A, mono when the bitrate is low', async () => {
    const { files, media, run } = setup(toolWorkflow('audio-compress'));
    files.nextPick = [
      files.offerAudio('lecture.wav', { size: 100 * MB, durationMs: minutes(10) }, 'audio/wav'),
    ];
    const [item] = audioOf(await run());
    expect(item).toMatchObject({ name: 'lecture', ext: 'm4a', mimeType: 'audio/mp4' });
    expect(item!.size).toBeLessThanOrEqual(2 * MB);
    expect(media.audioEncodes[0]).toMatchObject({ format: 'm4a', channels: 1, sampleRate: 22050 });
  });

  it('compresses again when the encoder overshoots, keeps small files, and says when the target is too small', async () => {
    const over = setup(toolWorkflow('audio-compress'), { answers: { maxMB: 5 } });
    over.media.oversize = 1.1;
    over.files.nextPick = [
      over.files.offerAudio('big.wav', { size: 100 * MB, durationMs: minutes(10) }, 'audio/wav'),
      over.files.offerAudio('small.m4a', { size: 1 * MB }),
    ];
    const [big, small] = audioOf(await over.run());
    expect(over.media.audioEncodes).toHaveLength(2);
    expect(over.media.audioEncodes[1]!.bitrateKbps).toBeLessThan(
      over.media.audioEncodes[0]!.bitrateKbps,
    );
    expect(big!.size).toBeLessThanOrEqual(5 * MB);
    expect(small).toMatchObject({ name: 'small', size: 1 * MB });

    const tiny = setup(toolWorkflow('audio-compress'));
    tiny.files.nextPick = [
      tiny.files.offerAudio('long.m4a', { size: 60 * MB, durationMs: minutes(60) }),
    ];
    expect(failure(await tiny.run())).toMatchObject({
      code: 'audioTooSmall',
      detail: { name: 'long.m4a', target: '2 MB', mb: 11 },
    });
    expect(tiny.media.audioEncodes).toEqual([]);
  });

  it('compresses by quality', async () => {
    const { files, media, run } = setup(toolWorkflow('audio-compress'), {
      answers: { by: 'quality', quality: 'voice' },
    });
    files.nextPick = [files.offerAudio('a.m4a', { size: 10 * MB, audioBitrateKbps: 256 })];
    audioOf(await run());
    expect(media.audioEncodes[0]).toMatchObject({ bitrateKbps: 48, channels: 1 });
  });

  it('converts to WAV and leaves M4A files that are already AAC alone', async () => {
    const wav = setup(toolWorkflow('audio-convert'), { answers: { format: 'wav' } });
    wav.files.nextPick = [
      wav.files.offerAudio('a.mp3', { size: 1 * MB, channels: 1, sampleRate: 48000 }, 'audio/mpeg'),
    ];
    expect(audioOf(await wav.run())[0]).toMatchObject({ ext: 'wav', mimeType: 'audio/wav' });
    expect(wav.media.audioEncodes[0]).toMatchObject({
      format: 'wav',
      channels: 1,
      sampleRate: 48000,
    });

    const m4a = setup(toolWorkflow('audio-convert'));
    m4a.files.nextPick = [m4a.files.offerAudio('b.m4a', { size: 1 * MB, audioCodec: 'aac' })];
    expect(audioOf(await m4a.run())[0]).toMatchObject({ ext: 'm4a', size: 1 * MB });
    expect(m4a.media.audioEncodes).toEqual([]);
  });

  it('trims on the waveform and re-encodes only the chosen part', async () => {
    const { files, media, run, opened } = setup(toolWorkflow('audio-trim'), {
      trim: [{ startMs: 10_000, endMs: 40_000 }],
    });
    files.nextPick = [files.offerAudio('song.mp3', { size: 5 * MB }, 'audio/mpeg')];
    const [item] = audioOf(await run());
    const input = opened[0]!.input as {
      items: { durationMs: number }[];
      loadWaveform: (i: number) => Promise<number[] | null>;
    };
    expect(opened[0]!.kind).toBe('trimMedia');
    expect(input.items[0]!.durationMs).toBe(60_000);
    expect(await input.loadWaveform(0)).toHaveLength(120);
    expect(media.audioEncodes[0]).toMatchObject({
      format: 'm4a',
      range: { startMs: 10_000, endMs: 40_000 },
    });
    expect(item).toMatchObject({ name: 'song', ext: 'm4a', durationMs: 30_000 });
  });

  it('keeps the whole recording when nothing is cut; no waveform is fine', async () => {
    const { files, media, run, opened } = setup(toolWorkflow('audio-trim'), {
      trim: [{ startMs: 0, endMs: 60_000 }],
    });
    media.peaks = null;
    files.nextPick = [files.offerAudio('a.m4a', { size: 1 * MB })];
    expect(audioOf(await run())[0]).toMatchObject({ size: 1 * MB });
    const input = opened[0]!.input as { loadWaveform: (i: number) => Promise<unknown> };
    expect(await input.loadWaveform(0)).toBeNull();
    expect(media.audioEncodes).toEqual([]);
  });

  it('joins recordings in order into one M4A', async () => {
    const { files, media, run } = setup(toolWorkflow('audio-merge'));
    files.nextPick = [
      files.offerAudio('第一段.m4a', {
        size: 1 * MB,
        durationMs: minutes(1),
        channels: 1,
        audioBitrateKbps: 64,
      }),
      files.offerAudio('第二段.m4a', {
        size: 2 * MB,
        durationMs: minutes(2),
        channels: 1,
        audioBitrateKbps: 64,
      }),
    ];
    const items = audioOf(await run());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: '第一段 等 1 段', ext: 'm4a', durationMs: minutes(3) });
    expect(media.concats[0]!.uris.map((u) => u.split('/').pop())).toEqual([
      expect.stringContaining('第一段'),
      expect.stringContaining('第二段'),
    ]);
    expect(media.concats[0]!.settings).toMatchObject({ format: 'm4a', channels: 1 });
  });

  it('keeps the sound of a video, and says when a video has none', async () => {
    const ok = setup(toolWorkflow('audio-from-video'));
    ok.files.nextVideos = [
      ok.files.offerVideo('trip.mov', { size: 80 * MB, audioBitrateKbps: 256 }),
    ];
    expect(audioOf(await ok.run())[0]).toMatchObject({
      name: 'trip',
      ext: 'm4a',
      mimeType: 'audio/mp4',
    });
    expect(ok.media.audioEncodes[0]).toMatchObject({
      format: 'm4a',
      bitrateKbps: 192,
      channels: 2,
    });

    const silent = setup(toolWorkflow('audio-from-video'));
    silent.files.nextVideos = [
      silent.files.offerVideo('screen.mp4', { size: 10 * MB, hasAudio: false }, 'video/mp4'),
    ];
    expect(failure(await silent.run())).toMatchObject({
      code: 'noAudio',
      detail: { name: 'screen.mp4' },
    });
  });

  it('says audio needs the full app in Expo Go', async () => {
    const { files, run } = setup(toolWorkflow('audio-compress'));
    files.nextPick = [files.offerAudio('a.m4a', { size: 10 * MB })];
    files.media = null;
    expect(failure(await run())).toMatchObject({ code: 'needsFullApp' });
  });
});

describe('speech to text', () => {
  function transcribe(
    opts: Parameters<typeof setup>[1] = {},
    engine: 'system' | 'whisper' = 'whisper',
  ) {
    const s = setup(toolWorkflow('audio-transcribe'), opts);
    const speech = new FakeSpeech();
    speech.engine = engine;
    s.files.speech = speech;
    return { ...s, speech };
  }

  it('Android: downloads the whisper model first, then turns the recording into text', async () => {
    const { files, speech, run, packs } = transcribe();
    speech.texts = ['明天上午九点开会。'];
    files.nextPick = [files.offerAudio('会议.m4a', { size: 1 * MB })];
    expect(textOf(await run())).toBe('明天上午九点开会。');
    expect(packs).toEqual(['speech-whisper-small']);
    expect(speech.calls).toEqual([
      { uri: expect.stringContaining('会议.m4a'), language: 'zh', model: 'standard' },
    ]);
  });

  it('the faster model downloads the smaller pack', async () => {
    const wf = toolWorkflow('audio-transcribe');
    const fast: Workflow = {
      ...wf,
      steps: wf.steps.map((st) =>
        st.action === 'audio.transcribe' ? { ...st, params: { ...st.params, model: 'fast' } } : st,
      ),
    };
    const s = setup(fast);
    const speech = new FakeSpeech();
    speech.texts = ['好'];
    s.files.speech = speech;
    s.files.nextPick = [s.files.offerAudio('a.m4a', { size: 1 * MB })];
    textOf(await s.run());
    expect(s.packs).toEqual(['speech-whisper-base']);
    expect(speech.calls[0]!.model).toBe('fast');
  });

  it('iPhone: no download pack, but asks before the system downloads a language', async () => {
    const declined = transcribe({ confirm: false }, 'system');
    declined.speech.needs = { kind: 'systemDownload' };
    declined.files.nextPick = [declined.files.offerAudio('a.m4a', { size: 1 * MB })];
    expect((await declined.run()).status).toBe('cancelled');
    expect(declined.confirms).toEqual(['第一次识别普通话（简体）需要先下载']);
    expect(declined.packs).toEqual([]);

    const accepted = transcribe({ confirm: true }, 'system');
    accepted.speech.needs = { kind: 'systemDownload' };
    accepted.speech.texts = ['你好'];
    accepted.files.nextPick = [accepted.files.offerAudio('a.m4a', { size: 1 * MB })];
    expect(textOf(await accepted.run())).toBe('你好');
    expect(accepted.speech.prepared).toEqual(['zh']);
  });

  it('labels each recording when there are several, and skips silent ones', async () => {
    const { files, speech, run } = transcribe();
    speech.texts = ['第一段的内容', '', '第三段的内容'];
    files.nextPick = [
      files.offerAudio('一.m4a', { size: 1 }),
      files.offerAudio('二.m4a', { size: 1 }),
      files.offerAudio('三.m4a', { size: 1 }),
    ];
    expect(textOf(await run())).toBe('【一.m4a】\n第一段的内容\n\n【三.m4a】\n第三段的内容');
  });

  it('explains what went wrong', async () => {
    const silent = transcribe();
    silent.files.nextPick = [silent.files.offerAudio('静音.m4a', { size: 1 })];
    expect(failure(await silent.run())).toMatchObject({
      code: 'noSpeech',
      detail: { name: '静音.m4a' },
    });

    const sim = transcribe({}, 'system');
    sim.speech.error = 'unavailable';
    sim.files.nextPick = [sim.files.offerAudio('a.m4a', { size: 1 })];
    expect(failure(await sim.run())).toMatchObject({
      code: 'unsupportedAction',
      detail: { action: expect.stringContaining('不能在本机做语音识别') },
    });

    const lang = transcribe({ answers: { lang: 'vi' } }, 'system');
    lang.speech.needs = { kind: 'unsupported' };
    lang.files.nextPick = [lang.files.offerAudio('a.m4a', { size: 1 })];
    expect(failure(await lang.run())).toMatchObject({
      detail: { action: '这台手机不能在本机识别越南语。' },
    });

    const expoGo = setup(toolWorkflow('audio-transcribe'));
    expoGo.files.nextPick = [expoGo.files.offerAudio('a.m4a', { size: 1 })];
    expect(failure(await expoGo.run())).toMatchObject({ code: 'needsFullApp' });
    expect(expoGo.packs).toEqual([]);
  });

  it('the recording-to-text preset ends in a shared PDF', async () => {
    const files0 = new FakeFiles();
    const recorded = files0.offerAudio('rec.m4a', { size: 1 * MB });
    const s = setup(preset('audio-to-text'), { recorded });
    s.files.disk = files0.disk;
    s.files.videos = files0.videos;
    const speech = new FakeSpeech();
    speech.texts = ['今天讲光合作用。'];
    s.files.speech = speech;
    const result = await s.run();
    expect(result.status).toBe('succeeded');
    expect(result.status === 'succeeded' && result.value?.type).toBe('pdf');
    expect(s.files.shared).toHaveLength(1);
  });
});
