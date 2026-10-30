import { describe, expect, it } from 'vitest';

import { buildTablePage, sharedColumns } from './build';
import { findLines, findTables } from './lines';
import { fakeLine, glyphs, gridRects, renderPage, type Rect } from './test-helpers';
import type { OcrBox, TableBlock, TablePage } from './types';

const W = 1000;
const H = 700;

const tablesOf = (page: TablePage) =>
  page.blocks.filter((b): b is TableBlock => b.kind === 'table');
/** 行数和第一行有几格（列对齐到整页共用的列以后，cols 是共用列的个数，不是一行的格数）。 */
const shapeOf = (t: TableBlock) => [t.rows, t.cells.filter((c) => c.row === 0).length];
const cellAt = (t: TableBlock, row: number, col: number) =>
  t.cells.find(
    (c) => c.row <= row && row < c.row + c.rowSpan && c.col <= col && col < c.col + c.colSpan,
  );

/** 每格中间一行字（框 120×24），文字是「r行c列」。 */
function cellTexts(
  xs: number[],
  ys: number[],
  deg = 0,
  skip: (r: number, c: number) => boolean = () => false,
) {
  const lines: OcrBox[] = [];
  const marks: Rect[] = [];
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      if (skip(r, c)) continue;
      const box = {
        x: (xs[c]! + xs[c + 1]!) / 2 - 60,
        y: (ys[r]! + ys[r + 1]!) / 2 - 12,
        width: 120,
        height: 24,
      };
      lines.push(fakeLine(`r${r}c${c}`, box, { width: W, height: H, deg }));
      marks.push(...glyphs(box.x + 10, box.y + 4, 100));
    }
  }
  return { lines, marks };
}

const build = (rects: Rect[], lines: OcrBox[], deg = 0) =>
  buildTablePage({
    image: renderPage(W, H, rects, deg),
    lines,
    name: 'Page 1',
    source: 'file:///page.jpg',
  });

