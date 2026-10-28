import {
  BUILTIN_TOOLS,
  MAX_SPEAK_CHARS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  presetById,
  presetWorkflow,
  type RunResult,
  type Workflow,
} from '@morph/core';

import type { PackPageId, PackRuntime } from '../packs/bridge';
import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import {
  FakeFiles,
  FakeMedia,
  FakeSpeaker,
  FakeTranslator,
  makePdf,
} from '../test-utils/fake-files';

// 文字转语音（D-268）：系统朗读换成 FakeSpeaker（每个字 0.1 秒，写一个 24 kHz 单声道 WAV），
// 转 M4A 换成 FakeMedia。检查分段、选声音、语速、格式、错误说明、取消和预设快捷操作。

const registry = createRegistry(BUILTIN_TOOLS);

function toolWorkflow(id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId: 'audio' }], {
    registry,
    locale: 'zh',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

/** 选 PDF → 提取文字 → 朗读：手打的文字最多 5000 字，长文字从 PDF 来。 */
const fromPdf: Workflow = {
  id: 'pdf-speak',
  name: 'PDF speak',
  steps: [
    { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
    { id: 'extract', action: 'pdf.extractText', params: {} },
    { id: 'run', action: 'audio.fromText', params: { lang: 'auto', rate: 1, format: 'm4a' } },
  ],
};

const typed = (params: Record<string, unknown> = {}): Workflow => ({
  id: 'speak',
  name: 'Speak',
  steps: [
    { id: 'type', action: 'in.text', params: { text: '' }, ask: ['text'] },
    {
      id: 'run',
      action: 'audio.fromText',
      params: { lang: 'auto', rate: 1, format: 'm4a', ...params },
    },
  ],
});

class PdfTextPack implements PackRuntime {
  pages: string[] = [];
  async call<T>(_page: PackPageId, method: string): Promise<T> {
    if (method === 'text') return { pages: this.pages } as T;
    throw new Error(`unknown ${method}`);
  }
}

let ids = 0;
function setup(
  workflow: Workflow,
  text = '',
  opts: { translator?: boolean; speaker?: boolean; locale?: 'zh' | 'en' | 'fr' } = {},
) {
  const files = new FakeFiles();
  const media = files.media as FakeMedia;
  const speaker = new FakeSpeaker(files);
  if (opts.speaker !== false) files.speaker = speaker;
  const translator = new FakeTranslator();
  if (opts.translator) files.translator = translator;
  const packs = new PdfTextPack();
  const signal = { cancelled: false };
  const ui: LocalUi = {
    confirm: async () => true,
    choose: async () => null,
    open: async () => null as never,
  };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: opts.locale ?? 'zh',
        now: () => new Date(2026, 9, 28),
        newId: () => `id${++ids}`,
        ui,
        signal,
        packs: { runtime: packs, isInstalled: async () => true },
        ensurePack: async () => true,
        askParams: async (request) =>
          Object.fromEntries(request.keys.map((k) => [k, k === 'text' ? text : request.params[k]])),
      })
    ).result;
  return { files, media, speaker, translator, packs, signal, run };
}

/** 文字从一个 PDF 里来（选 PDF → 提取文字 → 朗读）。 */
async function withPdf(text: string) {
  const env = setup(fromPdf);
  env.packs.pages = [text];
  env.files.nextPick = [env.files.offer('book.pdf', await makePdf(1))];
  return env;
}

function audioOf(result: RunResult) {
  if (result.status !== 'succeeded' || result.value?.type !== 'audio') {
    throw new Error(`no audio: ${JSON.stringify(result)}`);
  }
  return result.value.items;
}

const failure = (result: RunResult) =>
  result.status === 'failed' ? { code: result.error.code, detail: result.error.detail } : result;

/** 「不支持这个步骤：…」里拼进去的说明。 */
const actionText = (result: ReturnType<typeof failure>) =>
  'detail' in result ? String(result.detail.action) : '';

