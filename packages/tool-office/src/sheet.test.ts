import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildSheetPage, buildTablePage } from './build';
import {
  canDeleteColumn,
  deleteColumn,
  deleteImageBlock,
  insertColumn,
  parseTableDoc,
} from './edit';
import type { LayoutRegion } from './layout';
import { fakeLine, glyphs, gridRects, renderPage, type Rect } from './test-helpers';
import type { ImageBlock, OcrBox, TableBlock, TableDoc, TablePage, TextBlock } from './types';
import { DEFAULT_FONT_SIZE, layoutSheet, writeXlsx } from './xlsx';

// 转 Excel 的四个缺的功能（D-520–D-523）：图片区域、表单不当网格、左右两栏、字号和粗体。

const W = 1000;
const H = 800;
const PAGE = { width: W, height: H };

const textBlocks = (page: TablePage) =>
  page.blocks.filter((b): b is TextBlock => b.kind === 'text');
const imageBlocks = (page: TablePage) =>
  page.blocks.filter((b): b is ImageBlock => b.kind === 'image');
const tableBlocks = (page: TablePage) =>
  page.blocks.filter((b): b is TableBlock => b.kind === 'table');

/** 一排一排的字：每行 box（高 24）和文字。 */
function lines(rows: { text: string; x: number; y: number; width?: number; height?: number }[]) {
  const ocr: OcrBox[] = [];
  const marks: Rect[] = [];
  for (const r of rows) {
    const box = { x: r.x, y: r.y, width: r.width ?? 300, height: r.height ?? 24 };
    ocr.push(fakeLine(r.text, box, PAGE));
    marks.push(...glyphs(box.x + 4, box.y + 4, box.width - 8, box.height - 8));
  }
  return { ocr, marks };
}

const build = (
  rects: Rect[],
  ocr: OcrBox[],
  regions?: LayoutRegion[],
  build_: typeof buildSheetPage = buildSheetPage,
) =>
  build_({
    image: renderPage(W, H, rects),
    lines: ocr,
    ...(regions ? { regions } : {}),
    name: 'P1',
    source: 'file:///p.jpg',
    skew: 0,
  });

describe('two text columns side by side (D-522)', () => {
  // 左栏、右栏各四行，每行 40 像素一排；两栏之间空 200 像素。
  const rows = [0, 1, 2, 3].flatMap((i) => [
    { text: `left ${i}`, x: 100, y: 100 + 40 * i, width: 300 },
    { text: `right ${i}`, x: 600, y: 100 + 40 * i, width: 300 },
  ]);

  it('keeps the left and right column in their own columns on the same rows', () => {
    const { ocr, marks } = lines(rows);
    const page = build(marks, ocr);
    const text = textBlocks(page);
    const left = text.find((b) => b.text.includes('left 0'))!;
    const right = text.find((b) => b.text.includes('right 0'))!;
    expect(left.text).not.toContain('right');
    expect(right.text).not.toContain('left');
    expect(left.band).toBe(right.band);
    expect(left.col).toBeDefined();
    expect(right.col!).toBeGreaterThanOrEqual(left.col! + left.cols!);
    const layout = layoutSheet(page, 'all');
    const l = layout.cells.find((c) => c.text === left.text)!;
    const r = layout.cells.find((c) => c.text === right.text)!;
    expect(l.row).toBe(r.row);
    expect(r.col).toBeGreaterThan(l.col);
  });

  it('the old builder merges both columns into one text', () => {
    const { ocr, marks } = lines(rows);
    const page = build(marks, ocr, undefined, buildTablePage);
    expect(textBlocks(page)).toHaveLength(1);
    expect(textBlocks(page)[0]!.text).toContain('left 0 right 0');
  });

  it('writes the two columns into different xlsx columns of the same row', () => {
    const { ocr, marks } = lines(rows);
    const page = build(marks, ocr);
    const doc: TableDoc = { version: 3, scope: 'all', pages: [page] };
    const files = unzipSync(writeXlsx(doc));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    const strings = strFromU8(files['xl/sharedStrings.xml']!);
    const sst = [...strings.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]!);
    const at = (text: string) => {
      const index = sst.findIndex((s) => s.startsWith(text));
      return /<c r="([A-Z]+)(\d+)"[^>]*t="s"><v>(\d+)<\/v>/g
        .exec(
          sheet.replace(
            new RegExp(`(<c r="[A-Z]+\\d+"[^>]*t="s"><v>)(?!${index}<)\\d+`, 'g'),
            '$1x',
          ),
        )
        ?.slice(1, 3);
    };
    const [leftCol, leftRow] = at('left 0')!;
    const [rightCol, rightRow] = at('right 0')!;
    expect(leftRow).toBe(rightRow);
    expect(leftCol).not.toBe(rightCol);
  });

  it('a single column page keeps full-width paragraphs', () => {
    const { ocr, marks } = lines(
      [0, 1, 2].map((i) => ({ text: `line ${i}`, x: 100, y: 100 + 40 * i, width: 700 })),
    );
    const page = build(marks, ocr);
    expect(textBlocks(page)).toHaveLength(1);
    expect(textBlocks(page)[0]!.col).toBeUndefined();
    expect(textBlocks(page)[0]!.band).toBeUndefined();
  });
});

