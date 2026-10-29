import { describe, expect, it } from 'vitest';

import {
  DESKEW_LIMIT,
  SHIFT_LIMIT_SHARE,
  deskewAngle,
  flattenMesh,
  flattenSource,
  padMargin,
  paddedSize,
  planRefinement,
  refinedPosition,
  rotatePoint,
  ruleLines,
  textLinesFromProb,
  uvdocInput,
  uvdocSource,
  type PageLine,
  type UvdocWarp,
} from './flatten';

const page = { width: 1700, height: 2400 };

/** 不弯的 UVDoc 网格：每个输出点对着补边后的图上同样的位置。 */
function flatWarp(size = page): UvdocWarp {
  const grid = new Float32Array(2 * 45 * 31);
  for (let y = 0; y < 45; y++) {
    for (let x = 0; x < 31; x++) {
      grid[y * 31 + x] = (x / 30) * 2 - 1;
      grid[45 * 31 + y * 31 + x] = (y / 44) * 2 - 1;
    }
  }
  return { grid, page: size };
}

/** 一条文字行：y = f(x)，x 从 x0 到 x1，每 4 像素一个点。 */
function line(f: (x: number) => number, x0 = 150, x1 = 1550, thickness = 30): PageLine {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = x0; x <= x1; x += 4) {
    xs.push(x);
    ys.push(f(x));
  }
  const angle = (Math.atan((f(x1) - f(x0)) / (x1 - x0)) * 180) / Math.PI;
  return { xs, ys, thickness, length: x1 - x0, long: true, angle };
}

const lines = (n: number, f: (x: number, row: number) => number) =>
  Array.from({ length: n }, (_, row) => line((x) => f(x, row)));

