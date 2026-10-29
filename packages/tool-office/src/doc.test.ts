import { describe, expect, it } from 'vitest';

import {
  buildDocPage,
  clusterLines,
  foldEmptyColumns,
  paragraphsOf,
  strokeRatio,
  textColor,
  type DocList,
  type DocParagraph,
} from './doc';
import type { LayoutRegion } from './layout';
import { fakeLine, glyphs, gridRects, renderPage, type Rect } from './test-helpers';
import type { OcrBox, RgbaImage, TableBlock } from './types';

const line = (text: string, x: number, y: number, width: number, height = 20): OcrBox => ({
  text,
  x,
  y,
  width,
  height,
});

const W = 1000;
const H = 1400;
const page = { width: W, height: H };

/** 一页：每行字画成竖条（像字的笔画），粗细可选；返回图和识别结果。 */
function textPage(
  rows: { text: string; x: number; y: number; width: number; h?: number; stroke?: number }[],
  extra: Rect[] = [],
): { image: RgbaImage; lines: OcrBox[] } {
  const rects: Rect[] = [...extra];
  const lines: OcrBox[] = [];
  for (const r of rows) {
    const h = r.h ?? 20;
    // 字的笔画在框里上下各留 20%。
    const stroke = r.stroke ?? 2;
    for (let s = 0; s + stroke <= r.width; s += 7 + stroke)
      rects.push({ x: r.x + s, y: r.y + h * 0.2, width: stroke, height: h * 0.6 });
    lines.push(fakeLine(r.text, { x: r.x, y: r.y, width: r.width, height: h }, page));
  }
  return { image: renderPage(W, H, rects), lines };
}

describe('paragraphsOf', () => {
  it('joins wrapped lines, starts a paragraph after a gap, an indent or a list marker', () => {
    const lines = [
      line('First paragraph runs to the right edge and', 100, 100, 800),
      line('wraps here.', 100, 125, 200),
      // 有缩进：新的一段（中文书的段首空两格）。
      line('Second paragraph starts with an indent and runs', 140, 150, 760),
      line('to the next line.', 100, 175, 300),
      // 空了一行多：新的一段，记下 spaced。
      line('Third after a gap.', 100, 240, 400),
      line('1. A list item that is long enough to reach the', 100, 265, 800),
      line('right edge, continued with a hanging indent', 130, 290, 500),
      line('2. Second item', 100, 315, 300),
    ];
    const paras = paragraphsOf(lines);
    expect(paras.map((p) => p.rows.map((r) => r.text))).toEqual([
      ['First paragraph runs to the right edge and', 'wraps here.'],
      ['Second paragraph starts with an indent and runs', 'to the next line.'],
      ['Third after a gap.'],
      [
        '1. A list item that is long enough to reach the',
        'right edge, continued with a hanging indent',
      ],
      ['2. Second item'],
    ]);
    expect(paras.map((p) => [p.spaced, p.list])).toEqual([
      [false, false],
      [false, false],
      [true, false],
      [false, true],
      [false, true],
    ]);
  });
});

describe('clusterLines', () => {
  it('keeps a letter head’s address (left) and date (right) apart, and splits at big gaps', () => {
    const lines = [
      line('PARIS TURBIGO', 80, 300, 200),
      line('PARIS, le 12 juillet 2018', 650, 300, 280),
      line('78 RUE DE TURBIGO', 80, 325, 220),
      line('75003 PARIS', 80, 350, 150),
      line('Madame, Monsieur,', 80, 500, 240),
    ];
    const clusters = clusterLines(lines, 20).map((c) => c.map((l) => l.text));
    expect(clusters).toEqual([
      ['PARIS TURBIGO', '78 RUE DE TURBIGO', '75003 PARIS'],
      ['PARIS, le 12 juillet 2018'],
      ['Madame, Monsieur,'],
    ]);
  });
});

describe('strokeRatio and textColor', () => {
  it('measures bold strokes as thicker than regular ones', () => {
    const { image, lines } = textPage([
      { text: 'regular', x: 100, y: 100, width: 400, stroke: 2 },
      { text: 'bold', x: 100, y: 200, width: 400, stroke: 5 },
    ]);
    const regular = strokeRatio(image, lines[0]!);
    const bold = strokeRatio(image, lines[1]!);
    expect(regular).toBeGreaterThan(0);
    expect(bold).toBeGreaterThan(1.8 * regular);
  });

  it('does not count a strike-through or an underline as a stroke', () => {
    // 同样的字，上面多一条横穿整行的线（删除线）。
    const plain = textPage([{ text: 'a', x: 100, y: 100, width: 400 }]);
    const struck = textPage(
      [{ text: 'a', x: 100, y: 100, width: 400 }],
      [{ x: 100, y: 109, width: 400, height: 2 }],
    );
    expect(strokeRatio(struck.image, struck.lines[0]!)).toBeCloseTo(
      strokeRatio(plain.image, plain.lines[0]!),
      2,
    );
  });

  it('reads the colour of coloured text and nothing for black or gray text', () => {
    const image = renderPage(W, 200, glyphs(100, 50, 300, 20));
    const box = { x: 100, y: 50, width: 300, height: 20 };
    expect(textColor(image, box)).toBeUndefined();
    // 字的像素换成蓝色。
    const blue = { ...image, data: image.data.slice() };
    for (let i = 0; i < blue.data.length; i += 4) {
      if (blue.data[i]! < 128) blue.data.set([23, 32, 148], i);
    }
    expect(textColor(blue, box)).toBe('172094');
  });
});

