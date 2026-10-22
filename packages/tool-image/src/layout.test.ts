import { describe, expect, it } from 'vitest';

import type { Rect, Size } from './geometry';
import { type StitchSegment, layoutGrid, layoutStitch, layoutWatermark } from './layout';

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 每张输入图片在所有段里覆盖的源行数之和应等于原高度。 */
function sourceRows(segments: StitchSegment[], sizes: Size[]): number[] {
  const rows = sizes.map(() => 0);
  for (const seg of segments) {
    for (const p of seg.placements) {
      rows[p.index] = (rows[p.index] ?? 0) + (p.srcHeight ?? sizes[p.index]?.height ?? 0);
    }
  }
  return rows;
}

describe('layoutStitch', () => {
  it('stacks screenshots vertically at a common width', () => {
    const sizes = [
      { width: 1170, height: 2532 },
      { width: 1170, height: 2532 },
      { width: 2340, height: 1000 },
    ];
    const { segments } = layoutStitch(sizes, { direction: 'vertical', gapPx: 10 });
    expect(segments).toHaveLength(1);
    const seg = segments[0]!;
    expect(seg.width).toBe(1170);
    expect(seg.placements.map((p) => [p.y, p.height])).toEqual([
      [0, 2532],
      [2542, 2532],
      [5084, 500],
    ]);
    expect(seg.height).toBe(5584);
    expect(seg.placements.every((p) => p.srcY === undefined)).toBe(true);
  });

  it('splits into segments when the total exceeds maxSide', () => {
    const sizes = Array.from({ length: 5 }, () => ({ width: 1000, height: 3000 }));
    const { segments } = layoutStitch(sizes, { direction: 'vertical', gapPx: 0, maxSide: 7000 });
    expect(segments.map((s) => s.placements.map((p) => p.index))).toEqual([[0, 1], [2, 3], [4]]);
    for (const seg of segments) expect(seg.height).toBeLessThanOrEqual(7000);
  });

  it('cuts an image taller than maxSide across segments', () => {
    const sizes = [
      { width: 500, height: 400 },
      { width: 1000, height: 50_000 },
      { width: 500, height: 400 },
    ];
    const { segments } = layoutStitch(sizes, { direction: 'vertical', gapPx: 8, maxSide: 16384 });
    for (const seg of segments) {
      expect(seg.width).toBe(500);
      expect(seg.height).toBeLessThanOrEqual(16384);
      const last = seg.placements.at(-1)!;
      expect(last.y + last.height).toBe(seg.height);
    }
    // 长图缩到宽 500 后高 25000：第一段放不下，另起一段切开
    const cut = segments.flatMap((s) => s.placements).filter((p) => p.index === 1);
    expect(cut.length).toBe(2);
    expect(cut.map((p) => p.height)).toEqual([16384, 25000 - 16384]);
    expect(cut[0]).toMatchObject({ y: 0, srcY: 0 });
    expect(cut[1]!.srcY).toBe(cut[0]!.srcHeight);
    expect(sourceRows(segments, sizes)).toEqual([400, 50_000, 400]);
    // 第三张接在切开的最后一段后面
    expect(segments.at(-1)!.placements.map((p) => p.index)).toEqual([1, 2]);
  });

  it('lays out horizontally with an explicit height', () => {
    const { segments } = layoutStitch(
      [
        { width: 400, height: 300 },
        { width: 300, height: 600 },
      ],
      { direction: 'horizontal', gapPx: 4, outputHeight: 600 },
    );
    expect(segments[0]).toEqual({
      width: 800 + 4 + 300,
      height: 600,
      placements: [
        { index: 0, x: 0, y: 0, width: 800, height: 600 },
        { index: 1, x: 804, y: 0, width: 300, height: 600 },
      ],
    });
  });

  it('cuts wide panoramas with source columns', () => {
    const { segments } = layoutStitch([{ width: 30_000, height: 1000 }], {
      direction: 'horizontal',
      gapPx: 0,
      maxSide: 10_000,
    });
    expect(segments.map((s) => s.width)).toEqual([10_000, 10_000, 10_000]);
    expect(segments.map((s) => s.placements[0]?.srcX)).toEqual([0, 10_000, 20_000]);
  });

  it('handles no images', () => {
    expect(layoutStitch([], { direction: 'vertical', gapPx: 0 })).toEqual({ segments: [] });
  });
});

