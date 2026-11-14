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

describe('highlights touching a rule', () => {
  it('keeps a row rule with a highlighted word right under or over it (EU sample 067)', () => {
    // 银行对账单：金额、收款人用绿色荧光笔标出来，色块紧贴着行线（上面或下面）；
    // 一排里上下两块挨着时，从这一排的顶线一直连到底线。
    const ys = [300, 360, 420, 480, 540];
    const rules = gridRects([100, 300, 760, 900], ys, { thickness: 2 });
    const marks: Rect[] = [
      { x: 790, y: 362, width: 90, height: 28, color: [0, 200, 0] },
      { x: 320, y: 422, width: 110, height: 27, color: [0, 200, 0] },
      { x: 320, y: 450, width: 110, height: 30, color: [0, 200, 0] },
      { x: 780, y: 482, width: 100, height: 30, color: [0, 200, 0] },
    ];
    const tables = findTables(findLines(renderPage(W, H, [...rules, ...marks]), { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs.map((h) => Math.round(h.pos / 10) * 10)).toEqual(ys);
  });
});

describe('number badges on box corners', () => {
  it('does not cut a rule out of a box whose corner badge sits on its end (EU sample 068)', () => {
    // 事故报告的编号方块（青色实心，24 像素见方）贴在框的左上角：和顶边连成一块，照旧不当成单独的线。
    const top: Rect = { x: 100, y: 300, width: 400, height: 2 };
    const badge: Rect = { x: 100, y: 300, width: 26, height: 26, color: [0, 170, 230] };
    const found = findLines(renderPage(W, H, [top, badge]), { skew: 0 });
    expect(found.horizontal.filter((h) => Math.abs(h.pos - 301) < 4)).toHaveLength(0);
  });
});

describe('colour-filled cells', () => {
  it('finds the rules around a yellow cell spanning all rows (EU sample 057)', () => {
    // 电费单的价目表：左边一格黄底（#FFCB35，最暗的通道很暗）跨三排，深灰的线围着它。
    const rules = gridRects([100, 330, 650, 900], [300, 360, 420, 480], {
      thickness: 3,
      skipH: [
        [1, 0],
        [2, 0],
      ],
    }).map((r) => ({ ...r, shade: 58 }));
    const fill: Rect = { x: 103, y: 303, width: 227, height: 177, color: [255, 203, 53] };
    const tables = findTables(findLines(renderPage(W, H, [...rules, fill]), { light: true }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs).toHaveLength(4);
    expect(tables[0]!.vs).toHaveLength(4);
  });
});

describe('pale coloured rules', () => {
  it('still finds rules in a pale blue that is bright but not a saturated fill (EU sample 040)', () => {
    // 老发票纸上印的浅蓝格线：亮度 0.76，颜色不浓，按最暗的通道算仍是线；只有又亮又浓的黄底才按亮度算。
    const rules = gridRects([100, 400, 900], [300, 360, 420, 480]).map((r) => ({
      ...r,
      color: [170, 200, 235] as const,
    }));
    const tables = findTables(findLines(renderPage(W, H, rules), { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs).toHaveLength(4);
  });
});

describe('boxes stacked a few pixels apart', () => {
  it('does not join an invoice item table with the tables a few pixels under it (EU sample 054)', () => {
    // 商品表下面隔一条窄窄的白缝：左边一张税额表、右边一个合计框，各有自己的框，
    // 左右的边和商品表的列线在同一条竖线上。
    const items = gridRects([60, 560, 700, 820, 940], [300, 340, 380, 420]);
    const tax = gridRects([60, 260, 400], [428, 458, 488]);
    const totals = gridRects([700, 820, 940], [428, 458, 488, 518]);
    const tables = findTables(
      findLines(renderPage(W, H, [...items, ...tax, ...totals]), { skew: 0 }),
    );
    expect(tables.map((t) => [t.hs.length, t.vs.length])).toEqual([
      [4, 5],
      [3, 3],
      [4, 3],
    ]);
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

describe('findTables: stacked tables in one frame (Word)', () => {
  // 登记表（EU 样本 004）：一个外框里上下两张表，列线不一样，编号列线上下连着。
  const rects = [
    ...gridRects([100, 160, 500, 900], [100, 140, 180, 220]),
    ...gridRects([100, 160, 300, 650, 900], [220, 260, 300, 340]),
  ];

  it('splits where the column lines change', () => {
    const page = findLines(renderPage(W, H, rects), { skew: 0 });
    expect(findTables(page)).toHaveLength(1);
    const parts = findTables(page, { splitStacked: true });
    expect(parts).toHaveLength(2);
    expect(parts.map((t) => [t.hs.length, t.vs.length])).toEqual([
      [4, 4],
      [4, 5],
    ]);
  });

  it('does not split a table under a title row that spans all columns', () => {
    const titled = [
      ...gridRects([100, 900], [60, 100]),
      ...gridRects([100, 300, 650, 900], [100, 140, 180, 220]),
    ];
    const page = findLines(renderPage(W, H, titled), { skew: 0 });
    expect(findTables(page, { splitStacked: true })).toHaveLength(1);
  });

  it('splits two tables side by side under a shared header band (EU sample 090)', () => {
    // 化验申请单：上面整页宽的表头和「Dati paziente」一排，下面左右两张表隔着一道 30 像素的白缝，
    // 两张表的横线各自止于白缝两边，行也对不齐。
    const sideBySide = [
      ...gridRects([50, 950], [60, 120, 150]),
      ...gridRects([50, 100, 300, 420, 480], [150, 180, 210, 240, 270, 300, 330]),
      ...gridRects([510, 700, 820, 950], [150, 185, 220, 255, 290]),
    ];
    const page = findLines(renderPage(W, H, sideBySide), { skew: 0 });
    expect(findTables(page)).toHaveLength(1);
    const parts = findTables(page, { splitStacked: true });
    expect(
      parts.map((t) => [
        Math.round(t.box.x / 10) * 10,
        Math.round(t.box.y / 10) * 10,
        t.hs.length,
        t.vs.length,
      ]),
    ).toEqual([
      [50, 60, 3, 2],
      [50, 150, 7, 5],
      [510, 150, 5, 4],
    ]);
  });

  it('does not split a table whose rows have a gap only in one column', () => {
    // 表身的横线在中间一列断开（那一列是合并的一大格），左右两边的竖线照旧连着：一张表。
    const gapped = [
      ...gridRects([50, 950], [60, 150]),
      ...gridRects([50, 480], [150, 180, 210, 240, 270]),
      ...gridRects([510, 950], [150, 180, 210, 240, 270]),
      { x: 480, y: 150, width: 32, height: 2 },
      { x: 480, y: 270, width: 32, height: 2 },
    ];
    const page = findLines(renderPage(W, H, gapped), { skew: 0 });
    expect(findTables(page, { splitStacked: true })).toHaveLength(1);
  });
});

describe('findTables: rules-only chains', () => {
  it('does not chain the bottom rules of stacked form frames into one table (EU sample 014)', () => {
    // 三节表单框：标题把顶线断开，框不成网格；三条整页宽的底线彼此隔着一整节（都不到页高的 40%）。
    const bottoms: Rect[] = [300, 800, 1300].map((y) => ({ x: 60, y, width: 882, height: 2 }));
    const tables = findTables(findLines(renderPage(W, H, bottoms), { skew: 0 }));
    expect(tables).toHaveLength(0);
  });

  it('still takes a three-line table with a short header and a tall body', () => {
    // 三线表：顶线、表头线隔着一行，表身很高。
    const rules: Rect[] = [300, 340, 900].map((y) => ({ x: 60, y, width: 882, height: 2 }));
    const tables = findTables(findLines(renderPage(W, H, rules), { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs).toHaveLength(3);
  });

  it('does not chain evenly spaced answer lines across a large gap (EU sample 041)', () => {
    // 两组填写横线，每组 5 条、间距 60，中间隔着 240（标题和留白）；再往下一大段以后还有一条。
    const ys = [200, 260, 320, 380, 440, 680, 740, 800, 860, 920, 1300];
    const rules: Rect[] = ys.map((y) => ({ x: 60, y, width: 882, height: 2 }));
    const tables = findTables(findLines(renderPage(W, H, rules), { skew: 0 }));
    expect(tables.map((t) => t.hs.length)).toEqual([5, 5]);
    expect(tables[1]!.box.y).toBeGreaterThan(600);
  });

  it('still chains evenly spaced header rules across a tall table body (EU sample 048)', () => {
    // 表头一排四块字、下面一排小标题，再往下是很高的表身和合计。
    const ys = [200, 240, 280, 560, 600];
    const rules: Rect[] = ys.map((y) => ({ x: 60, y, width: 882, height: 2 }));
    const text = [
      { x: 150, y: 210, width: 80, height: 20 },
      { x: 600, y: 210, width: 80, height: 20 },
      { x: 720, y: 210, width: 60, height: 20 },
      { x: 840, y: 210, width: 60, height: 20 },
      { x: 70, y: 250, width: 300, height: 20 },
    ];
    const tables = findTables(findLines(renderPage(W, H, rules), { skew: 0 }), { text });
    expect(tables.map((t) => t.hs.length)).toEqual([5]);
  });

  it('still chains a ruled table with uneven rows', () => {
    // 每排一条横线、排高不一样（有的格子折成好几行）：照旧是一张表。
    const ys = [200, 240, 280, 420, 460, 640, 680];
    const rules: Rect[] = ys.map((y) => ({ x: 60, y, width: 882, height: 2 }));
    const tables = findTables(findLines(renderPage(W, H, rules), { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs).toHaveLength(7);
  });

  it('starts a rules-only table at the dark header bar on top of it, with its column rule (EU sample 024)', () => {
    // 时刻表：深色表头横条（白字）直接压在第一行上，中间没有横线；下面只有横线，钟点一列右边一条竖线，没有外框。
    const letters = glyphs(160, 310, 200).map((r) => ({ ...r, shade: 255 }));
    const bar: Rect = { x: 100, y: 300, width: 400, height: 36, shade: 60 };
    const rules: Rect[] = [368, 400, 432, 464, 496].map((y) => ({
      x: 100,
      y,
      width: 400,
      height: 2,
    }));
    const column: Rect = { x: 150, y: 336, width: 2, height: 162 };
    const image = renderPage(W, H, [...letters, bar, ...rules, column, ...glyphs(110, 344, 20)]);
    const tables = findTables(findLines(image, { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(Math.abs(tables[0]!.box.y - 300)).toBeLessThan(4);
    expect(tables[0]!.hs.some((h) => Math.abs(h.pos - 336) < 4)).toBe(true);
    expect(tables[0]!.vs.some((v) => Math.abs(v.pos - 151) < 4 && v.to > 490)).toBe(true);
  });
});
