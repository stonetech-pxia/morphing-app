import { describe, expect, it } from 'vitest';

import { findLines, findTables } from './lines';
import { glyphs, gridRects, renderPage, type Rect } from './test-helpers';

const W = 1000;
const H = 1400;
const grey = (rects: readonly Rect[], shade: number) => rects.map((r) => ({ ...r, shade }));

describe('light rules (Word)', () => {
  // 电子版模板的浅灰线（EU 样本 001、006）：最暗的通道约 0.8，白纸上的 Sauvola 阈值只有 0.7。
  const lightGrid = grey(gridRects([100, 400, 900], [300, 360, 420, 480]), 205);

  it('finds a light grey grid only when asked for light rules', () => {
    const image = renderPage(W, H, [...lightGrid, ...glyphs(120, 320, 200)]);
    expect(findTables(findLines(image, { skew: 0 }))).toHaveLength(0);
    const tables = findTables(findLines(image, { skew: 0, light: true }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs).toHaveLength(4);
    expect(tables[0]!.vs).toHaveLength(3);
  });

  it('does not take light shading for lines, even with text on it', () => {
    const shading: Rect[] = [
      { x: 100, y: 200, width: 800, height: 120, shade: 215 },
      { x: 100, y: 600, width: 800, height: 6, shade: 215 },
      { x: 100, y: 700, width: 800, height: 40, shade: 225 },
    ];
    const text = [...glyphs(120, 230, 600), ...glyphs(120, 262, 600), ...glyphs(120, 712, 600)];
    const found = findLines(renderPage(W, H, [...shading, ...text]), { skew: 0, light: true });
    // 只有 6 像素高、两边是白纸的那一条算线。
    expect(found.horizontal.map((h) => Math.round(h.pos))).toEqual([603]);
    expect(found.vertical).toHaveLength(0);
  });

  it('ignores light rules on paper that is not white (photos)', () => {
    const paper: Rect = { x: 0, y: 0, width: W, height: H, shade: 200 };
    const image = renderPage(W, H, [...lightGrid.map((r) => ({ ...r, shade: 160 })), paper]);
    expect(findTables(findLines(image, { skew: 0, light: true }))).toHaveLength(0);
  });
});

describe('findTables: rules above a grid', () => {
  it('does not chain section underlines far above a grid into it', () => {
    // 会议纪要：各节标题下面一条横线，彼此隔着整段文字；最后一节下面是一张网格。
    const underlines: Rect[] = [100, 340, 580].map((y) => ({ x: 100, y, width: 802, height: 2 }));
    const image = renderPage(W, H, [
      ...underlines,
      ...gridRects([100, 500, 900], [600, 640, 680, 720]),
    ]);
    // 三条分隔线自己是一串（只有横线、分不出列，组表时会丢掉），网格从 600 起，不连上去。
    const grid = findTables(findLines(image, { skew: 0 })).find((t) => t.vs.length > 0)!;
    expect(Math.abs(grid.box.y - 600)).toBeLessThan(4);
    expect(grid.hs).toHaveLength(4);
  });

  it('still chains header rules spaced like the grid rows', () => {
    // 表头上面几条横线和网格的行一样高（IRS Schedule D 的表头），是同一张表。
    const rules: Rect[] = [480, 520, 560].map((y) => ({ x: 100, y, width: 802, height: 2 }));
    const image = renderPage(W, H, [...rules, ...gridRects([100, 500, 900], [600, 640, 680, 720])]);
    const tables = findTables(findLines(image, { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(Math.abs(tables[0]!.box.y - 480)).toBeLessThan(4);
  });

  it('does not chain fill-in rules across a grid between them', () => {
    // 发票右边一列填写横线：上面三条、隔着整张商品栏、下面三条（EU 样本 001），是上下两串，不是一张高高的表。
    const fills: Rect[] = [100, 160, 220, 600, 660, 720].map((y) => ({
      x: 700,
      y,
      width: 202,
      height: 2,
    }));
    const image = renderPage(W, H, [
      ...fills,
      ...gridRects([100, 400, 700, 900], [300, 360, 420, 480, 540]),
    ]);
    const tables = findTables(findLines(image, { skew: 0 }));
    for (const t of tables.filter((x) => !x.vs.length)) {
      expect(t.box.y + t.box.height < 300 || t.box.y > 540).toBe(true);
    }
  });
});