describe('figures (D-520)', () => {
  const figure: LayoutRegion = {
    kind: 'image',
    label: 'chart',
    score: 0.8,
    box: { x: 100, y: 300, width: 400, height: 200 },
  };
  // 图里有一个标注和一排像字的笔画，图外有一行字。
  const { ocr, marks } = lines([
    { text: 'Title', x: 100, y: 100, width: 200 },
    { text: 'legend', x: 300, y: 400, width: 100 },
    { text: 'after', x: 100, y: 560, width: 200 },
  ]);

  it('turns a figure region into an image block and keeps its text out of the sheet', () => {
    const page = build(marks, ocr, [figure]);
    const images = imageBlocks(page);
    expect(images).toHaveLength(1);
    expect(images[0]!.box.width).toBeGreaterThanOrEqual(400);
    expect(textBlocks(page).map((b) => b.text)).toEqual(['Title', 'after']);
  });

  it('keeps worksheet geometry unchanged for a Word-only recovered figure', () => {
    const outside = ocr.filter((l) => l.text !== 'legend');
    const weak: LayoutRegion = { ...figure, score: 0.59, fused: true, wordOnly: true };
    expect(build(marks, outside, [weak])).toEqual(build(marks, outside));
  });

  it('does without a layout model', () => {
    const page = build(marks, ocr);
    expect(imageBlocks(page)).toHaveLength(0);
    expect(textBlocks(page).map((b) => b.text)).toContain('legend');
  });

  it('does not turn lines inside a figure into a table', () => {
    // 图里画了一个格子（图表的网格）。
    const grid = gridRects([100, 250, 400], [320, 380, 440], { thickness: 2 });
    const page = build([...marks, ...grid], ocr, [figure]);
    expect(tableBlocks(page)).toHaveLength(0);
    expect(imageBlocks(page)).toHaveLength(1);
  });

  it('lays an image out over rows and writes it as a picture anchored at its cell', () => {
    const page = build(marks, ocr, [figure]);
    const layout = layoutSheet(page, 'all');
    const cell = layout.cells.find((c) => c.image)!;
    expect(cell.rowSpan).toBeGreaterThan(5);
    const after = layout.cells.find((c) => c.text === 'after')!;
    expect(after.row).toBeGreaterThanOrEqual(cell.row + cell.rowSpan);
    const src = 'file:///figure.jpg';
    const withSrc: TablePage = {
      ...page,
      blocks: page.blocks.map((b) => (b.kind === 'image' ? { ...b, src } : b)),
    };
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const xlsx = writeXlsx(
      { version: 3, scope: 'all', pages: [withSrc] },
      new Map([[src, { bytes, width: 400, height: 200 }]]),
    );
    const files = unzipSync(xlsx);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'xl/drawings/drawing1.xml',
        'xl/drawings/_rels/drawing1.xml.rels',
        'xl/worksheets/_rels/sheet1.xml.rels',
        'xl/media/image1.jpg',
      ]),
    );
    expect(files['xl/media/image1.jpg']).toEqual(bytes);
    const drawing = strFromU8(files['xl/drawings/drawing1.xml']!);
    expect(drawing).toContain(`<xdr:row>${cell.row}</xdr:row>`);
    expect(drawing).toContain(`<xdr:col>${cell.col}</xdr:col>`);
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain('<drawing r:id="rId1"/>');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('image/jpeg');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('drawing+xml');
  });

  it('writes no picture for an image that could not be cropped', () => {
    const page = build(marks, ocr, [figure]);
    const files = unzipSync(writeXlsx({ version: 3, scope: 'all', pages: [page] }));
    expect(Object.keys(files).some((f) => f.includes('drawing') || f.includes('media'))).toBe(
      false,
    );
  });

  it('puts a figure beside the text next to it', () => {
    const side = lines([
      { text: 'caption', x: 600, y: 320, width: 200 },
      { text: 'more words', x: 600, y: 360, width: 200 },
    ]);
    const page = build([...marks, ...side.marks], [...ocr, ...side.ocr], [figure]);
    const image = imageBlocks(page)[0]!;
    const caption = textBlocks(page).find((b) => b.text.includes('caption'))!;
    expect(caption.band).toBe(image.band);
    expect(image.band).toBeDefined();
    const layout = layoutSheet(page, 'all');
    expect(layout.cells.find((c) => c.image)!.row).toBe(
      layout.cells.find((c) => c.text.includes('caption'))!.row,
    );
  });
});