describe('layoutGrid', () => {
  it('lays out a 3×3 grid', () => {
    const grid = layoutGrid(9, {
      columns: 3,
      cellAspect: 1,
      gapPx: 10,
      paddingPx: 20,
      outputWidth: 1080,
    });
    // (1080 - 40 - 20) / 3 = 340
    expect(grid.width).toBe(1080);
    expect(grid.height).toBe(40 + 3 * 340 + 20);
    expect(grid.cells).toHaveLength(9);
    expect(grid.cells[0]).toEqual({ x: 20, y: 20, width: 340, height: 340 });
    expect(grid.cells[8]).toEqual({ x: 720, y: 720, width: 340, height: 340 });
  });

  it('handles partial rows, aspect and leftover pixels', () => {
    const grid = layoutGrid(5, {
      columns: 2,
      cellAspect: 3 / 4,
      gapPx: 7,
      paddingPx: 0,
      outputWidth: 1000,
    });
    // 单元格 496 宽，剩余 1px 落在两侧
    expect(grid.cells[0]).toEqual({ x: 0, y: 0, width: 496, height: 661 });
    expect(grid.height).toBe(3 * 661 + 2 * 7);
    for (const [i, a] of grid.cells.entries()) {
      expect(a.x + a.width).toBeLessThanOrEqual(1000);
      for (const b of grid.cells.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });

  it('rejects a width too small for the columns', () => {
    expect(() =>
      layoutGrid(4, { columns: 4, cellAspect: 1, gapPx: 10, paddingPx: 0, outputWidth: 20 }),
    ).toThrow(RangeError);
  });
});

describe('layoutWatermark', () => {
  const size = { width: 4000, height: 3000 };

  it('places a corner mark inside the margins', () => {
    const opts = { mode: 'corner', relativeSize: 0.2, markAspect: 4 } as const;
    const br = layoutWatermark(size, { ...opts, corner: 'bottomRight' });
    expect(br.angleDeg).toBe(0);
    expect(br.rects).toEqual([{ x: 4000 - 90 - 600, y: 3000 - 90 - 150, width: 600, height: 150 }]);
    expect(layoutWatermark(size, { ...opts, corner: 'topLeft' }).rects[0]).toMatchObject({
      x: 90,
      y: 90,
    });
    expect(layoutWatermark(size, { ...opts, corner: 'center' }).rects[0]).toMatchObject({
      x: 1700,
      y: 1425,
    });
  });

  it('shrinks a mark that would not fit', () => {
    const r = layoutWatermark(
      { width: 1000, height: 100 },
      { mode: 'corner', corner: 'topRight', relativeSize: 5, markAspect: 1 },
    ).rects[0]!;
    expect(r.height).toBeLessThanOrEqual(100 - 2 * 3);
    expect(r.x + r.width).toBeLessThanOrEqual(1000);
  });

  it('tiles the whole image without overlapping marks', () => {
    const tile = layoutWatermark(size, {
      mode: 'tile',
      corner: 'center',
      relativeSize: 0.15,
      markAspect: 5,
      angleDeg: 0,
    });
    expect(tile.rects.length).toBeGreaterThan(10);
    for (const [i, a] of tile.rects.entries()) {
      for (const b of tile.rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
    // 图上任何一点附近都有水印
    const centers = tile.rects.map((r) => [r.x + r.width / 2, r.y + r.height / 2] as const);
    for (let x = 0; x <= 4000; x += 250) {
      for (let y = 0; y <= 3000; y += 250) {
        const nearest = Math.min(...centers.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
        expect(nearest).toBeLessThan(600);
      }
    }
  });

  it('covers the corners when rotated', () => {
    const tile = layoutWatermark(size, {
      mode: 'tile',
      corner: 'center',
      relativeSize: 0.15,
      markAspect: 5,
    });
    expect(tile.angleDeg).toBe(-30);
    const centers = tile.rects.map((r) => [r.x + r.width / 2, r.y + r.height / 2] as const);
    for (const [x, y] of [
      [0, 0],
      [4000, 0],
      [0, 3000],
      [4000, 3000],
      [2000, 1500],
    ] as const) {
      const nearest = Math.min(...centers.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
      expect(nearest).toBeLessThan(500);
    }
    // 只保留与图片有交集的水印
    for (const [cx, cy] of centers) {
      expect(cx).toBeGreaterThan(-500);
      expect(cx).toBeLessThan(4500);
      expect(cy).toBeGreaterThan(-500);
      expect(cy).toBeLessThan(3500);
    }
  });
});
