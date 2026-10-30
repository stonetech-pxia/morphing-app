import { LAYOUT_LABELS } from '@morph/tool-office';

import { createLayoutDetector, type LayoutIo } from '../runtime/layout';

// 转 Word 的版面分析（D-310）：扩展包没装时不跑；输入、输出走临时文件，用完不管成功失败都删掉；
// 输出的框按找线那张图的大小换算回来。

function setup(output: number[], shape: number[], installed = true) {
  const disk = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let removed = 0;
  const io: LayoutIo = {
    installed: async (pack) => (calls.push(`installed ${pack}`), installed),
    modelUri: (pack, file) => `file:///packs/${pack}/${file}`,
    readFile: async (uri) => disk.get(uri)!,
    writeFile: async (uri, bytes) => void disk.set(uri, bytes.slice()),
    tempDir: () => ({ uri: 'file:///tmp/layout-1', remove: () => void removed++ }),
  };
  const detector = createLayoutDetector(
    {
      async modelRun(model, input, inShape, out) {
        calls.push(`modelRun ${model.split('/').pop()} ${inShape.join('×')}`);
        // 输入是 1×3×480×480 的 float32。
        expect(disk.get(input)!.byteLength).toBe(3 * 480 * 480 * 4);
        // 原生读回来的字节不一定从 4 的倍数开始：放在一个偏移过的缓冲里。
        const raw = new Uint8Array(new Float32Array(output).buffer);
        const shifted = new Uint8Array(raw.length + 1);
        shifted.set(raw, 1);
        disk.set(out, shifted.subarray(1));
        return shape;
      },
    },
    io,
  );
  return { detector, calls, removed: () => removed };
}

const pixels = { width: 960, height: 1440, data: new Uint8Array(960 * 1440 * 4).fill(255) };

describe('layout detector (D-310)', () => {
  it('runs the pack’s model and maps the boxes to the picture', async () => {
    const text = LAYOUT_LABELS.indexOf('text');
    const { detector, calls, removed } = setup([text, 0.9, 48, 48, 240, 96], [1, 6]);
    const regions = await detector.detect(pixels);
    expect(calls).toEqual(['installed layout', 'modelRun layout.onnx 1×3×480×480']);
    expect(regions).toEqual([
      {
        kind: 'text',
        label: 'text',
        score: expect.closeTo(0.9, 5),
        box: { x: 96, y: 144, width: 384, height: 144 },
      },
    ]);
    expect(removed()).toBe(1);
  });

  it('returns null without running anything when the pack is not installed', async () => {
    const { detector, calls } = setup([], [0, 6], false);
    expect(await detector.detect(pixels)).toBeNull();
    expect(calls).toEqual(['installed layout']);
  });

  it('throws on an unexpected output and still removes the temporary files', async () => {
    const { detector, removed } = setup([0, 0, 0], [1, 3]);
    await expect(detector.detect(pixels)).rejects.toThrow('unexpected layout output 1×3');
    expect(removed()).toBe(1);
  });
});
