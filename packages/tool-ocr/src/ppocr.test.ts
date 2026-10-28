import { describe, expect, it } from 'vitest';

import { convexHull, minAreaRect, rectCorners, unclipRect, type Point } from './geometry';
import {
  ctcDecode,
  detectionInput,
  detectionSize,
  recognitionInput,
  recognizePage,
  textBoxes,
  type OcrModels,
  type RgbaImage,
} from './ppocr';

/** 一个转了 deg 度的矩形里的整数点。 */
function rotatedRectPoints(cx: number, cy: number, w: number, h: number, deg: number): Point[] {
  const a = (deg * Math.PI) / 180;
  const pts: Point[] = [];
  for (let u = -w / 2; u <= w / 2; u += 0.5) {
    for (let v = -h / 2; v <= h / 2; v += 0.5) {
      pts.push({
        x: Math.round(cx + u * Math.cos(a) - v * Math.sin(a)),
        y: Math.round(cy + u * Math.sin(a) + v * Math.cos(a)),
      });
    }
  }
  return pts;
}

/** 概率图：给定的矩形区域是 230（约 0.9），其余是 0。 */
function probMap(width: number, height: number, rects: Point[][]): Uint8Array {
  const map = new Uint8Array(width * height);
  for (const pts of rects) for (const p of pts) map[p.y * width + p.x] = 230;
  return map;
}