describe('a form is not one big grid (D-520)', () => {
  // 三个全宽的框（每个框里标签一行、值一行），下面一张两行三列的表，竖线都是 100、400、900。
  const xs = [100, 400, 900];
  const rects: Rect[] = [];
  const rows: { text: string; x: number; y: number; width?: number }[] = [];
  // 框的左右边是一条连着的竖线（扫描的表单里框和下面的表格连成一张网格）。
  const top = 60 + 4 * 110;
  const ys = [0, 1, 2, 3]
    .flatMap((i) => [60 + i * 110, 60 + i * 110 + 90])
    .concat([top, top + 40, top + 80]);
  rects.push(...gridRects([100, 900], ys));
  rects.push({ x: 400, y: top, width: 2, height: 82 });
  for (let i = 0; i < 4; i++) {
    const y = 60 + i * 110;
    rows.push({ text: `Label ${i}`, x: 120, y: y + 10, width: 150 });
    rows.push({ text: `Value ${i}`, x: 120, y: y + 50, width: 150 });
  }
  const cell = (c: number, r: number, text: string) =>
    rows.push({ text, x: xs[c]! + 20, y: top + r * 40 + 8, width: 80 });
  cell(0, 0, 'Item');
  cell(1, 0, 'Price');
  cell(0, 1, 'Paper');
  cell(1, 1, '12.35');
  const { ocr, marks } = lines(rows);

  it('keeps the form fields as text and only the data table as a table', () => {
    const page = build([...rects, ...marks], ocr);
    const tables = tableBlocks(page);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toBe(2);
    expect(tables[0]!.cells.map((c) => c.text)).toEqual(['Item', 'Price', 'Paper', '12.35']);
    const text = textBlocks(page).map((b) => b.text);
    for (let i = 0; i < 4; i++) {
      expect(text.some((t) => t.includes(`Label ${i}`))).toBe(true);
      expect(text.some((t) => t.includes(`Value ${i}`))).toBe(true);
    }
  });

  it('the old builder writes the whole page as one table', () => {
    const page = build([...rects, ...marks], ocr, undefined, buildTablePage);
    expect(tableBlocks(page)).toHaveLength(1);
    expect(tableBlocks(page)[0]!.rows).toBeGreaterThan(8);
  });

  it('a ruled data table stays a table', () => {
    const data = [['Item', 'Qty', 'Price']].concat(
      [1, 2, 3, 4].map((n) => [`Row ${n}`, `${n}`, `${n}.50`]),
    );
    const dxs = [100, 400, 600, 900];
    const dys = [100, 140, 180, 220, 260, 300];
    const out = lines(
      data.flatMap((row, r) =>
        row.map((text, c) => ({ text, x: dxs[c]! + 15, y: dys[r]! + 8, width: 80 })),
      ),
    );
    const page = build([...gridRects(dxs, dys), ...out.marks], out.ocr);
    expect(tableBlocks(page)).toHaveLength(1);
    expect(tableBlocks(page)[0]!.rows).toBe(5);
    expect(textBlocks(page)).toHaveLength(0);
  });
});

