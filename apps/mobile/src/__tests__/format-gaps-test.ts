import {
  applyOps,
  type AskRequest,
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createRegistry,
  quickActionsOf,
  type RunResult,
  type Workflow,
} from '@morph/core';

import type { LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeMedia } from '../test-utils/fake-files';

// 格式转换的缺口（D-183–D-186）：MP3、动图 GIF、从「文件」选照片和视频、Word / Excel / PPT 转 PDF，
// 以及手机打不开电脑格式视频时的说法。原生模块换成 test-utils 里的假实现。

const registry = createRegistry(BUILTIN_TOOLS);
const MB = 1024 * 1024;

function toolWorkflow(toolId: string, id: string): Workflow {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [{ op: 'setPackage', package: toolId, do: 'add' }],
    {
      registry,
      locale: 'zh',
    },
  );
  if (!result.ok) throw new Error(result.error);
  return quickActionsOf(result.config).find((w) => w.id === id)!;
}

let ids = 0;
function setup(
  workflow: Workflow,
  opts: { answers?: Record<string, unknown>; trim?: { startMs: number; endMs: number }[] } = {},
) {
  const files = new FakeFiles();
  const media = files.media as FakeMedia;
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async () => (opts.trim ?? null) as never,
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
        now: () => new Date(2026, 9, 24),
        newId: () => `id${++ids}`,
        ui,
        // 只回答这一步问到的参数。
        askParams: async (request: AskRequest) => ({
          ...request.params,
          ...Object.fromEntries(
            Object.entries(opts.answers ?? {}).filter(([k]) => request.keys.includes(k)),
          ),
        }),
      })
    ).result;
  return { files, media, run };
}

function itemsOf(result: RunResult, type: string) {
  if (result.status !== 'succeeded' || result.value?.type !== type) {
    throw new Error(`no ${type}: ${JSON.stringify(result)}`);
  }
  return 'items' in result.value ? result.value.items : [];
}

const failure = (result: RunResult) =>
  result.status === 'failed' ? { code: result.error.code, detail: result.error.detail } : result;

describe('MP3 (D-183)', () => {
  it('converts recordings and music to MP3 at a standard bitrate, keeping mono recordings mono', async () => {
    const { files, media, run } = setup(toolWorkflow('audio', 'audio-convert'), {
      answers: { format: 'mp3' },
    });
    files.nextPick = [
      files.offerAudio('song.m4a', { size: 5 * MB, audioBitrateKbps: 128, audioCodec: 'aac' }),
      files.offerAudio('memo.m4a', { size: 1 * MB, audioBitrateKbps: 64, channels: 1 }),
    ];
    const items = itemsOf(await run(), 'audio');
    expect(items.map((i) => [i.ext, i.mimeType])).toEqual([
      ['mp3', 'audio/mpeg'],
      ['mp3', 'audio/mpeg'],
    ]);
    // 128 kbps 的 AAC → 192 kbps 的 MP3；64 kbps 的单声道录音 → 128 kbps，仍是单声道。
    expect(media.audioEncodes).toMatchObject([
      { format: 'mp3', bitrateKbps: 192, channels: 2, sampleRate: 44100 },
      { format: 'mp3', bitrateKbps: 128, channels: 1, sampleRate: 44100 },
    ]);
  });

  it('leaves files that are already MP3 alone', async () => {
    const { files, media, run } = setup(toolWorkflow('audio', 'audio-convert'), {
      answers: { format: 'mp3' },
    });
    files.nextPick = [files.offerAudio('a.mp3', { size: 1 * MB }, 'audio/mpeg')];
    expect(itemsOf(await run(), 'audio')[0]).toMatchObject({ ext: 'mp3', size: 1 * MB });
    expect(media.audioEncodes).toEqual([]);
  });

  it('keeps the sound of a video as an MP3', async () => {
    const workflow = structuredClone(toolWorkflow('audio', 'audio-from-video'));
    workflow.steps[1]!.params = { format: 'mp3' };
    const { files, media, run } = setup(workflow);
    files.nextVideos = [files.offerVideo('concert.mov', { size: 80 * MB, audioBitrateKbps: 256 })];
    expect(itemsOf(await run(), 'audio')[0]).toMatchObject({ name: 'concert', ext: 'mp3' });
    expect(media.audioEncodes[0]).toMatchObject({ format: 'mp3', bitrateKbps: 320 });
  });
});