describe('table structure from ruled lines (D-272)', () => {
  const xs = [100, 300, 500, 700, 900];
  const ys = [100, 160, 220, 280];

  it('reads a fully ruled 3 × 4 table and puts each text line in its cell', () => {
    const { lines, marks } = cellTexts(xs, ys);
    const page = build([...gridRects(xs, ys), ...marks], lines);
    const [table, ...others] = tablesOf(page);
    expect(others).toHaveLength(0);
    expect(table!.rows).toBe(3);
    expect(table!.cols).toBe(4);
    expect(table!.cells).toHaveLength(12);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) expect(cellAt(table!, r, c)!.text).toBe(`r${r}c${c}`);
    // 列宽是原图像素（每列 200）。
    for (const w of page.colWidths) expect(Math.abs(w - 200)).toBeLessThan(6);
    // 没有表外的文字。
    expect(page.blocks.filter((b) => b.kind === 'text')).toHaveLength(0);
  });

  it('joins broken lines (photocopies) instead of merging cells', () => {
    const { lines, marks } = cellTexts(xs, ys);
    const page = build([...gridRects(xs, ys, { breakEvery: 120 }), ...marks], lines);
    const [table] = tablesOf(page);
    expect(table!.rows).toBe(3);
    expect(table!.cols).toBe(4);
    expect(table!.cells.every((c) => c.rowSpan === 1 && c.colSpan === 1)).toBe(true);
  });

  it('finds merged cells where an edge has no line', () => {
    // 第一行的第 2、3 列之间没有竖线；第 1 列的第 2、3 行之间没有横线。
    const skip = (r: number, c: number) => (r === 0 && c === 2) || (r === 2 && c === 0);
    const { lines, marks } = cellTexts(
      xs,
      ys,
      0,
      (r, c) => skip(r, c) || (r === 0 && c === 1) || (r === 1 && c === 0),
    );
    lines.push(
      fakeLine('header', { x: 440, y: 118, width: 120, height: 24 }, { width: W, height: H }),
    );
    lines.push(
      fakeLine('tall', { x: 140, y: 208, width: 120, height: 24 }, { width: W, height: H }),
    );
    const rects = gridRects(xs, ys, { skipV: [[2, 0]], skipH: [[2, 0]] });
    const page = build([...rects, ...marks], lines);
    const [table] = tablesOf(page);
    expect(table!.rows).toBe(3);
    expect(table!.cols).toBe(4);
    const header = cellAt(table!, 0, 1)!;
    expect(header).toMatchObject({ row: 0, col: 1, rowSpan: 1, colSpan: 2, text: 'header' });
    expect(cellAt(table!, 0, 2)).toBe(header);
    const tall = cellAt(table!, 1, 0)!;
    expect(tall).toMatchObject({ row: 1, col: 0, rowSpan: 2, colSpan: 1, text: 'tall' });
    // 3 × 4 = 12 个位置，两个合并格各占 2 个。
    expect(table!.cells).toHaveLength(10);
  });

  it('handles a page photographed 1° off', () => {
    const deg = 1;
    const { lines, marks } = cellTexts(xs, ys, deg);
    const image = renderPage(W, H, [...gridRects(xs, ys), ...marks], deg);
    const found = findLines(image);
    expect(Math.abs(found.skew - deg)).toBeLessThan(0.25);
    const page = buildTablePage({ image, lines, name: 'p', source: 's' });
    const [table, ...others] = tablesOf(page);
    expect(others).toHaveLength(0);
    expect(table!.rows).toBe(3);
    expect(table!.cols).toBe(4);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) expect(cellAt(table!, r, c)!.text).toBe(`r${r}c${c}`);
    // 截图用的框在原图坐标里：格子 (2, 3) 的中心大致在转过以后的位置。
    const box = cellAt(table!, 2, 3)!.box!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const expected = fakeLine(
      'x',
      { x: 800, y: 250, width: 0, height: 0 },
      { width: W, height: H, deg },
    );
    expect(Math.abs(cx - expected.x)).toBeLessThan(8);
    expect(Math.abs(cy - expected.y)).toBeLessThan(8);
  });

  it('does not treat underlines or strikethroughs as table lines', () => {
    const { lines, marks } = cellTexts(xs, ys);
    const page1 = { width: W, height: H };
    const extra: Rect[] = [
      // 表格上面一行字，下面有一条划线。
      ...glyphs(100, 40, 300),
      { x: 100, y: 62, width: 300, height: 2 },
      // 表格下面一行字，中间有删除线。
      ...glyphs(100, 400, 300),
      { x: 95, y: 407, width: 310, height: 2 },
      // 表格里一格的字下面有一条划线（不碰到竖线）。
      { x: 330, y: 204, width: 140, height: 2 },
    ];
    lines.push(fakeLine('underlined title', { x: 100, y: 38, width: 300, height: 22 }, page1));
    lines.push(fakeLine('struck out', { x: 100, y: 398, width: 300, height: 22 }, page1));
    const page = build([...gridRects(xs, ys), ...marks, ...extra], lines);
    const tables = tablesOf(page);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toBe(3);
    expect(tables[0]!.cols).toBe(4);
    const texts = page.blocks.filter((b) => b.kind === 'text').map((b) => b.text);
    expect(texts).toEqual(['underlined title', 'struck out']);
    // 阅读顺序：上面的字、表格、下面的字。
    expect(page.blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text']);
  });

  it('finds no table on a page with only a separator line and text', () => {
    const page1 = { width: W, height: H };
    const rects = [
      ...glyphs(100, 100, 600),
      { x: 80, y: 200, width: 840, height: 2 },
      ...glyphs(100, 260, 600),
    ];
    const lines = [
      fakeLine('first paragraph', { x: 100, y: 98, width: 600, height: 22 }, page1),
      fakeLine('second paragraph', { x: 100, y: 258, width: 600, height: 22 }, page1),
    ];
    const page = build(rects, lines);
    expect(tablesOf(page)).toHaveLength(0);
    expect(page.blocks.map((b) => b.kind === 'text' && b.text)).toEqual([
      'first paragraph',
      'second paragraph',
    ]);
  });

  it('does not take a solid black bar for a line', () => {
    const lines = findLines(renderPage(W, H, [{ x: 100, y: 100, width: 600, height: 40 }]));
    expect(lines.horizontal).toHaveLength(0);
  });

  it('splits a text line that runs across a vertical line, at the character positions', () => {
    const gx = [100, 400, 700];
    const gy = [100, 160, 220];
    const page1 = { width: W, height: H };
    const lines = [
      fakeLine('左边内容右边内容', { x: 150, y: 118, width: 500, height: 24 }, page1, true),
      fakeLine('下面', { x: 200, y: 178, width: 60, height: 24 }, page1, true),
    ];
    const page = build(gridRects(gx, gy), lines);
    const [table] = tablesOf(page);
    expect(cellAt(table!, 0, 0)!.text).toBe('左边内容');
    expect(cellAt(table!, 0, 1)!.text).toBe('右边内容');
    expect(cellAt(table!, 1, 0)!.text).toBe('下面');
  });

  it('finds two tables on one page, in reading order', () => {
    const a = cellTexts([100, 400, 700], [80, 130, 180]);
    const b = cellTexts([100, 300, 500, 900], [400, 450, 500, 550]);
    const page = build(
      [
        ...gridRects([100, 400, 700], [80, 130, 180]),
        ...gridRects([100, 300, 500, 900], [400, 450, 500, 550]),
        ...a.marks,
        ...b.marks,
      ],
      [...a.lines, ...b.lines],
    );
    const tables = tablesOf(page);
    expect(tables.map(shapeOf)).toEqual([
      [2, 2],
      [3, 3],
    ]);
  });
});