describe('font sizes and bold (D-521)', () => {
  // 标题的字高 48、正文 24；正文的笔画细（宽 2）、小标题的笔画粗（宽 6）。
  const heading = (text: string, y: number, h: number, stroke: number, width: number): Rect[] => {
    const out: Rect[] = [];
    for (let s = 0; s + stroke <= width; s += stroke * 3) {
      out.push({ x: 100 + s, y: y + h * 0.2, width: stroke, height: h * 0.6 });
    }
    return out;
  };
  const { ocr } = lines([
    { text: 'Big title here', x: 100, y: 60, width: 400, height: 48 },
    { text: 'Bold sub title', x: 100, y: 160, width: 300, height: 24 },
    { text: 'body one', x: 100, y: 240, width: 300, height: 24 },
    { text: 'body two', x: 100, y: 270, width: 300, height: 24 },
    { text: 'body three', x: 100, y: 300, width: 300, height: 24 },
  ]);
  const marks = [
    ...heading('', 60, 48, 2, 400),
    ...heading('', 160, 24, 6, 300),
    ...heading('', 240, 24, 2, 300),
    ...heading('', 270, 24, 2, 300),
    ...heading('', 300, 24, 2, 300),
  ];

  it('gives a larger title a larger size and a thick-stroke line bold', () => {
    const page = build(marks, ocr);
    const text = textBlocks(page);
    const title = text.find((b) => b.text.startsWith('Big'))!;
    const sub = text.find((b) => b.text.startsWith('Bold'))!;
    const body = text.find((b) => b.text.startsWith('body'))!;
    expect(page.bodySize).toBeGreaterThan(0);
    expect(title.size ?? page.bodySize!).toBeGreaterThan(1.5 * (body.size ?? page.bodySize!));
    expect(sub.bold).toBe(true);
    expect(body.bold).toBeUndefined();
  });

  it('writes the sizes as xlsx fonts and sets the row height from them', () => {
    const page = build(marks, ocr);
    const files = unzipSync(writeXlsx({ version: 3, scope: 'all', pages: [page] }));
    const styles = strFromU8(files['xl/styles.xml']!);
    const sizes = [...styles.matchAll(/<font>(?:<b\/>)?<sz val="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(new Set(sizes).size).toBeGreaterThan(2);
    expect(styles).toContain('<b/>');
    const layout = layoutSheet(page, 'all');
    const big = layout.cells.find((c) => c.text.startsWith('Big'))!;
    const small = layout.cells.find((c) => c.text.startsWith('body'))!;
    expect(big.size).toBeGreaterThan(small.size ?? DEFAULT_FONT_SIZE);
    const perLine = (row: number) => layout.rows[row]!.points / layout.rows[row]!.lines;
    expect(perLine(big.row)).toBeGreaterThan(perLine(small.row));
  });

  it('bolds a table row as a whole, not a stray cell (D-521)', () => {
    // 带线的表 3 行 3 列：表头两格笔画粗、一格细（认得不准）；第二行只有一个数字笔画粗（噪声）；第三行都细。
    const xs = [100, 350, 600, 850];
    const ys = [100, 160, 220, 280];
    const strokes = (x: number, y: number, stroke: number): Rect[] => {
      const out: Rect[] = [];
      for (let s = 0; s + stroke <= 200; s += stroke * 3) {
        out.push({ x: x + s, y: y + 5, width: stroke, height: 14 });
      }
      return out;
    };
    const thick = [
      [true, true, false],
      [false, true, false],
      [false, false, false],
    ];
    const rows = thick.flatMap((row, r) =>
      row.map((_, c) => ({ text: `r${r}c${c}`, x: xs[c]! + 20, y: ys[r]! + 18, width: 200 })),
    );
    const body = [0, 1, 2, 3, 4].map((i) => ({
      text: `body line ${i}`,
      x: 100,
      y: 400 + 40 * i,
      width: 300,
    }));
    const { ocr } = lines([...rows, ...body]);
    const marks = [
      ...gridRects(xs, ys, { thickness: 2 }),
      ...thick.flatMap((row, r) =>
        row.flatMap((t, c) => strokes(xs[c]! + 20, ys[r]! + 18, t ? 6 : 2)),
      ),
      ...body.flatMap((b) => strokes(b.x, b.y, 2)),
    ];
    const page = build(marks, ocr);
    const [table] = tableBlocks(page);
    const boldOf = (row: number) =>
      table!.cells.filter((c) => c.row === row).map((c) => c.bold === true);
    expect(boldOf(0)).toEqual([true, true, true]);
    expect(boldOf(1)).toEqual([false, false, false]);
    expect(boldOf(2)).toEqual([false, false, false]);
  });

  it('an old page without sizes still writes the one 11 pt font', () => {
    const old: TablePage = {
      name: 'P',
      source: 's',
      width: 1000,
      height: 1000,
      lineHeight: 20,
      colWidths: [250, 250, 250, 250],
      blocks: [{ kind: 'text', text: 'hello', box: { x: 0, y: 0, width: 100, height: 20 } }],
    };
    const files = unzipSync(writeXlsx({ version: 3, scope: 'all', pages: [old] }));
    const styles = strFromU8(files['xl/styles.xml']!);
    expect(styles).toContain('<fonts count="1">');
    expect(styles).not.toContain('<b/>');
    expect(layoutSheet(old, 'all').cells[0]!.size).toBeUndefined();
  });
});

describe('saved Excel sidecar format 3 (D-520–D-522, invariant 12)', () => {
  const v2 = {
    version: 2,
    scope: 'all',
    pages: [
      {
        name: 'P',
        source: 's',
        width: 1000,
        height: 1000,
        lineHeight: 20,
        colWidths: [250, 250, 250, 250],
        blocks: [
          {
            kind: 'text',
            text: 'hello',
            align: 'center',
            box: { x: 0, y: 0, width: 100, height: 20 },
          },
          {
            kind: 'table',
            rows: 1,
            col: 1,
            cols: 2,
            box: { x: 0, y: 100, width: 500, height: 40 },
            cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'a', align: 'right' }],
          },
        ],
      },
    ],
  };

  it('opens a version 2 file as version 3 and loses nothing', () => {
    const doc = parseTableDoc(JSON.stringify(v2))!;
    expect(doc.version).toBe(3);
    expect(doc.pages).toEqual(v2.pages);
    expect(doc.scope).toBe('all');
  });

  it('writes the same xlsx for the old file as before the migration', () => {
    const doc = parseTableDoc(JSON.stringify(v2))!;
    const layout = layoutSheet(doc.pages[0]!, 'all');
    expect(layout.cells.map((c) => [c.text, c.row, c.col, c.colSpan, c.size])).toEqual([
      ['hello', 0, 0, 4, undefined],
      ['a', 2, 1, 1, undefined],
    ]);
  });

  it('keeps a version 3 file as it is and refuses other versions', () => {
    const v3 = { ...v2, version: 3 };
    expect(parseTableDoc(JSON.stringify(v3))).toEqual(v3);
    expect(parseTableDoc(JSON.stringify({ ...v2, version: 1 }))).toBeNull();
    expect(parseTableDoc(JSON.stringify({ ...v2, version: 4 }))).toBeNull();
  });
});

