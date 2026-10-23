import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  presetWorkflow,
  presetById,
  type AskRequest,
  type RunResult,
  type Workflow,
} from '@morph/core';

import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeMedia } from '../test-utils/fake-files';

// 视频工具（D-140–D-143）：选视频不复制、压到指定大小 / 画质、转成 MP4、剪一段，以及出错的说法。
// 原生模块 morph-media 换成 FakeMedia：按码率和时长算出输出大小。

const registry = createRegistry(BUILTIN_TOOLS);
const MB = 1024 * 1024;

function toolWorkflow(id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId: 'video' }], {
    registry,
    locale: 'zh',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

let ids = 0;
function setup(
  workflow: Workflow,
  opts: {
    answers?: Record<string, unknown>;
    trim?: { startMs: number; endMs: number }[] | null;
    signal?: { cancelled: boolean };
  } = {},
) {
  const files = new FakeFiles();
  const media = files.media as FakeMedia;
  const opened: { kind: LocalKind; input: unknown }[] = [];
  const progress: { done: number; total: number; unit?: string }[] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (kind, input) => {
      opened.push({ kind, input });
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
        now: () => new Date(2026, 9, 23),
        newId: () => `id${++ids}`,
        ui,
        askParams: async (request: AskRequest) => ({ ...request.params, ...opts.answers }),
        onEvent: (e) => {
          if (e.kind === 'progress') progress.push(e);
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    ).result;
  return { files, media, run, opened, progress };
}

function videosOf(result: RunResult) {
  if (result.status !== 'succeeded' || result.value?.type !== 'video') {
    throw new Error(`no video: ${JSON.stringify(result)}`);
  }
  return result.value.items;
}

const failure = (result: RunResult) =>
  result.status === 'failed' ? { code: result.error.code, detail: result.error.detail } : result;

describe('video tool', () => {
  it('installs three quick actions and a video file list', () => {
    const result = applyOps(
      createDefaultWorkspace('zh'),
      [{ op: 'installTool', toolId: 'video' }],
      {
        registry,
        locale: 'zh',
      },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.config.workflows.map((w) => w.name)).toEqual(['压缩视频', '转成 MP4', '剪一段']);
    const page = result.config.pages.find((p) => p.id === 'tool-video')!;
    expect(page.components.find((c) => c.type === 'fileList')?.props).toMatchObject({
      mimeType: 'video/*',
    });
  });

  it('compresses to at most 20 MB as an MP4, without copying the original', async () => {
    const { files, media, run, progress } = setup(toolWorkflow('video-compress'));
    files.nextVideos = [files.offerVideo('IMG_0001.MOV', { size: 120 * MB })];
    const [video] = videosOf(await run());
    expect(video).toMatchObject({ name: 'IMG_0001', ext: 'mp4', mimeType: 'video/mp4' });
    expect(video!.size).toBeLessThanOrEqual(20 * MB);
    // 选择器的副本是移进来的，不是复制（D-142）。
    expect(files.adopted).toEqual(['picker://IMG_0001.MOV']);
    expect(files.disk.has('picker://IMG_0001.MOV')).toBe(false);
    // 1080p 原片按 20 MB 压到 720p、30 帧。
    expect(media.encodes).toHaveLength(1);
    expect(media.encodes[0]).toMatchObject({ shortSide: 720, maxFps: 30, audioKbps: 128 });
    expect(progress.at(-1)).toEqual(
      expect.objectContaining({ done: 100, total: 100, unit: 'percent' }),
    );
  });

  it('compresses again when the encoder overshoots, and keeps videos that are already small', async () => {
    const { files, media, run } = setup(toolWorkflow('video-compress'));
    media.oversize = 1.1;
    files.nextVideos = [
      files.offerVideo('big.mov', { size: 300 * MB }),
      files.offerVideo('small.mp4', { size: 5 * MB }, 'video/mp4'),
    ];
    const [big, small] = videosOf(await run());
    expect(media.encodes).toHaveLength(2);
    expect(media.encodes[1]!.videoKbps).toBeLessThan(media.encodes[0]!.videoKbps);
    expect(big!.size).toBeLessThanOrEqual(20 * MB);
    expect(small).toMatchObject({ name: 'small', ext: 'mp4', size: 5 * MB });
  });

  it('says how small a long video can go instead of making it unwatchable', async () => {
    const { files, media, run } = setup(toolWorkflow('video-compress'), {
      answers: { maxMB: 5 },
    });
    files.nextVideos = [files.offerVideo('long.mov', { size: 800 * MB, durationMs: 10 * 60_000 })];
    const result = failure(await run());
    expect(result).toMatchObject({
      code: 'targetTooSmall',
      detail: { name: 'long.mov', target: '5 MB' },
    });
    expect(media.encodes).toEqual([]);
  });

  it('compresses by quality tier', async () => {
    const { files, media, run } = setup(toolWorkflow('video-compress'), {
      answers: { by: 'quality', quality: '480p' },
    });
    files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
    videosOf(await run());
    expect(media.encodes[0]).toMatchObject({ shortSide: 480, videoKbps: 1000 });
  });

  it('converts to MP4 at about the same quality', async () => {
    const { files, media, run } = setup(toolWorkflow('video-convert'));
    files.nextVideos = [files.offerVideo('clip.mov', { size: 80 * MB, videoBitrateKbps: 8000 })];
    const [video] = videosOf(await run());
    expect(video).toMatchObject({ name: 'clip', ext: 'mp4', width: 1920, height: 1080 });
    expect(media.encodes[0]!.shortSide).toBeUndefined();
    expect(media.encodes[0]!.videoKbps).toBe(12_000);
  });

  it('trims the part chosen on the trim screen', async () => {
    const { files, media, run, opened } = setup(toolWorkflow('video-trim'), {
      trim: [{ startMs: 5000, endMs: 20_000 }],
    });
    files.nextVideos = [files.offerVideo('trip.mov', { size: 60 * MB })];
    const [video] = videosOf(await run());
    expect(opened[0]!.kind).toBe('trimMedia');
    expect((opened[0]!.input as { items: { durationMs: number }[] }).items[0]!.durationMs).toBe(
      60_000,
    );
    expect(media.trims).toEqual([
      { uri: expect.stringContaining('trip.mov'), range: { startMs: 5000, endMs: 20_000 } },
    ]);
    expect(video).toMatchObject({ durationMs: 15_000, size: 15 * MB });
  });

  it('keeps the whole video when the whole video is chosen; cancelling the screen cancels', async () => {
    const whole = setup(toolWorkflow('video-trim'), { trim: [{ startMs: 0, endMs: 60_000 }] });
    whole.files.nextVideos = [whole.files.offerVideo('a.mov', { size: 10 * MB })];
    expect(videosOf(await whole.run())[0]).toMatchObject({ ext: 'mov', size: 10 * MB });
    expect(whole.media.trims).toEqual([]);

    const cancelled = setup(toolWorkflow('video-trim'), { trim: null });
    cancelled.files.nextVideos = [cancelled.files.offerVideo('a.mov', { size: 10 * MB })];
    expect((await cancelled.run()).status).toBe('cancelled');
  });

  it('reports what the user can do about native failures', async () => {
    const cases: [string, string][] = [
      ['ERR_MEDIA_UNSUPPORTED', 'mediaUnsupported'],
      ['ERR_MEDIA_INTERRUPTED', 'interrupted'],
    ];
    for (const [native, code] of cases) {
      const { files, media, run } = setup(toolWorkflow('video-compress'));
      media.failWith = native;
      files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
      expect(failure(await run())).toMatchObject({ code });
    }
    const cancelled = setup(toolWorkflow('video-compress'));
    cancelled.media.failWith = 'ERR_MEDIA_CANCELLED';
    cancelled.files.nextVideos = [cancelled.files.offerVideo('a.mov', { size: 100 * MB })];
    expect((await cancelled.run()).status).toBe('cancelled');
  });

  it('needs the full app, enough space, and openable videos', async () => {
    const goApp = setup(toolWorkflow('video-compress'));
    goApp.files.media = null;
    goApp.files.nextVideos = [goApp.files.offerVideo('a.mov', { size: 100 * MB })];
    expect(failure(await goApp.run())).toMatchObject({ code: 'needsFullApp' });

    const full = setup(toolWorkflow('video-convert'));
    full.files.freeBytes = 50 * MB;
    full.files.nextVideos = [full.files.offerVideo('a.mov', { size: 100 * MB })];
    expect(failure(await full.run())).toMatchObject({ code: 'notEnoughSpace' });

    const broken = setup(toolWorkflow('video-convert'));
    broken.files.nextVideos = [broken.files.offer('a.mov', new Uint8Array(10), 'video/quicktime')];
    expect(failure(await broken.run())).toMatchObject({
      code: 'mediaUnsupported',
      detail: { name: 'a.mov' },
    });
  });

  it('applies the media limits: 4 GB each, at most 10; photos are not videos', async () => {
    const { files, run } = setup(toolWorkflow('video-compress'));
    files.nextVideos = [
      {
        uri: 'picker://huge.mov',
        name: 'huge.mov',
        size: 5 * 1024 * MB,
        mimeType: 'video/quicktime',
      },
    ];
    expect(failure(await run())).toMatchObject({ code: 'tooLarge', detail: { mb: 4096 } });

    const photo = setup(toolWorkflow('video-compress'));
    photo.files.nextVideos = [photo.files.offerImage('a.jpg', 10, 10)];
    expect(failure(await photo.run())).toMatchObject({ code: 'wrongType' });
  });

  it('runs the ready-made «video too big to send» and shares the result', async () => {
    const wf = presetWorkflow(presetById('video-too-big')!, 'zh', 'v');
    const { files, run } = setup(wf, { answers: { maxMB: 50 } });
    files.nextVideos = [files.offerVideo('a.mov', { size: 300 * MB })];
    const [video] = videosOf(await run());
    expect(video!.size).toBeLessThanOrEqual(50 * MB);
    expect(files.shareSheets).toEqual([[video!.uri]]);
  });

  it('does not put big videos into a ZIP (it is built in memory)', async () => {
    const wf: Workflow = {
      id: 'z',
      name: 'z',
      steps: [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 1 } },
        { id: 'zip', action: 'zip.create', params: {} },
      ],
    };
    const { files, run } = setup(wf);
    files.nextVideos = [files.offerVideo('a.mov', { size: 60 * MB })];
    expect(failure(await run())).toMatchObject({ code: 'tooLarge', detail: { mb: 50 } });
  });

  it('renames videos by moving them, not copying', async () => {
    const wf: Workflow = {
      id: 'r',
      name: 'r',
      steps: [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 1 } },
        { id: 'name', action: 'file.rename', params: { template: '旅行-{date}' } },
      ],
    };
    const { files, run } = setup(wf);
    files.nextVideos = [files.offerVideo('a.mov', { size: 60 * MB })];
    const [video] = videosOf(await run());
    expect(video).toMatchObject({ name: '旅行-2026-10-23', ext: 'mov' });
    // 只剩一份。
    expect(files.runFiles()).toHaveLength(1);
  });

  it('fails cleanly when stopped while encoding', async () => {
    const signal = { cancelled: false };
    const { files, media, run } = setup(toolWorkflow('video-compress'), { signal });
    const encode = media.encodeVideo.bind(media);
    media.encodeVideo = async (...args) => {
      signal.cancelled = true;
      return encode(...args);
    };
    files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
    expect((await run()).status).toBe('cancelled');
  });
});