describe('animated GIFs (D-184)', () => {
  it('trims a video and turns the part into a GIF', async () => {
    const { files, media, run } = setup(toolWorkflow('video', 'video-gif'), {
      answers: { width: 320 },
      trim: [{ startMs: 5_000, endMs: 11_000 }],
    });
    files.nextVideos = [files.offerVideo('cat.mov', { size: 50 * MB, durationMs: 60_000 })];
    const [gif] = itemsOf(await run(), 'images');
    expect(gif).toMatchObject({ name: 'cat', ext: 'gif', mimeType: 'image/gif', width: 320 });
    // 剪出来 6 秒，每秒 12 帧。
    expect(media.gifs[0]!.settings).toEqual({ width: 320, fps: 12 });
    expect(gif!.size).toBe(72 * 1024);
  });

  it('says when a video is too long for a GIF', async () => {
    const workflow = structuredClone(toolWorkflow('video', 'video-gif'));
    workflow.steps.splice(1, 1); // 去掉「剪一段」
    const { files, run } = setup(workflow);
    files.nextVideos = [files.offerVideo('long.mov', { size: 50 * MB, durationMs: 45_000 })];
    expect(failure(await run())).toEqual({
      code: 'tooLong',
      detail: { name: 'long.mov', seconds: 30 },
    });
  });

  it('turns several photos into one looping GIF', async () => {
    const { files, media, run } = setup(toolWorkflow('image', 'image-togif'), {
      answers: { delayMs: 1000 },
    });
    files.nextPhotos = [
      files.offerImage('1.jpg', 4000, 3000),
      files.offerImage('2.jpg', 3000, 4000),
      files.offerImage('3.heic', 4032, 3024, 'image/heic'),
    ];
    const items = itemsOf(await run(), 'images');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: '1', ext: 'gif', mimeType: 'image/gif' });
    expect(media.gifs[0]!.uris).toHaveLength(3);
    expect(media.gifs[0]!.settings).toEqual({ delayMs: 1000, maxSide: 480 });
  });

  it('needs the full app for GIFs', async () => {
    const { files, run } = setup(toolWorkflow('image', 'image-togif'));
    files.media = null;
    files.nextPhotos = [files.offerImage('1.jpg', 400, 300), files.offerImage('2.jpg', 400, 300)];
    expect(failure(await run())).toMatchObject({ code: 'needsFullApp' });
  });
});

