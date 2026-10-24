import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type AskRequest,
  type Workflow,
} from '@morph/core';
import { readExif } from '@morph/tool-image';

import type { LocalSteps, LocalUi } from '../runtime/local';
import { startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';

const registry = createRegistry(BUILTIN_TOOLS);

/** 安装图片工具后的单功能工作流。 */
function toolWorkflow(id: string): Workflow {
  const result = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId: 'image' }], {
    registry,
    locale: 'zh',
  });
  if (!result.ok) throw new Error(result.error);
  return result.config.workflows.find((w) => w.id === id)!;
}

const custom = (steps: Workflow['steps']): Workflow => ({ id: 'mine', name: '我的', steps });
const pick = { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } };

let ids = 0;
function setup(
  workflow: Workflow,
  answers: Record<string, unknown> = {},
  crop: LocalSteps['crop']['out'] | null = null,
) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const opened: { kind: string; input: unknown }[] = [];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async (kind, input) => {
      opened.push({ kind, input });
      return crop as never;
    },
  };
  const run = async () =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo,
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 22),
        newId: () => `id${++ids}`,
        ui,
        askParams: async (request: AskRequest) => ({ ...request.params, ...answers }),
      })
    ).result;
  return { files, run, opened };
}

const imagesOf = (result: Awaited<ReturnType<ReturnType<typeof setup>['run']>>) => {
  if (result.status !== 'succeeded' || result.value?.type !== 'images') {
    throw new Error(`run did not produce images: ${JSON.stringify(result)}`);
  }
  return result.value.items;
};