describe('tables with only horizontal lines (D-272)', () => {
  const page1 = { width: W, height: H };
  const row = (r: number, y: number, texts: string[], centers = [200, 500, 800]) =>
    texts.map((t, c) => fakeLine(t, { x: centers[c]! - 50, y, width: 100, height: 22 }, page1));

  it('finds the columns from the gaps between the text', () => {
    const ys = [100, 150, 200, 250, 300];
    const rects = ys.map((y) => ({ x: 100, y, width: 800, height: 2 }));
    const lines = ys.slice(0, -1).flatMap((y, r) => row(r, y + 14, [`a${r}`, `b${r}`, `c${r}`]));
    const page = build(rects, lines);
    const [table] = tablesOf(page);
    expect(table!.rows).toBe(4);
    expect(table!.cols).toBe(3);
    expect(cellAt(table!, 2, 1)!.text).toBe('b2');
    expect(cellAt(table!, 3, 2)!.text).toBe('c3');
  });

  it('uses the header’s vertical lines for the columns below it', () => {
    const ys = [100, 150, 200, 250, 300];
    const vx = [100, 350, 650, 900];
    const rects: Rect[] = [
      ...ys.map((y) => ({ x: 100, y, width: 802, height: 2 })),
      ...vx.map((x) => ({ x, y: 100, width: 2, height: 52 })),
    ];
    // 表身的字偏左，按文字空隙分会分错；应该按表头的竖线分。
    const lines = [
      ...row(0, 114, ['Name', 'Qty', 'Price'], [225, 500, 775]),
      ...[1, 2, 3].flatMap((r) =>
        row(r, ys[r]! + 14, [`n${r}`, `q${r}`, `p${r}`], [160, 400, 700]),
      ),
    ];
    const page = build(rects, lines);
    const [table] = tablesOf(page);
    expect(table!.cols).toBe(3);
    expect(table!.rows).toBe(4);
    expect(table!.cells.every((c) => c.colSpan === 1 && c.rowSpan === 1)).toBe(true);
    expect(cellAt(table!, 0, 2)!.text).toBe('Price');
    expect(cellAt(table!, 2, 1)!.text).toBe('q2');
    expect(cellAt(table!, 3, 2)!.text).toBe('p3');
  });

  it('splits the body of a three-line table into one row per line of text', () => {
    const rects = [100, 140, 300].map((y) => ({ x: 100, y, width: 800, height: 2 }));
    const lines = [
      ...row(0, 110, ['Item', 'Unit', 'Total']),
      ...[0, 1, 2, 3].flatMap((r) => row(r, 150 + r * 38, [`i${r}`, `u${r}`, `t${r}`])),
    ];
    const page = build(rects, lines);
    const [table] = tablesOf(page);
    expect(table!.cols).toBe(3);
    expect(table!.rows).toBe(5);
    expect(cellAt(table!, 0, 0)!.text).toBe('Item');
    expect(cellAt(table!, 1, 0)!.text).toBe('i0');
    expect(cellAt(table!, 4, 2)!.text).toBe('t3');
  });

  it('keeps a three-line table below a ruled grid of the same width as its own table', () => {
    const xs = [100, 500, 900];
    const ys = [60, 110, 160, 210];
    const grid = cellTexts(xs, ys);
    const rects = [
      ...gridRects(xs, ys),
      ...[330, 370, 540].map((y) => ({ x: 100, y, width: 802, height: 2 })),
    ];
    const lines = [
      ...grid.lines,
      fakeLine('Contacts', { x: 100, y: 280, width: 200, height: 24 }, page1),
      ...row(0, 340, ['Name', 'Phone', 'Days']),
      ...[0, 1, 2].flatMap((r) => row(r, 385 + r * 50, [`n${r}`, `p${r}`, `d${r}`])),
    ];
    const page = build([...rects, ...grid.marks], lines);
    const tables = tablesOf(page);
    expect(tables.map(shapeOf)).toEqual([
      [3, 2],
      [4, 3],
    ]);
    // 两张表中间的标题是表外的文字。
    expect(page.blocks.map((b) => b.kind)).toEqual(['table', 'text', 'table']);
  });

  it('does not make a table out of aligned fill-in blanks with nothing inside', () => {
    const rects = [200, 250, 300].map((y) => ({ x: 300, y, width: 400, height: 2 }));
    const lines = [200, 250, 300].map((y, i) =>
      fakeLine(`Label ${i}:`, { x: 120, y: y - 22, width: 160, height: 22 }, page1),
    );
    const page = build(rects, lines);
    expect(tablesOf(page)).toHaveLength(0);
  });

  it('does not make a table out of prose between aligned rules', () => {
    const rects = [100, 220, 340].map((y) => ({ x: 100, y, width: 800, height: 2 }));
    const lines = [130, 160, 190, 250, 280, 310].map((y, i) =>
      fakeLine(`prose line ${i}`, { x: 110, y, width: 780, height: 22 }, page1),
    );
    const page = build(rects, lines);
    expect(tablesOf(page)).toHaveLength(0);
  });
});