describe('geometry (D-269)', () => {
  it('finds the convex hull', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 1, y: 2 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it('finds the rotated rectangle around a tilted line of text', () => {
    const rect = minAreaRect(rotatedRectPoints(100, 80, 120, 20, 10));
    expect(Math.max(rect.w, rect.h)).toBeGreaterThan(116);
    expect(Math.max(rect.w, rect.h)).toBeLessThan(124);
    expect(Math.min(rect.w, rect.h)).toBeGreaterThan(18);
    expect(Math.min(rect.w, rect.h)).toBeLessThan(24);
    expect(rect.cx).toBeCloseTo(100, 0);
    expect(rect.cy).toBeCloseTo(80, 0);
  });

  it('orders corners top-left, top-right, bottom-right, bottom-left', () => {
    const [tl, tr, br, bl] = rectCorners(minAreaRect(rotatedRectPoints(100, 80, 120, 20, 5)));
    expect(tl.x).toBeLessThan(tr.x);
    expect(bl.x).toBeLessThan(br.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect(tr.y).toBeLessThan(br.y);
  });

  it('grows a box by area × ratio ÷ perimeter on every side', () => {
    const rect = { cx: 0, cy: 0, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, w: 100, h: 20 };
    const grown = unclipRect(rect, 1.5);
    const d = (100 * 20 * 1.5) / 240;
    expect(grown.w).toBeCloseTo(100 + 2 * d);
    expect(grown.h).toBeCloseTo(20 + 2 * d);
  });
});

describe('text boxes from the probability map (D-269)', () => {
  it('finds each line, scales it to the page and orders top to bottom, left to right', () => {
    const w = 200;
    const h = 120;
    const map = probMap(w, h, [
      rotatedRectPoints(150, 30, 60, 10, 0),
      rotatedRectPoints(50, 31, 60, 10, 0),
      rotatedRectPoints(100, 90, 150, 12, 3),
    ]);
    const boxes = textBoxes(map, w, h, { width: 400, height: 240 });
    expect(boxes).toHaveLength(3);
    // 换算到 2 倍大的原图，同一行里左边的在前。
    expect(boxes[0]!.quad[0].x).toBeLessThan(boxes[1]!.quad[0].x);
    expect(boxes[0]!.quad[0].x).toBeGreaterThan(20);
    expect(boxes[0]!.quad[0].x).toBeLessThan(80);
    // 第三行中心在 y = 90（原图 180），往外扩约 8 像素、再转 3°，左上角在原图 140 左右。
    expect(boxes[2]!.quad[0].y).toBeGreaterThan(125);
    expect(boxes[2]!.quad[0].y).toBeLessThan(155);
    // 往外扩了：比文字本身宽。
    const width = boxes[2]!.quad[1].x - boxes[2]!.quad[0].x;
    expect(width).toBeGreaterThan(300);
    for (const b of boxes) expect(b.score).toBeGreaterThan(0.8);
  });

  it('drops specks and faint blobs', () => {
    const w = 100;
    const h = 60;
    const map = probMap(w, h, [rotatedRectPoints(20, 20, 2, 2, 0)]);
    // 一块很淡的（低于框的门槛 0.6，但高于像素门槛 0.3）。
    for (let y = 40; y < 50; y++) for (let x = 40; x < 90; x++) map[y * w + x] = 100;
    expect(textBoxes(map, w, h, { width: w, height: h })).toEqual([]);
  });
});

describe('model inputs (D-269)', () => {
  const image = (width: number, height: number, rgb: [number, number, number]): RgbaImage => {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
    return { width, height, data };
  };

  it('sizes the detection input to multiples of 32, enlarging small pages', () => {
    expect(detectionSize(1600, 2000)).toEqual({ width: 1600, height: 2016 });
    expect(detectionSize(368, 500)).toEqual({ width: 736, height: 992 });
  });

  it('normalizes in BGR order, the same with and without resizing', () => {
    const exact = detectionInput(image(64, 96, [255, 0, 0]), 32);
    const plane = 64 * 96;
    // 红色：B 通道（第 0 个）是 0，R 通道（第 2 个）是 255。
    expect(exact.tensor[0]).toBeCloseTo((0 - 0.485) / 0.229, 4);
    expect(exact.tensor[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 4);
    const resized = detectionInput(image(70, 100, [255, 0, 0]), 32);
    expect(resized.width).toBe(64);
    expect(resized.tensor[0]).toBeCloseTo(exact.tensor[0]!, 4);
    expect(resized.tensor[2 * plane]).toBeCloseTo(exact.tensor[2 * plane]!, 4);
  });

  it('crops lines to 48 pixels high, at least 320 wide, and turns tall boxes', () => {
    const page = image(400, 400, [255, 255, 255]);
    // 左边一列是黑的：横着的框里它在左边，竖着的框转过之后它在下面。
    for (let y = 0; y < 400; y++) page.data.set([0, 0, 0], (y * 400 + 10) * 4);
    const wide = [
      { x: 10, y: 10 },
      { x: 210, y: 10 },
      { x: 210, y: 50 },
      { x: 10, y: 50 },
    ];
    const tall = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 210 },
      { x: 10, y: 210 },
    ];
    const input = recognitionInput(page, [wide, tall]);
    expect(input.width).toBe(320);
    const plane = 48 * 320;
    expect(input.tensor).toHaveLength(2 * 3 * plane);
    // 第一条：最左一列是黑（-1），右边是白（1），补零的地方是 0。
    expect(input.tensor[20 * 320]).toBeCloseTo(-1, 1);
    expect(input.tensor[20 * 320 + 100]).toBeCloseTo(1, 1);
    expect(input.tensor[20 * 320 + 300]).toBe(0);
    // 第二条（逆时针转 90°）：原来最左的一列到了最下面一行。
    const second = 3 * plane;
    expect(input.tensor[second + 47 * 320 + 100]).toBeLessThan(0);
    expect(input.tensor[second + 10 * 320 + 100]).toBeCloseTo(1, 1);
  });
});

describe('CTC decoding (D-269)', () => {
  it('drops blanks and repeats, and averages the kept probabilities', () => {
    const dict = ['a', 'b', 'c'];
    // 时间步：a a 空 a b b 空
    const index = [1, 1, 0, 1, 2, 2, 0];
    const prob = [0.9, 0.8, 0.99, 0.7, 0.6, 0.5, 0.99];
    const r = ctcDecode(index, prob, 7, 0, dict);
    expect(r.text).toBe('aab');
    expect(r.score).toBeCloseTo((0.9 + 0.7 + 0.6) / 3);
    expect(ctcDecode([0, 0], [1, 1], 2, 0, dict)).toEqual({ text: '', score: 0 });
  });
});

describe('recognizePage (D-269)', () => {
  it('runs detection, crops each line and keeps only confident text, in reading order', async () => {
    const page: RgbaImage = { width: 256, height: 128, data: new Uint8Array(256 * 128 * 4) };
    const seen: { count: number; width: number }[] = [];
    const models: OcrModels = {
      async detect(_input, width, height) {
        expect([width, height]).toEqual([736 * 2, 736]);
        return probMap(width, height, [
          rotatedRectPoints(400, 200, 300, 40, 0),
          rotatedRectPoints(400, 500, 300, 40, 0),
        ]);
      },
      async recognize(_input, count, width) {
        seen.push({ count, width });
        // 第一条认成「你好」，第二条置信度太低。
        const steps = 4;
        return {
          steps,
          index: Int32Array.from([1, 0, 2, 0, 3, 3, 0, 0]),
          prob: Float32Array.from([0.9, 1, 0.8, 1, 0.2, 0.3, 1, 1]),
        };
      },
    };
    const lines = await recognizePage(page, models, ['你', '好', '吗']);
    expect(seen).toEqual([{ count: 2, width: expect.any(Number) }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('你好');
    // 框换算回原图（检测时放大了 736 / 128 倍）。
    expect(lines[0]!.y).toBeLessThan(50);
    expect(lines[0]!.width).toBeGreaterThan(50);
  });
});