describe('audio.fromText', () => {
  it('reads Chinese text with a Chinese voice and gives one M4A, made from the WAV', async () => {
    const { speaker, media, run } = setup(typed(), '明天下午三点在三楼开会。\n\n请带上笔记本。');
    const items = audioOf(await run());
    expect(speaker.calls).toHaveLength(1);
    expect(speaker.calls[0]).toMatchObject({
      segments: ['明天下午三点在三楼开会。\n\n请带上笔记本。'],
      voice: 'zh-CN',
      rate: 1,
    });
    expect(speaker.calls[0]!.relPath).toMatch(/\.wav$/);
    // 转 M4A 的是刚读出来的 WAV：单声道，人声的码率。
    expect(media.audioEncodes).toHaveLength(1);
    expect(media.audioEncodes[0]).toMatchObject({ format: 'm4a', channels: 1 });
    expect(media.audioEncodes[0]!.uri).toMatch(/\.wav$/);
    expect(media.audioEncodes[0]!.bitrateKbps).toBeLessThanOrEqual(96);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ext: 'm4a', mimeType: 'audio/mp4' });
    // FakeSpeaker 每个字 0.1 秒（段落之间的空行也算）。
    expect(items[0]!.durationMs).toBe(speaker.calls[0]!.segments.join('').length * 100);
  });

  it('keeps the WAV when WAV is chosen, without re-encoding', async () => {
    const { media, run } = setup(typed({ format: 'wav' }), 'Hello there.');
    const items = audioOf(await run());
    expect(media.audioEncodes).toHaveLength(0);
    expect(items[0]).toMatchObject({ ext: 'wav', mimeType: 'audio/wav' });
  });

  it('uses the chosen language and speed', async () => {
    const { speaker, run } = setup(typed({ lang: 'ja', rate: 0.8 }), 'こんにちは。');
    audioOf(await run());
    expect(speaker.calls[0]).toMatchObject({ voice: 'ja-JP', rate: 0.8 });
  });

  it('auto-detects with the system language recognizer when it has one', async () => {
    const { speaker, translator, run } = setup(typed(), 'The meeting moved to Friday.', {
      translator: true,
    });
    audioOf(await run());
    expect(translator.calls.map((c) => c.method)).toEqual(['detectLanguages']);
    expect(speaker.calls[0]!.voice).toBe('en-US');
  });

  it('falls back to the writing system when nothing detects the language', async () => {
    const { speaker, run } = setup(typed(), 'Привет! Как дела?');
    audioOf(await run());
    expect(speaker.calls[0]!.voice).toBe('ru-RU');
  });

  it('splits a long text into segments the system can read', async () => {
    const text = '这是很长的一章里的一句话，用来测试分段。'.repeat(300);
    const { speaker, run } = await withPdf(text);
    audioOf(await run());
    const { segments } = speaker.calls[0]!;
    expect(segments.length).toBeGreaterThan(5);
    for (const s of segments) expect(s.length).toBeLessThanOrEqual(1000);
    expect(segments.join('').replace(/\s/g, '')).toBe(text);
  });

  it('explains a missing voice in the user’s language', async () => {
    const { speaker, run } = setup(typed({ lang: 'th' }), 'สวัสดี');
    speaker.statuses['th-TH'] = 'unsupported';
    const result = failure(await run());
    expect(result).toMatchObject({ code: 'unsupportedAction' });
    expect(actionText(result)).toContain('泰文');
    expect(speaker.calls).toHaveLength(0);
  });

  it('says to download the voice in system settings on Android, instead of downloading it', async () => {
    const { speaker, run } = setup(typed({ lang: 'de' }), 'Guten Tag.', { locale: 'en' });
    speaker.statuses['de-DE'] = 'notDownloaded';
    const result = failure(await run());
    expect(result).toMatchObject({ code: 'unsupportedAction' });
    expect(actionText(result)).toMatch(/German.*Text-to-speech output/);
  });

  it('says when the phone has no text-to-speech engine', async () => {
    // 法语界面：认不出的拉丁字母文字按法文读。
    const { speaker, run } = setup(typed(), 'Bonjour.', { locale: 'fr' });
    speaker.statuses['fr-FR'] = 'noEngine';
    const result = failure(await run());
    expect(actionText(result)).toMatch(/moteur de synthèse/);
  });

  it.each([
    ['noVoice', 'unsupportedAction'],
    ['notDownloaded', 'unsupportedAction'],
    ['unavailable', 'unsupportedAction'],
    ['failed', 'unexpected'],
  ] as const)('a %s error from the system becomes %s', async (code, expected) => {
    const { speaker, run } = setup(typed(), 'Hello.');
    speaker.failWith = code;
    expect(failure(await run())).toMatchObject({ code: expected });
  });

  it('stops when the user taps Stop while it reads', async () => {
    const { speaker, media, signal, run } = setup(typed(), '第一段。\n\n第二段。');
    const original = speaker.synthesize.bind(speaker);
    speaker.synthesize = (segments, request) => {
      signal.cancelled = true;
      return original(segments, request);
    };
    expect((await run()).status).toBe('cancelled');
    expect(media.audioEncodes).toHaveLength(0);
  });

  it('refuses empty text, symbols only and text that is too long', async () => {
    expect(failure(await setup(typed(), '   ').run())).toMatchObject({ code: 'emptyText' });
    expect(failure(await setup(typed(), '— * —').run())).toMatchObject({ code: 'emptyText' });
    const long = await withPdf('a '.repeat(MAX_SPEAK_CHARS / 2 + 1));
    expect(failure(await long.run())).toMatchObject({
      code: 'textTooLong',
      detail: { max: MAX_SPEAK_CHARS },
    });
  });

  it('needs the full app (no native module in Expo Go)', async () => {
    const { run } = setup(typed(), 'Hello.', { speaker: false });
    expect(failure(await run())).toMatchObject({ code: 'needsFullApp' });
  });

  it('checks free space before reading', async () => {
    const { files, speaker, run } = await withPdf('很长的一段话。'.repeat(1000));
    files.freeBytes = 1024 * 1024;
    expect(failure(await run())).toMatchObject({ code: 'notEnoughSpace' });
    expect(speaker.calls).toHaveLength(0);
  });

  it('can be followed by Convert audio (M4A to MP3)', async () => {
    const workflow = typed();
    workflow.steps.push({ id: 'mp3', action: 'audio.convert', params: { format: 'mp3' } });
    const { run } = setup(workflow, 'Hello there.');
    expect(audioOf(await run())[0]).toMatchObject({ ext: 'mp3' });
  });
});

describe('text to speech quick actions', () => {
  it('the audio tool has a Text to speech quick action that asks for the text', async () => {
    const { speaker, run } = setup(toolWorkflow('audio-from-text'), '你好。');
    expect(audioOf(await run())[0]).toMatchObject({ ext: 'm4a' });
    expect(speaker.calls[0]!.voice).toBe('zh-CN');
  });

  it('PDF to audio reads the PDF’s text and shares one M4A named after the PDF', async () => {
    const preset = presetWorkflow(presetById('pdf-to-audio')!, 'zh', 'pdf-to-audio');
    const { files, packs, speaker, run } = setup(preset);
    packs.pages = ['Chapter one', 'It was a bright cold day in April.'];
    files.nextPick = [files.offer('novel.pdf', await makePdf(2))];
    const items = audioOf(await run());
    expect(speaker.calls[0]!.voice).toBe('en-US');
    expect(speaker.calls[0]!.segments.join('\n')).toContain('bright cold day');
    expect(items).toEqual([expect.objectContaining({ name: 'novel', ext: 'm4a' })]);
    expect(files.shared).toHaveLength(1);
  });
});
