import { BUILTIN_TOOLS, createRegistry, type RunResult, type Workflow } from '@morph/core';
import { HEAD_RATIO, faceCrop } from '@morph/tool-image';

import type { LocalKind, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision } from '../test-utils/fake-files';

// 证件照换底色和自动框脸（D-252）：人脸检测和人像分割换成假的，裁剪框的计算和编码流程是真的。

const registry = createRegistry(BUILTIN_TOOLS);
const workflow = (params: Record<string, unknown>): Workflow => ({
  id: 'mine',
  name: '证件照',
  steps: [
    { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
    { id: 'id', action: 'image.idPhoto', params: { spec: 'schengen', maxKB: 0, ...params } },
  ],
});

let ids = 0;
function setup(params: Record<string, unknown>, vision = true) {
  const files = new FakeFiles();
  const fake = new FakeVision(files);
  if (vision) files.vision = fake;
  const opened: { kind: LocalKind; input: unknown }[] = [];
  const confirms: string[] = [];
  const ui: LocalUi = {
    confirm: async (title) => {
      confirms.push(title);
      return true;
    },
    choose: async () => null,
    open: async (kind, input) => {
      opened.push({ kind, input });
      // 用户直接点「完成」：用界面上已经摆好的框（有自动框脸的用它，没有的居中）。
      const crop = input as { items: { width: number; height: number }[]; initial?: unknown[] };
      return crop.items.map(
        (it, i) => crop.initial?.[i] ?? { x: 0, y: 0, width: it.width, height: it.height },
      ) as never;
    },
  };
  const run = async (): Promise<RunResult> =>
    (
      await startRun({
        workflow: workflow(params),
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        collections: [],
      })
    ).result;
  return { files, vision: fake, run, opened, confirms };
}

describe('ID photo: automatic framing', () => {
  it('starts the crop frame from the face, scaling an Android-sized detection back to the photo', async () => {
    const { files, vision, run, opened } = setup({ autoCenter: true });
    files.nextPhotos = [files.offerImage('me.jpg', 3024, 4032)];
    // 检测用的图缩到了长边 2048。
    vision.faceResults = [
      {
        width: 1536,
        height: 2048,
        faces: [
          { x: 10, y: 10, width: 50, height: 60 },
          { x: 559, y: 610, width: 406, height: 508 },
        ],
      },
    ];
    const result = await run();
    expect(result.status).toBe('succeeded');
    const k = 3024 / 1536;
    const expected = faceCrop(
      { width: 3024, height: 4032 },
      { x: 559 * k, y: 610 * k, width: 406 * k, height: 508 * k },
      35 / 45,
      HEAD_RATIO.schengen!,
    );
    expect(opened[0]).toMatchObject({ kind: 'crop', input: { initial: [expected] } });
    expect(files.encodes.at(-1)).toMatchObject({
      ops: { crop: expected, resize: { width: 413, height: 531 } },
    });
  });

  it('a photo without a face, or a device without face detection, starts centered as before', async () => {
    const noFace = setup({ autoCenter: true });
    noFace.files.nextPhotos = [noFace.files.offerImage('wall.jpg', 1000, 1000)];
    await noFace.run();
    expect(noFace.opened[0]).toMatchObject({ input: { initial: [null] } });

    const expoGo = setup({ autoCenter: true }, false);
    expoGo.files.nextPhotos = [expoGo.files.offerImage('me.jpg', 1000, 1000)];
    expect((await expoGo.run()).status).toBe('succeeded');
    expect(expoGo.opened[0]!.input).not.toHaveProperty('initial');
  });
});

describe('ID photo: background color', () => {
  it('replaces the background with the standard blue before cropping, and still outputs a JPG', async () => {
    const { files, vision, run } = setup({ background: 'blue' });
    files.nextPhotos = [files.offerImage('me.heic', 3024, 4032, 'image/heic')];
    const result = await run();
    expect(result).toMatchObject({
      status: 'succeeded',
      value: { items: [{ ext: 'jpg', width: 413, height: 531 }] },
    });
    expect(vision.calls.filter((c) => c.method === 'replaceBackground').map((c) => c.args)).toEqual(
      ['#438EDB'],
    );
    expect(files.encodes.at(-1)).toMatchObject({ format: 'jpeg', width: 413, height: 531 });
  });

  it('a custom color is used as given; Android asks before downloading the segmentation model', async () => {
    const android = setup({ background: 'custom', color: '#12AB34' });
    android.vision.personSegmentation = false;
    android.vision.backgroundState = 'download';
    android.files.nextPhotos = [android.files.offerImage('me.jpg', 800, 1000)];
    expect((await android.run()).status).toBe('succeeded');
    expect(android.confirms).toHaveLength(1);
    expect(android.vision.calls.map((c) => c.method)).toEqual([
      'downloadBackgroundModel',
      'replaceBackground',
    ]);
    expect(android.vision.calls[1]!.args).toBe('#12AB34');
  });

  it('says clearly when the device can’t do it, or when no person is found', async () => {
    const expoGo = setup({ background: 'white' }, false);
    expoGo.files.nextPhotos = [expoGo.files.offerImage('me.jpg', 800, 1000)];
    expect(await expoGo.run()).toMatchObject({
      status: 'failed',
      error: { code: 'unsupportedAction' },
    });

    const empty = setup({ background: 'white' });
    empty.vision.backgroundFailure = true;
    empty.files.nextPhotos = [empty.files.offerImage('wall.jpg', 800, 1000)];
    expect(await empty.run()).toMatchObject({
      status: 'failed',
      error: { code: 'backgroundFailed' },
    });
  });

  it('keeping the background calls no segmentation at all', async () => {
    const { files, vision, run } = setup({ background: 'keep' });
    files.nextPhotos = [files.offerImage('me.jpg', 800, 1000)];
    expect((await run()).status).toBe('succeeded');
    expect(vision.calls).toEqual([]);
  });
});