describe('image tool workflows', () => {
  it('installs fourteen single-tool workflows that all validate', () => {
    const result = applyOps(
      createDefaultWorkspace('en'),
      [{ op: 'installTool', toolId: 'image' }],
      {
        registry,
        locale: 'en',
      },
    );
    expect(result.ok && result.config.workflows.map((w) => w.id)).toEqual([
      'image-compress',
      'image-convert',
      'image-heic',
      'image-resize',
      'image-crop',
      'image-rotate',
      'image-stripmetadata',
      'image-stitch',
      'image-grid',
      'image-togif',
      'image-redact',
      'image-watermark',
      'image-idphoto',
      'image-printsheet',
    ]);
  });

  it('compresses every photo to at most the asked size, keeping quality as high as possible', async () => {
    const { files, run } = setup(toolWorkflow('image-compress'), { maxKB: 240 });
    files.nextPhotos = [
      files.offerImage('IMG_1.HEIC', 4032, 3024, 'image/heic'),
      files.offerImage('small.jpg', 300, 200),
    ];
    const items = imagesOf(await run());
    expect(items.map((i) => `${i.name}.${i.ext}`)).toEqual(['IMG_1.jpg', 'small.jpg']);
    for (const item of items) expect(item.size).toBeLessThanOrEqual(240 * 1024);
    // 小图不需要缩小：原尺寸、最高质量就已满足。
    expect(items[1]).toMatchObject({ width: 300, height: 200 });
    // 大图先降质量，不够才缩小尺寸，宽高比不变。
    expect(items[0]!.width! / items[0]!.height!).toBeCloseTo(4 / 3, 2);
    expect(items[0]!.size).toBeGreaterThan(200 * 1024);
  });

  it('reports a target that cannot be reached', async () => {
    const { files, run } = setup(
      custom([pick, { id: 'c', action: 'image.compress', params: { maxKB: 10, format: 'jpeg' } }]),
    );
    files.minEncodedBytes = 50 * 1024;
    files.nextPhotos = [files.offerImage('huge.jpg', 4000, 4000)];
    expect(await run()).toMatchObject({
      status: 'failed',
      error: { code: 'targetNotMet', detail: { name: 'huge.jpg', target: '10 KB', got: '50 KB' } },
    });
  });

  it('converts HEIC to JPG/PNG/WebP and never outputs HEIC', async () => {
    for (const [format, ext] of [
      ['jpeg', 'jpg'],
      ['png', 'png'],
      ['webp', 'webp'],
    ] as const) {
      const { files, run } = setup(toolWorkflow('image-convert'), { format });
      files.nextPhotos = [files.offerImage('IMG_2.HEIC', 4032, 3024, 'image/heic')];
      const [item] = imagesOf(await run());
      expect(item).toMatchObject({ ext, width: 4032, height: 3024 });
    }
  });

  it('resizes by long edge, percent and box without cropping or enlarging', async () => {
    const cases: [Record<string, unknown>, [number, number]][] = [
      [{ mode: 'longEdge', px: 2048 }, [2048, 1536]],
      [{ mode: 'percent', percent: 50 }, [2016, 1512]],
      [{ mode: 'fit', width: 600, height: 600 }, [600, 450]],
      [{ mode: 'width', px: 8000 }, [4032, 3024]],
    ];
    for (const [answers, [w, h]] of cases) {
      const { files, run } = setup(toolWorkflow('image-resize'), answers);
      files.nextPhotos = [files.offerImage('a.jpg', 4032, 3024)];
      expect(imagesOf(await run())[0]).toMatchObject({ width: w, height: h });
    }
  });

  it('opens the crop screen with the locked ratio and crops in source pixels', async () => {
    const { files, run, opened } = setup(toolWorkflow('image-crop'), { aspect: '1:1' }, [
      { x: 100, y: 50, width: 1000, height: 1000 },
    ]);
    files.nextPhotos = [files.offerImage('a.jpg', 4032, 3024)];
    const [item] = imagesOf(await run());
    expect(opened).toEqual([
      {
        kind: 'crop',
        input: { items: [expect.objectContaining({ width: 4032, height: 3024 })], aspect: 1 },
      },
    ]);
    expect(item).toMatchObject({ width: 1000, height: 1000 });
    expect(files.encodes.at(-1)!.ops).toEqual({
      crop: { x: 100, y: 50, width: 1000, height: 1000 },
    });
  });

  it('cancelling the crop screen cancels the run', async () => {
    const { files, run } = setup(toolWorkflow('image-crop'), { aspect: 'free' }, null);
    files.nextPhotos = [files.offerImage('a.jpg', 400, 300)];
    expect(await run()).toEqual({ status: 'cancelled' });
  });

  it('rotates and flips', async () => {
    const { files, run } = setup(toolWorkflow('image-rotate'), { angle: 90, flip: 'horizontal' });
    files.nextPhotos = [files.offerImage('a.png', 400, 300, 'image/png')];
    const [item] = imagesOf(await run());
    expect(item).toMatchObject({ width: 300, height: 400, ext: 'png' });
    expect(files.encodes.at(-1)!.ops).toEqual({ rotate: 90, flip: 'horizontal' });
  });

  it('removes location from JPGs losslessly and re-encodes everything else', async () => {
    const { files, run } = setup(toolWorkflow('image-stripmetadata'));
    const withGps = jpegWithExif();
    expect(readExif(withGps).hasLocation).toBe(true);
    files.nextPhotos = [
      files.offerImage('gps.jpg', 8, 8, 'image/jpeg', withGps),
      files.offerImage('b.heic', 400, 300, 'image/heic'),
    ];
    const items = imagesOf(await run());
    const stripped = files.disk.get(items[0]!.uri)!;
    expect(readExif(stripped).hasLocation).toBe(false);
    expect(stripped.length).toBeLessThan(withGps.length);
    // 只重新编码了 HEIC 那一张。
    expect(files.encodes).toHaveLength(1);
    expect(items[1]).toMatchObject({ ext: 'jpg' });
  });
});

/** 一个最小的 JPEG：SOI + 含 GPS 指针的 EXIF APP1 + 一个假的扫描段 + EOI。 */
function jpegWithExif(): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    // IFD0：1 个条目，GPS IFD 指针（0x8825）
    0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00,
    0x00, 0x00,
    // GPS IFD：1 个条目，GPSLatitude（0x0002）
    0x00, 0x01, 0x00, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = app1.length + 2;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    len >> 8,
    len & 0xff,
    ...app1,
    0xff,
    0xda,
    0x00,
    0x02,
    0x11,
    0x22,
    0x33,
    0xff,
    0xd9,
  ]);
}
