import { describe, expect, it } from 'vitest';

import {
  clampQuad,
  defaultQuad,
  isConvexQuad,
  orderQuad,
  quadArea,
  scaleQuad,
  warpSize,
  type Quad,
} from './quad';

const paper: Quad = {
  tl: { x: 100, y: 120 },
  tr: { x: 900, y: 80 },
  br: { x: 950, y: 1200 },
  bl: { x: 60, y: 1150 },
};

describe('scan quads', () => {
  it('orders four corners found in any order', () => {
    const shuffled = [paper.br, paper.tl, paper.bl, paper.tr];
    expect(orderQuad(shuffled)).toEqual(paper);
    expect(() => orderQuad([paper.tl])).toThrow();
  });

  it('starts with an inset frame when no paper was found, and scales between preview and photo', () => {
    const q = defaultQuad({ width: 1000, height: 2000 }, 0.1);
    expect(q.tl).toEqual({ x: 100, y: 200 });
    expect(q.br).toEqual({ x: 900, y: 1800 });
    expect(scaleQuad(q, 2).br).toEqual({ x: 1800, y: 3600 });
    expect(isConvexQuad(q)).toBe(true);
  });

  it('keeps corners inside the photo', () => {
    const out = clampQuad(
      { ...paper, tl: { x: -20, y: 5 }, br: { x: 1300, y: 1500 } },
      { width: 1000, height: 1300 },
    );
    expect(out.tl).toEqual({ x: 0, y: 5 });
    expect(out.br).toEqual({ x: 1000, y: 1300 });
  });

  it('rejects crossed or collapsed corners', () => {
    expect(isConvexQuad(paper)).toBe(true);
    // 右上和右下拖反了：边交叉。
    expect(isConvexQuad({ ...paper, tr: paper.br, br: paper.tr })).toBe(false);
    // 三个角挤在一起：面积太小。
    const tiny: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    };
    expect(quadArea(tiny)).toBe(1);
    expect(isConvexQuad(tiny, 100)).toBe(false);
  });

  it('sizes the straightened page from the longer opposite edges, capped at the long side', () => {
    expect(warpSize(paper, 10000)).toEqual({ width: 891, height: 1121 });
    const capped = warpSize(paper, 1000);
    expect(Math.max(capped.width, capped.height)).toBe(1000);
    expect(capped.width / capped.height).toBeCloseTo(891 / 1121, 2);
  });
});