describe('picking from Files (D-184, D-185)', () => {
  it('HEIC to JPG can pick pictures from Files', async () => {
    const { files, run } = setup(toolWorkflow('image', 'image-heic'), {
      answers: { source: 'files' },
    });
    files.nextPick = [files.offerImage('IMG_0001.HEIC', 4032, 3024, 'image/heic')];
    const [jpg] = itemsOf(await run(), 'images');
    expect(files.lastPickTypes).toEqual(['image/*']);
    expect(jpg).toMatchObject({ name: 'IMG_0001', ext: 'jpg', mimeType: 'image/jpeg' });
  });

  it('rejects a picked file that is not a picture', async () => {
    const { files, run } = setup(toolWorkflow('image', 'image-heic'), {
      answers: { source: 'files' },
    });
    files.nextPick = [files.offer('notes.pdf', new Uint8Array(10))];
    expect(failure(await run())).toMatchObject({
      code: 'wrongType',
      detail: { name: 'notes.pdf' },
    });
  });

  it('converts a video picked from Files (an MKV on Android) to MP4', async () => {
    const { files, media, run } = setup(toolWorkflow('video', 'video-convert'), {
      answers: { source: 'files' },
    });
    files.nextPick = [files.offerVideo('movie.mkv', { size: 300 * MB }, 'video/x-matroska')];
    const [video] = itemsOf(await run(), 'video');
    expect(files.lastPickTypes).toEqual(['video/*']);
    expect(video).toMatchObject({ name: 'movie', ext: 'mp4' });
    expect(media.encodes).toHaveLength(1);
  });

  it('a step without a source (older quick actions) still picks from the photo library', async () => {
    const { files, run } = setup(toolWorkflow('video', 'video-compress'));
    files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
    expect(itemsOf(await run(), 'video')).toHaveLength(1);
  });

  it('says when the phone can’t open a computer video format (iPhone and MKV)', async () => {
    const { files, media, run } = setup(toolWorkflow('video', 'video-convert'), {
      answers: { source: 'files' },
    });
    files.nextPick = [files.offerVideo('movie.mkv', { size: 300 * MB }, 'video/x-matroska')];
    media.failWith = 'ERR_MEDIA_UNSUPPORTED';
    expect(failure(await run())).toEqual({
      code: 'formatUnsupported',
      detail: { name: 'movie.mkv', format: 'MKV' },
    });
  });
});

describe('documents to PDF (D-186)', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  it('turns Word documents into A4 PDFs', async () => {
    const { files, run } = setup(toolWorkflow('pdf', 'pdf-document'));
    files.nextPick = [files.offer('report.docx', new Uint8Array(3000), docx)];
    const [pdf] = itemsOf(await run(), 'pdf');
    expect(files.lastPickTypes).toContain(docx);
    expect(pdf).toMatchObject({ name: 'report', ext: 'pdf', pageCount: 3 });
    expect(files.documents.converted[0]).toMatchObject({
      ext: 'docx',
      page: { width: 595.28, height: 841.89 },
    });
  });

  it('on a phone that only converts Word, says so for Excel before converting anything', async () => {
    const { files, run } = setup(toolWorkflow('pdf', 'pdf-document'));
    files.nextPick = [
      files.offer('a.docx', new Uint8Array(10), docx),
      files.offer('budget.xlsx', new Uint8Array(10), xlsx),
    ];
    expect(failure(await run())).toEqual({
      code: 'documentUnsupported',
      detail: { name: 'budget.xlsx', format: 'XLSX' },
    });
    expect(files.documents.converted).toEqual([]);
  });

  it('converts Excel and PowerPoint where the system can show them (iPhone)', async () => {
    const { files, run } = setup(toolWorkflow('pdf', 'pdf-document'));
    files.documents.extensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf'];
    files.nextPick = [
      files.offer('budget.xlsx', new Uint8Array(10), xlsx),
      files.offer('talk.pptx', new Uint8Array(10), 'application/octet-stream'),
    ];
    expect(itemsOf(await run(), 'pdf').map((i) => i.name)).toEqual(['budget', 'talk']);
  });

  it('says a broken document can’t be read', async () => {
    const { files, run } = setup(toolWorkflow('pdf', 'pdf-document'));
    files.documents.failWith = 'ERR_DOC_UNREADABLE';
    files.nextPick = [files.offer('broken.docx', new Uint8Array(10), docx)];
    expect(failure(await run())).toEqual({ code: 'unreadable', detail: { name: 'broken.docx' } });
  });

  it('only offers Office documents in the picker and rejects other files', async () => {
    const { files, run } = setup(toolWorkflow('pdf', 'pdf-document'));
    files.nextPick = [files.offer('photo.jpg', new Uint8Array(10), 'image/jpeg')];
    expect(failure(await run())).toMatchObject({ code: 'wrongType' });
  });
});