describe('foldEmptyColumns', () => {
  it('merges a column that is empty in every row into the cells on its left', () => {
    const table: TableBlock = {
      kind: 'table',
      rows: 2,
      col: 0,
      cols: 3,
      box: { x: 0, y: 0, width: 300, height: 40 },
      cells: [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'A' },
        { row: 0, col: 1, rowSpan: 1, colSpan: 2, text: '' },
        { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: 'B' },
        { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: '' },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: '' },
      ],
    };
    const folded = foldEmptyColumns(table);
    expect(folded.cells.map((c) => [c.row, c.col, c.colSpan, c.text])).toEqual([
      [0, 0, 3, 'A'],
      [1, 0, 3, 'B'],
    ]);
    // 中间一列有字：只把它右边的空列并进它，它自己不并。
    const kept = foldEmptyColumns({
      ...table,
      cells: table.cells.map((c) => (c.row === 1 && c.col === 1 ? { ...c, text: 'x' } : c)),
    });
    expect(kept.cells.map((c) => [c.row, c.col, c.colSpan])).toEqual([
      [0, 0, 1],
      [0, 1, 2],
      [1, 0, 1],
      [1, 1, 2],
    ]);
  });
});

describe('buildDocPage', () => {
  const regions = (list: [LayoutRegion['kind'], string, Rect][]): LayoutRegion[] =>
    list.map(([kind, label, box]) => ({ kind, label, score: 0.9, box }));

  it('makes headings, paragraphs, lists, a ruled table and an image in reading order', () => {
    const xs = [100, 400, 700];
    const ys = [700, 740, 780];
    const { image, lines } = textPage(
      [
        { text: 'Annual Report', x: 300, y: 60, width: 400, h: 40, stroke: 6 },
        { text: 'This paragraph is the body text of the page and it', x: 100, y: 150, width: 800 },
        { text: 'wraps onto a second line.', x: 100, y: 175, width: 300 },
        { text: '• first point', x: 100, y: 240, width: 300 },
        { text: '• second point', x: 100, y: 265, width: 300 },
        { text: 'Name', x: 120, y: 710, width: 100 },
        { text: 'Total', x: 420, y: 710, width: 100 },
        { text: 'Alice', x: 120, y: 750, width: 100 },
        { text: '12', x: 420, y: 750, width: 40 },
        { text: '3', x: 950, y: 1360, width: 15 },
      ],
      gridRects(xs, ys),
    );
    const doc = buildDocPage({
      image,
      lines,
      source: 'file:///page.jpg',
      skew: 0,
      regions: regions([
        ['title', 'doc_title', { x: 290, y: 50, width: 420, height: 60 }],
        ['text', 'text', { x: 90, y: 140, width: 820, height: 70 }],
        ['image', 'image', { x: 100, y: 400, width: 300, height: 200 }],
        ['pageNumber', 'number', { x: 940, y: 1350, width: 40, height: 40 }],
      ]),
    });
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
      'list',
      'image',
      'table',
    ]);
    const [title, body, list] = doc.blocks as [DocParagraph, DocParagraph, DocList];
    expect(title).toMatchObject({ text: 'Annual Report', heading: 1, bold: true, align: 'center' });
    expect(body.text).toBe(
      'This paragraph is the body text of the page and it wraps onto a second line.',
    );
    expect(body.heading).toBeUndefined();
    expect(body.bold).toBeUndefined();
    expect(body.size).toBeUndefined();
    expect(list).toMatchObject({ ordered: false, items: ['first point', 'second point'] });
    const table = doc.blocks[4]!;
    expect(table.kind === 'table' && table.table.cells.map((c) => c.text)).toEqual([
      'Name',
      'Total',
      'Alice',
      '12',
    ]);
    expect(table.kind === 'table' && table.colWidths).toEqual([300, 300]);
    // 页码不写进文件。
    expect(JSON.stringify(doc.blocks)).not.toContain('"3"');
    expect(doc.bodySize).toBeGreaterThanOrEqual(9);
    expect(doc.bodySize).toBeLessThanOrEqual(12);
  });

  it('without layout regions still makes paragraphs and numbered lists from positions', () => {
    const { image, lines } = textPage([
      { text: 'Conditions', x: 100, y: 60, width: 300, h: 40 },
      { text: '1) Delivery takes two weeks.', x: 100, y: 150, width: 500 },
      { text: '2) Payment on delivery.', x: 100, y: 175, width: 450 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    expect(doc.blocks).toMatchObject([
      { kind: 'paragraph', text: 'Conditions', heading: 1 },
      {
        kind: 'list',
        ordered: true,
        format: '%1)',
        start: 1,
        items: ['Delivery takes two weeks.', 'Payment on delivery.'],
      },
    ]);
  });

  it('treats a picture region full of body text as text, not as a picture', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      text: `Line ${i + 1} of a long paragraph that fills the page width`,
      x: 100,
      y: 100 + i * 25,
      width: 800,
    }));
    const { image, lines } = textPage(rows);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      regions: regions([['image', 'image', { x: 90, y: 90, width: 820, height: 140 }]]),
    });
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph']);
  });
});