describe('flatten: model input and grid', () => {
  it('pads 6% of the long side on every side', () => {
    expect(padMargin(page)).toBe(144);
    expect(paddedSize(page)).toEqual({ width: 1988, height: 2688 });
  });

  it('makes a BGR tensor scaled to 0–1', () => {
    const data = new Uint8Array(488 * 712 * 4);
    data.set([255, 51, 0, 255]);
    const t = uvdocInput({ width: 488, height: 712, data });
    const plane = 488 * 712;
    expect(t[0]).toBe(0);
    expect(t[plane]).toBeCloseTo(0.2, 6);
    expect(t[2 * plane]).toBe(1);
    expect(() => uvdocInput({ width: 10, height: 10, data: new Uint8Array(400) })).toThrow();
  });

  it('maps an unbent page back onto itself, without the padding, and clamps points off the paper', () => {
    const warp = flatWarp();
    for (const p of [
      { x: 0, y: 0 },
      { x: 850, y: 1200 },
      { x: 1699, y: 2399 },
    ]) {
      const s = uvdocSource(warp, p.x, p.y);
      // 补边后的网格：页面点在补边图上的相对位置不同于页面上的，所以只检查补边边界和中心。
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(2399);
    }
    expect(uvdocSource(warp, 849.5, 1199.5).x).toBeCloseTo(849.5, 0);
    // 输出的边对着补边图的边，落在纸外，夹到纸边上。
    expect(uvdocSource(warp, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(uvdocSource(warp, 1699, 2399)).toEqual({ x: 1699, y: 2399 });
  });
});

describe('flatten: text lines', () => {
  it('finds horizontal text blocks on the probability map, with their centre line and height', () => {
    const w = 400;
    const h = 600;
    const prob = new Uint8Array(w * h);
    // 一条斜一点的行（10 像素高）、一个竖条（不是行）、一块概率不够的。
    for (let x = 40; x < 360; x++) {
      const y0 = 100 + Math.round(x / 40);
      for (let y = y0; y < y0 + 10; y++) prob[y * w + x] = 230;
    }
    for (let y = 300; y < 500; y++) for (let x = 50; x < 60; x++) prob[y * w + x] = 230;
    for (let x = 100; x < 300; x++) for (let y = 400; y < 410; y++) prob[y * w + x] = 100;
    const found = textLinesFromProb(prob, w, h, { width: 1600, height: 2400 });
    expect(found).toHaveLength(1);
    const [l] = found;
    // 换算到页面：放大 4 倍。
    expect(l!.thickness).toBeCloseTo(40, 0);
    expect(l!.xs[0]).toBe(160);
    expect(l!.ys[0]).toBeCloseTo((100 + 1 + 4.5) * 4, 0);
    expect(l!.angle).toBeCloseTo((Math.atan(1 / 40) * 180) / Math.PI, 1);
    expect(l!.long).toBe(true);
  });

  it('finds long table rules, horizontal and vertical', () => {
    const w = 1000;
    const h = 1400;
    const gray = new Uint8Array(w * h).fill(235);
    for (let x = 100; x < 900; x++) gray[700 * w + x] = gray[701 * w + x] = 30;
    for (let y = 200; y < 1200; y++) gray[y * w + 500] = gray[y * w + 501] = 30;
    // 一行字（短横段）不是表格线。
    for (let x = 100; x < 160; x++) gray[300 * w + x] = 30;
    const target = { width: 1000, height: 1400 };
    const h1 = ruleLines(gray, w, h, target, false);
    const v1 = ruleLines(gray, w, h, target, true);
    expect(h1).toHaveLength(1);
    expect(v1).toHaveLength(1);
    expect(h1[0]!.ys[10]).toBeCloseTo(700.5, 0);
    expect(v1[0]!.xs[10]).toBeCloseTo(500.5, 0);
  });
});

describe('flatten: refining by the text lines', () => {
  it('skips pages with fewer than five lines', () => {
    const r = planRefinement(
      page,
      lines(4, (x, row) => 400 + row * 100 + 20 * Math.sin(x / 200)),
    );
    expect(r.lines).toBe(0);
    expect(r.angle).toBe(0);
    expect(r.dy.every((v) => v === 0)).toBe(true);
  });

  it('turns the page by the common tilt of the lines, at most ±0.5°', () => {
    const tilt = (deg: number) =>
      lines(10, (x, row) => 300 + row * 150 + Math.tan((deg * Math.PI) / 180) * x);
    const r = planRefinement(page, tilt(0.3));
    expect(r.angle).toBeCloseTo(0.3, 2);
    // 输出页上一条水平线，取的是原来那条斜线。
    const yAt = (x: number) => 300 + 4 * 150 + Math.tan((0.3 * Math.PI) / 180) * x;
    const target = rotatePoint(page, 0.3, { x: 850, y: yAt(850) }).y;
    for (const x of [200, 850, 1500]) {
      expect(flattenSource(page, null, r, x, target).y).toBeCloseTo(yAt(x), 0);
    }
    expect(planRefinement(page, tilt(2)).angle).toBe(DESKEW_LIMIT);
    expect(planRefinement(page, tilt(0.05)).angle).toBe(0);
  });

  it('does not turn the page by the text when there is exactly one vertical rule', () => {
    const text = lines(10, (x, row) => 300 + row * 150 + 0.005 * x);
    const rule: PageLine = { ...line(() => 0), xs: [800, 800], ys: [200, 2200], length: 2000 };
    expect(deskewAngle(text, [], [rule])).toBe(0);
    expect(deskewAngle(text, [], [rule, rule])).toBeGreaterThan(0.1);
  });

  it('straightens wavy lines: each output row follows its own bent line', () => {
    const wave = (x: number, row: number) => 400 + row * 160 + 12 * Math.sin(x / 180 + row);
    const r = planRefinement(page, lines(10, wave));
    expect(r.lines).toBe(10);
    for (const row of [2, 5, 8]) {
      const xs = [300, 600, 900, 1200];
      // 目标高度是这条行的平均高度：沿着输出页上的水平线取样，应该落在弯的行上。
      let mean = 0;
      for (let x = 150; x <= 1550; x += 4) mean += wave(x, row);
      mean /= Math.floor(1400 / 4) + 1;
      for (const x of xs) {
        expect(Math.abs(flattenSource(page, null, r, x, mean).y - wave(x, row))).toBeLessThan(2.5);
      }
    }
  });

  it('never moves anything by more than 2% of the long side', () => {
    const huge = (x: number, row: number) => 400 + row * 160 + 300 * Math.sin(x / 300);
    const r = planRefinement(page, lines(10, huge));
    const lim = SHIFT_LIMIT_SHARE * 2400;
    expect(Math.max(...r.dy.map(Math.abs))).toBeLessThanOrEqual(lim + 1e-6);
    expect(Math.max(...r.dy.map(Math.abs))).toBeGreaterThan(lim * 0.9);
  });

  it('interpolates between lines and keeps the shift constant beyond the first and last', () => {
    // 上半页的行往下弯 6 像素，下半页的行不弯：中间按高度线性过渡。
    const r = planRefinement(
      page,
      lines(
        10,
        (x, row) => 300 + row * 200 + (row < 5 ? 6 * Math.sin((Math.PI * (x - 150)) / 1400) : 0),
      ),
    );
    const mid = (y: number) => flattenSource(page, null, r, 850, y).y - y;
    expect(mid(500)).toBeGreaterThan(2);
    expect(Math.abs(mid(2100))).toBeLessThan(0.5);
    // 第一行以上取第一行的位移。
    expect(mid(100)).toBeCloseTo(mid(320), 0);
  });

  it('maps found points onto the refined page (the inverse of the mesh)', () => {
    const r = planRefinement(
      page,
      lines(10, (x, row) => 300 + row * 160 + 8 * Math.sin(x / 150)),
    );
    for (const p of [
      { x: 400, y: 700 },
      { x: 1200, y: 1500 },
    ]) {
      const q = refinedPosition(page, r, p);
      const back = flattenSource(page, null, r, q.x, q.y);
      expect(back.x).toBeCloseTo(p.x, 1);
      expect(back.y).toBeCloseTo(p.y, 1);
    }
  });
});

describe('flatten: one mesh for one resampling', () => {
  it('covers the whole canvas and samples the page itself when nothing is bent', () => {
    const mesh = flattenMesh(page, null, null);
    const n = mesh.positions.length / 2;
    expect(n).toBeLessThan(65_536);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.reduce((a, b) => Math.max(a, b), 0)).toBe(n - 1);
    for (let i = 0; i < n; i += 97) {
      const x = mesh.positions[i * 2]!;
      const y = mesh.positions[i * 2 + 1]!;
      // 画布边缘（0 和 1700）对着第一个、最后一个像素的外沿：纹理坐标夹在像素中心以内。
      expect(mesh.texcoords[i * 2]).toBeCloseTo(Math.min(Math.max(x, 0.5), 1699.5), 3);
      expect(mesh.texcoords[i * 2 + 1]).toBeCloseTo(Math.min(Math.max(y, 0.5), 2399.5), 3);
    }
  });

  it('scales the vertices for a smaller canvas but keeps the texture on the page', () => {
    const small = flattenMesh(page, flatWarp(), null, { width: 850, height: 1200 });
    const full = flattenMesh(page, flatWarp(), null);
    expect(small.positions.length).toBe(full.positions.length);
    expect(small.positions[small.positions.length - 2]).toBe(850);
    expect(small.texcoords).toEqual(full.texcoords);
  });
});