// 用真实扫描件调参时遇到的情况（D-272），每个都从照片里截出最小的合成情形。
describe('cases from real scans (D-272)', () => {
  const page1 = { width: W, height: H };
  /** 一格里的一行字：识别框 + 像字的笔画。 */
  const word = (text: string, x: number, y: number, width = 120, chars = false) => ({
    line: fakeLine(text, { x, y, width, height: 20 }, page1, chars),
    marks: glyphs(x + 4, y + 3, width - 8, 14),
  });
  const page = (rects: Rect[], words: ReturnType<typeof word>[]) =>
    build(
      [...rects, ...words.flatMap((w) => w.marks)],
      words.map((w) => w.line),
    );

  it('keeps two ruled boxes of the same width apart when text sits between them', () => {
    // 税务表：上面一张 2 列的表，中间一段文字，下面一张列不一样的表；左右两端对齐。
    const words = [
      word('nom', 120, 115),
      word('xia', 520, 115),
      word('paragraph between', 120, 230, 500),
      word('pays', 120, 315),
      word('numero', 320, 315),
    ];
    const rects = [
      ...gridRects([100, 500, 900], [100, 150]),
      ...gridRects([100, 300, 900], [300, 350]),
    ];
    const tables = tablesOf(page(rects, words));
    expect(tables.map(shapeOf)).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(cellAt(tables[1]!, 0, 1)!.text).toBe('numero');
  });

  it('does not join two boxes 10 pixels apart into one grid', () => {
    // 工资单：上下挨着的框，列不一样；它们的边不能接成一条线。
    const words = [
      word('a1', 120, 115),
      word('a2', 520, 115),
      word('b1', 120, 225),
      word('b2', 320, 225),
    ];
    const rects = [
      ...gridRects([100, 500, 900], [100, 200]),
      ...gridRects([100, 300, 900], [212, 262]),
    ];
    const tables = tablesOf(page(rects, words));
    expect(tables.map(shapeOf)).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it('reads a table drawn inside a bigger frame (forms)', () => {
    const words = [
      word('form title', 120, 80, 320),
      word('a long note across the whole frame', 100, 500, 800),
      ...[0, 1].flatMap((r) =>
        [0, 1, 2].map((c) => word(`r${r}c${c}`, [120, 420, 720][c]!, 315 + r * 50)),
      ),
    ];
    const rects = [
      ...gridRects([50, 950], [50, 650]),
      ...gridRects([100, 400, 700, 900], [300, 350, 400]),
    ];
    const [table, ...others] = tablesOf(page(rects, words));
    expect(others).toHaveLength(0);
    // 小表的每一格单独一格（外面的框不能把里面的字都拿走）。
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++)
        expect(table!.cells.some((cell) => cell.text === `r${r}c${c}`)).toBe(true);
  });

  it('splits a body ruled only by columns into one row per line, ignoring bold labels', () => {
    // 工资单、账单的表身：竖线到底，行之间没有线；项目名称是粗体（扫描时像一条粗横线）。
    const xs = [100, 400, 650, 900];
    const words = [word('label', 120, 110), word('base', 420, 110), word('amount', 670, 110)];
    const bold: Rect[] = [];
    for (let r = 0; r < 5; r++) {
      const y = 160 + r * 32;
      words.push(word(`item ${r}`, 110, y, 200), word(`${r}00`, 420, y), word(`${r}.5`, 670, y));
      bold.push({ x: 102, y: y + 5, width: 200, height: 10 });
    }
    const rects = [...gridRects(xs, [100, 140, 330]), ...bold];
    const [table, ...others] = tablesOf(page(rects, words));
    expect(others).toHaveLength(0);
    expect([table!.rows, table!.cols]).toEqual([6, 3]);
    for (let r = 0; r < 5; r++) {
      expect(cellAt(table!, r + 1, 0)!.text).toBe(`item ${r}`);
      expect(cellAt(table!, r + 1, 2)!.text).toBe(`${r}.5`);
    }
  });

  it('keeps text that wraps inside one cell together', () => {
    const words = [
      word('long name', 120, 110, 200),
      word('wraps here', 120, 132, 200),
      word('and here', 120, 154, 200),
      word('42', 420, 132),
    ];
    const [table] = tablesOf(page(gridRects([100, 400, 900], [100, 190]), words));
    expect([table!.rows, table!.cols]).toEqual([1, 2]);
    expect(cellAt(table!, 0, 0)!.text.split('\n')).toHaveLength(3);
  });

  it('keeps a form cell of several lines together when only one column has them', () => {
    // 能耗诊断的表头框：左右两格各是几行地址、日期，中间没有横线；只有前两排左右都有字，
    // 下面几排只有左边一列有续行。按排分行会把一格拆成好几行（D-315）。
    const words = [
      word('Logement F44', 120, 110, 200),
      word('Date 21/02', 420, 110, 200),
      word('No 2093N', 120, 135, 200),
      word('Diagnostiqueur', 420, 136, 200),
      word('Valable 2030', 120, 160, 200),
      word('Type Habitation', 120, 185, 200),
      word('Annee 2019', 120, 210, 200),
      word('Surface 62 m2', 120, 260, 200),
      word('Cage C=3', 120, 285, 200),
    ];
    const [table, ...others] = tablesOf(page(gridRects([100, 400, 900], [100, 320]), words));
    expect(others).toHaveLength(0);
    expect([table!.rows, table!.cols]).toEqual([1, 2]);
    expect(cellAt(table!, 0, 0)!.text.split('\n')).toHaveLength(7);
    expect(cellAt(table!, 0, 1)!.text.split('\n')).toEqual(['Date 21/02', 'Diagnostiqueur']);
  });

  it('still splits a body where some rows only have a section label', () => {
    // 工资单：「URSSAF」「Retraite」这种小标题一排只有一格，其他排每列都有字。
    const xs = [100, 400, 650, 900];
    const words = [word('label', 120, 110), word('base', 420, 110), word('amount', 670, 110)];
    const rows = ['URSSAF', 'item 1', 'item 2', 'Retraite', 'item 4'];
    rows.forEach((text, r) => {
      const y = 160 + r * 32;
      words.push(word(text, 110, y, 200));
      if (text.startsWith('item')) words.push(word(`${r}00`, 420, y), word(`${r}.5`, 670, y));
    });
    const [table] = tablesOf(page(gridRects(xs, [100, 140, 330]), words));
    expect([table!.rows, table!.cols]).toEqual([6, 3]);
    expect(cellAt(table!, 1, 0)!.text).toBe('URSSAF');
    expect(cellAt(table!, 2, 2)!.text).toBe('1.5');
  });

  it('keeps column lines that start below an unruled header', () => {
    // 物业账单的批次表：表头有底色、下面没有横线，表头里的竖线断了，只从表身开始。
    const xs = [100, 300, 500, 700, 900];
    const words: ReturnType<typeof word>[] = [];
    for (const [r, y] of [110, 160, 190].entries())
      for (let c = 0; c < 4; c++) words.push(word(`r${r}c${c}`, xs[c]! + 20, y));
    const rects = [
      ...gridRects([100, 700, 900], [100, 250]),
      ...[300, 500].map((x) => ({ x, y: 145, width: 2, height: 107 })),
    ];
    const [table] = tablesOf(page(rects, words));
    expect([table!.rows, table!.cols]).toEqual([3, 4]);
    expect(cellAt(table!, 0, 3)!.text).toBe('r0c3');
    expect(cellAt(table!, 2, 1)!.text).toBe('r2c1');
  });

  it('finds the column lines of a row only 30 pixels high', () => {
    const words = [word('prix', 120, 305), word('6 034,00', 420, 305), word('remise', 720, 305)];
    const [table] = tablesOf(page(gridRects([100, 400, 700, 900], [300, 330]), words));
    expect([table!.rows, table!.cols]).toEqual([1, 3]);
    expect(cellAt(table!, 0, 1)!.text).toBe('6 034,00');
  });

  it('keeps a title whole above a column line that starts below it', () => {
    // 工资单的日历：标题横跨两列，竖线从第二行才开始。
    const words = [
      word('CALENDRIER', 350, 115, 300, true),
      word('jour', 120, 165),
      word('incident', 520, 165),
    ];
    const rects = gridRects([100, 500, 900], [100, 150, 200], { skipV: [[1, 0]] });
    const [table] = tablesOf(page(rects, words));
    expect(cellAt(table!, 0, 0)).toMatchObject({ colSpan: 2, text: 'CALENDRIER' });
    expect(cellAt(table!, 1, 1)!.text).toBe('incident');
  });
});

describe('one grid for the whole page (D-272)', () => {
  const page1 = { width: W, height: H };
  const word = (text: string, x: number, y: number, width = 120) => ({
    line: fakeLine(text, { x, y, width, height: 20 }, page1),
    marks: glyphs(x + 4, y + 3, width - 8, 14),
  });
  const page = (rects: Rect[], words: ReturnType<typeof word>[]) =>
    build(
      [...rects, ...words.flatMap((w) => w.marks)],
      words.map((w) => w.line),
    );
  /** 一张表每一格在整页共用列上的位置：[页上的第一列, 跨几列, 文字]。 */
  const placed = (t: TableBlock) => t.cells.map((c) => [t.col + c.col, c.colSpan, c.text]);

  it('lines up column lines a few pixels apart in two tables on one column', () => {
    const words = [
      word('a', 120, 115),
      word('b', 420, 115),
      word('c', 125, 315),
      word('d', 425, 315),
    ];
    const rects = [
      ...gridRects([100, 400, 700], [100, 150]),
      ...gridRects([105, 404, 696], [300, 350]),
    ];
    const p = page(rects, words);
    const tables = tablesOf(p);
    expect(tables.map(placed)).toEqual([
      [
        [0, 1, 'a'],
        [1, 1, 'b'],
      ],
      [
        [0, 1, 'c'],
        [1, 1, 'd'],
      ],
    ]);
    expect(p.colWidths).toHaveLength(2);
    for (const w of p.colWidths) expect(Math.abs(w - 298)).toBeLessThan(8);
  });

  it('spans the shared columns when one table’s columns are a subset of another’s', () => {
    // 上面 2 列，下面 4 列，下面多出来的竖线把上面的每格分成跨 2 列；格子的内容和合并都不变。
    const words = [
      word('left', 120, 115),
      word('right', 420, 115),
      ...[0, 1, 2, 3].map((c) => word(`x${c}`, 110 + c * 150, 315, 100)),
    ];
    const rects = [
      ...gridRects([100, 400, 700], [100, 150]),
      ...gridRects([100, 250, 400, 550, 700], [300, 350]),
    ];
    const p = page(rects, words);
    const [top, bottom] = tablesOf(p);
    expect(placed(top!)).toEqual([
      [0, 2, 'left'],
      [2, 2, 'right'],
    ]);
    expect(placed(bottom!)).toEqual([0, 1, 2, 3].map((c) => [c, 1, `x${c}`]));
    expect(p.colWidths).toHaveLength(4);
  });

  it('starts a narrower table at its own column of the page grid', () => {
    // 下面的表只占右半边：从第 2 列开始。表外的文字横跨整页的列。
    const words = [
      word('a', 120, 115),
      word('b', 420, 115),
      word('note', 120, 220, 200),
      word('c', 420, 315),
      word('d', 570, 315),
    ];
    const rects = [
      ...gridRects([100, 400, 700], [100, 150]),
      ...gridRects([400, 550, 700], [300, 350]),
    ];
    const p = page(rects, words);
    const [top, bottom] = tablesOf(p);
    expect(placed(top!)).toEqual([
      [0, 1, 'a'],
      [1, 2, 'b'],
    ]);
    expect(placed(bottom!)).toEqual([
      [1, 1, 'c'],
      [2, 1, 'd'],
    ]);
    expect([bottom!.col, bottom!.cols]).toEqual([1, 2]);
  });

  it('never folds two column lines of the same table into one', () => {
    // 同一张表 100 和 110 两条线（容差 20 以内）各算一条；别的表的 104 并进 100。
    const { pos, maps } = sharedColumns(
      [
        [100, 110, 300],
        [104, 300],
      ],
      20,
    );
    expect(pos.map(Math.round)).toEqual([102, 110, 300]);
    expect(maps).toEqual([
      [0, 1, 2],
      [0, 2],
    ]);
  });
});

describe('horizontal alignment (D-272)', () => {
  const page1 = { width: W, height: H };
  const word = (text: string, x: number, y: number, width = 80) => ({
    line: fakeLine(text, { x, y, width, height: 20 }, page1),
    marks: glyphs(x + 4, y + 3, width - 8, 14),
  });
  const page = (rects: Rect[], words: ReturnType<typeof word>[]) =>
    build(
      [...rects, ...words.flatMap((w) => w.marks)],
      words.map((w) => w.line),
    );

  it('reads left, centred and right text from where it sits in the cell', () => {
    // 每列 300 宽：靠左（离左边 8）、居中、靠右（离右边 8）。
    const words = [word('left', 108, 115), word('mid', 510, 115), word('right', 912, 115)];
    const [table] = tablesOf(page(gridRects([100, 400, 700, 1000 - 2], [100, 150]), words));
    expect(table!.cells.map((c) => [c.text, c.align])).toEqual([
      ['left', 'left'],
      ['mid', 'center'],
      ['right', 'right'],
    ]);
  });

  it('goes with most lines in a wrapped cell and skips lines that fill it', () => {
    const words = [
      // 第一格：三排，两排居中、一排几乎占满。
      word('title one', 200, 110, 100),
      word('a line that fills the cell', 104, 132, 292),
      word('title two', 200, 154, 100),
      word('x', 420, 132),
    ];
    const [table] = tablesOf(page(gridRects([100, 400, 700], [100, 190]), words));
    expect(cellAt(table!, 0, 0)!.align).toBe('center');
  });

  it('puts amounts on the right when the position does not tell', () => {
    // 字占满了格子，看不出对齐：金额靠右，文字不写（常规）。
    const words = [word('1 954,54', 104, 115, 192), word('Assurance', 304, 115, 192)];
    const [table] = tablesOf(page(gridRects([100, 300, 500], [100, 150]), words));
    expect(cellAt(table!, 0, 0)!.align).toBe('right');
    expect(cellAt(table!, 0, 1)!.align).toBeUndefined();
  });

  it('centres a title above the table over the page’s columns', () => {
    const words = [word('BON DE COMMANDE', 350, 40, 300), word('a', 120, 115), word('b', 520, 115)];
    const p = page(gridRects([100, 500, 900], [100, 150]), words);
    const title = p.blocks.find((b) => b.kind === 'text');
    expect(title).toMatchObject({ text: 'BON DE COMMANDE', align: 'center' });
  });
});

describe('findTables', () => {
  it('keeps only lines connected to other lines', () => {
    const image = renderPage(W, H, [
      ...gridRects([100, 500, 900], [100, 200, 300]),
      { x: 100, y: 500, width: 600, height: 2 },
    ]);
    const tables = findTables(findLines(image, { skew: 0 }));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.hs).toHaveLength(3);
    expect(tables[0]!.vs).toHaveLength(3);
  });
});
