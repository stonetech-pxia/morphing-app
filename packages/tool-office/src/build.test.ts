import { describe, expect, it } from 'vitest';

import { buildTablePage } from './build';
import { findLines, findTables } from './lines';
import { fakeLine, glyphs, gridRects, renderPage, type Rect } from './test-helpers';
import type { OcrBox, TableBlock, TablePage } from './types';

const W = 1000;
const H = 700;

const tablesOf = (page: TablePage) =>
  page.blocks.filter((b): b is TableBlock => b.kind === 'table');
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
    for (const w of table!.colWidths) expect(Math.abs(w - 200)).toBeLessThan(6);
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
    expect(tables.map((t) => [t.rows, t.cols])).toEqual([
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
    expect(tables.map((t) => [t.rows, t.cols])).toEqual([
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
