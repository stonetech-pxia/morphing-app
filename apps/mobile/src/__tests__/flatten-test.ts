import type { RgbaImage, Size, WarpMesh } from '@morph/tool-image';

import {
  DEWARP_PACK,
  createFlattener,
  type FlattenIo,
  type FlattenNative,
} from '../runtime/flatten';

// 扫描展平（D-274）的流程：模型和 Skia 换成假的，检查调用顺序、临时文件、精修的开关和失败时的清理。

/** UVDoc 输出一张「不弯」的网格：输出点就是补边后图上同样位置的点。 */
function identityGrid(): Float32Array {
  const g = new Float32Array(2 * 45 * 31);
  for (let y = 0; y < 45; y++) {
    for (let x = 0; x < 31; x++) {
      g[y * 31 + x] = (x / 30) * 2 - 1;
      g[45 * 31 + y * 31 + x] = (y / 44) * 2 - 1;
    }
  }
  return g;
}

function setup(options: { dewarp?: boolean; ppocr?: boolean; shape?: number[] } = {}) {
  const files = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const calls: string[] = [];
  const rendered: Size[] = [];
  const meshes: WarpMesh[] = [];
  let dirs = 0;
  const native: FlattenNative = {
    async modelRun(model, input, shape, output) {
      calls.push(`modelRun ${model.split('/').pop()} ${shape.join('×')}`);
      expect(files.get(input)!.length).toBe(3 * 712 * 488 * 4);
      const grid = identityGrid();
      files.set(output, new Uint8Array(grid.buffer));
      return options.shape ?? [1, 2, 45, 31];
    },
    async ocrLoad(det, rec) {
      calls.push(`ocrLoad ${det.split('/').pop()} ${rec.split('/').pop()}`);
    },
    async ocrDetect(input, width, height, output) {
      calls.push(`ocrDetect ${width}×${height}`);
      // 8 条横向的文字行。
      const prob = new Uint8Array(width * height);
      for (let k = 0; k < 8; k++) {
        const y0 = 60 + k * 80;
        for (let y = y0; y < y0 + 12; y++) prob.fill(220, y * width + 40, y * width + width - 40);
      }
      files.set(output, prob);
    },
  };
  const page = (w: number, h: number) => ({
    width: w,
    height: h,
    uvdocPixels: (): RgbaImage => ({
      width: 488,
      height: 712,
      data: new Uint8Array(488 * 712 * 4).fill(200),
    }),
    render(mesh: WarpMesh, out: Size): RgbaImage {
      rendered.push(out);
      meshes.push(mesh);
      return { ...out, data: new Uint8Array(out.width * out.height * 4).fill(230) };
    },
    encode(mesh: WarpMesh) {
      meshes.push(mesh);
      return new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    },
    dispose: () => calls.push('dispose'),
  });
  const io: FlattenIo = {
    installed: async (pack) =>
      pack === DEWARP_PACK ? options.dewarp !== false : options.ppocr !== false,
    modelUri: (pack, file) => `file:///packs/${pack}/${file}`,
    readFile: async (uri) => files.get(uri) ?? new Uint8Array([0xff, 0xd8]),
    async writeFile(uri, bytes) {
      files.set(uri, bytes.slice());
      return bytes.length;
    },
    tempDir() {
      const uri = `file:///cache/flatten/${dirs++}`;
      return { uri, remove: () => removed.push(uri) };
    },
    open: () => page(1700, 2400),
  };
  const flattener = createFlattener(native, io, { ocrPack: 'ppocr', quality: 0.9 });
  return { flattener, files, removed, calls, rendered, meshes };
}

describe('page flattening (D-274)', () => {
  it('flattens with UVDoc, refines by the text lines and draws the page once', async () => {
    const { flattener, files, removed, calls, rendered, meshes } = setup();
    const done = await flattener.flatten('file:///page.jpg', 'file:///runs/1/page.jpg');
    expect(calls).toEqual([
      'modelRun uvdoc.onnx 1×3×712×488',
      'ocrLoad det.onnx rec.onnx',
      // 找文字行的小图：长边 1280，32 的倍数。
      'ocrDetect 896×1280',
      'dispose',
    ]);
    expect(rendered).toEqual([{ width: 896, height: 1280 }]);
    // 最后一次画的是原大小（网格的顶点铺满整页）。
    const last = meshes.at(-1)!;
    expect(Math.max(...last.positions.filter((_, i) => i % 2 === 0))).toBe(1700);
    expect(Math.max(...last.positions.filter((_, i) => i % 2 === 1))).toBe(2400);
    expect(done).toMatchObject({ width: 1700, height: 2400, size: 5, refined: true });
    expect(files.get('file:///runs/1/page.jpg')).toEqual(new Uint8Array([0xff, 0xd8, 1, 2, 3]));
    expect(removed).toEqual(['file:///cache/flatten/0']);
  });

  it('only flattens (no refining) when the text recognition model is not installed', async () => {
    const { flattener, calls } = setup({ ppocr: false });
    const done = await flattener.flatten('file:///page.jpg', 'file:///runs/1/page.jpg');
    expect(calls).toEqual(['modelRun uvdoc.onnx 1×3×712×488', 'dispose']);
    expect(done).toMatchObject({ refined: false });
  });

  it('returns null without touching the page when the flattening model is not installed', async () => {
    const { flattener, calls, removed } = setup({ dewarp: false });
    expect(await flattener.flatten('file:///page.jpg', 'file:///out.jpg')).toBeNull();
    expect(calls).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('cleans up and fails on an unexpected model output', async () => {
    const { flattener, calls, removed } = setup({ shape: [1, 2, 10, 10] });
    await expect(flattener.flatten('file:///page.jpg', 'file:///out.jpg')).rejects.toThrow(
      /unexpected UVDoc output/,
    );
    expect(calls.at(-1)).toBe('dispose');
    expect(removed).toHaveLength(1);
  });
});