describe('editing a sheet with column-ranged text and images', () => {
  const page: TablePage = {
    name: 'P',
    source: 's',
    width: 1000,
    height: 1000,
    lineHeight: 20,
    colWidths: [100, 100, 100, 100],
    blocks: [
      {
        kind: 'text',
        text: 'left',
        col: 0,
        cols: 2,
        band: 0,
        box: { x: 0, y: 0, width: 200, height: 20 },
      },
      {
        kind: 'image',
        col: 2,
        cols: 2,
        band: 0,
        src: 'x',
        box: { x: 200, y: 0, width: 200, height: 100 },
      },
      { kind: 'text', text: 'wide', box: { x: 0, y: 200, width: 400, height: 20 } },
    ],
  };
  const doc: TableDoc = { version: 3, scope: 'all', pages: [page] };

  it('inserting a column widens what spans it and shifts what starts at or after it', () => {
    const next = insertColumn(doc, 0, 2).pages[0]!;
    expect(next.colWidths).toHaveLength(5);
    expect(next.blocks[0]).toMatchObject({ col: 0, cols: 2 });
    expect(next.blocks[1]).toMatchObject({ col: 3, cols: 2 });
    const inside = insertColumn(doc, 0, 1).pages[0]!;
    expect(inside.blocks[0]).toMatchObject({ col: 0, cols: 3 });
    expect(inside.blocks[1]).toMatchObject({ col: 3, cols: 2 });
    // 没有列范围的文字横跨整页，不用改。
    expect((next.blocks[2] as TextBlock).col).toBeUndefined();
  });

  it('deleting a column narrows or shifts them, and a one-column block keeps its column', () => {
    const next = deleteColumn(doc, 0, 1).pages[0]!;
    expect(next.blocks[0]).toMatchObject({ col: 0, cols: 1 });
    expect(next.blocks[1]).toMatchObject({ col: 1, cols: 2 });
    const narrow: TablePage = {
      ...page,
      blocks: [{ ...(page.blocks[0] as TextBlock), cols: 1 }, page.blocks[1]!],
    };
    expect(canDeleteColumn(narrow, 0)).toBe(false);
    expect(canDeleteColumn(narrow, 1)).toBe(true);
  });

  it('deletes an image but not other blocks', () => {
    expect(deleteImageBlock(doc, 0, 1).pages[0]!.blocks.map((b) => b.kind)).toEqual([
      'text',
      'text',
    ]);
    expect(deleteImageBlock(doc, 0, 0)).toBe(doc);
  });
});
