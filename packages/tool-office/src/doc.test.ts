import { describe, expect, it } from 'vitest';

import {
  buildDocPage,
  clusterLines,
  foldEmptyColumns,
  leafBlocks,
  paragraphsOf,
  strokeRatio,
  textColor,
  type DocList,
  type DocParagraph,
  type DocRow,
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

  it('does not take a quoted line of dialogue or a long sentence for a heading (D-330)', () => {
    const { image, lines } = textPage([
      { text: 'Chapter One', x: 100, y: 60, width: 300, h: 30 },
      { text: '“Why not, then?”', x: 140, y: 150, width: 300, h: 30 },
      {
        text: 'This sentence is printed a little larger than the rest of the page.',
        x: 100,
        y: 230,
        width: 800,
        h: 30,
      },
      {
        text: 'Body text of the page goes here and runs on to the right',
        x: 100,
        y: 330,
        width: 800,
      },
      {
        text: 'edge of the block before it wraps, and goes on for a few more',
        x: 100,
        y: 355,
        width: 800,
      },
      {
        text: 'lines so that the body size is clear from the median line',
        x: 100,
        y: 380,
        width: 800,
      },
      { text: 'height.', x: 100, y: 405, width: 100 },
    ]);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      // 版面模型说对话是标题（实验里的书页就是这样）。
      regions: regions([['title', 'paragraph_title', { x: 130, y: 140, width: 320, height: 50 }]]),
    });
    const paras = doc.blocks as DocParagraph[];
    expect(paras.map((p) => [p.text.slice(0, 12), p.heading])).toEqual([
      ['Chapter One', 2],
      ['“Why not, th', undefined],
      ['This sentenc', undefined],
      ['Body text of', undefined],
    ]);
  });

  it('keeps the first-line indent of a paragraph (D-330)', () => {
    const { image, lines } = textPage([
      {
        text: 'Indented first line of a paragraph that runs on to the',
        x: 160,
        y: 100,
        width: 740,
      },
      { text: 'right edge and wraps back to the left margin.', x: 100, y: 125, width: 600 },
      // 一行的段落：和这一块其他行的左边比。
      { text: 'A short indented line.', x: 160, y: 150, width: 300 },
      { text: 'Next paragraph without an indent runs on to the right', x: 100, y: 175, width: 800 },
      { text: 'edge as well.', x: 100, y: 200, width: 200 },
      // 单独一块的一行（书页里单独一个区域的对话）：和整页的左边距比；页边上零星的字不算左边距。
      { text: '“A line of dialogue on its own.”', x: 160, y: 300, width: 400 },
      { text: 'A line on its own at the margin.', x: 100, y: 400, width: 400 },
      { text: '00', x: 20, y: 600, width: 30 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const paras = doc.blocks as DocParagraph[];
    expect(paras.map((p) => [p.text.slice(0, 10), p.indent])).toEqual([
      ['Indented f', 60],
      ['A short in', 60],
      ['Next parag', undefined],
      ['“A line of', 60],
      ['A line on ', undefined],
      ['00', undefined],
    ]);
  });

  it('puts side-by-side tables and text columns into one row, the rest top to bottom (D-331)', () => {
    const { image, lines } = textPage(
      [
        { text: 'Report', x: 100, y: 40, width: 200, h: 30 },
        // 左右两张表，上下范围重叠。
        { text: 'A', x: 120, y: 110, width: 40 },
        { text: '1', x: 320, y: 110, width: 20 },
        { text: 'B', x: 620, y: 110, width: 40 },
        { text: '2', x: 820, y: 110, width: 20 },
        // 左右两栏文字。
        { text: 'Left column first line of text that runs', x: 100, y: 300, width: 380 },
        { text: 'on to a second line.', x: 100, y: 325, width: 200 },
        { text: 'Right column first line of text that runs', x: 600, y: 300, width: 380 },
        { text: 'on to a second line too.', x: 600, y: 325, width: 220 },
        { text: 'Closing line across the page.', x: 100, y: 500, width: 600 },
      ],
      [...gridRects([100, 300, 400], [100, 140]), ...gridRects([600, 800, 900], [100, 140])],
    );
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'row', 'row', 'paragraph']);
    const tables = doc.blocks[1] as DocRow;
    expect(tables.cells.map((c) => c.blocks.map((b) => b.kind))).toEqual([['table'], ['table']]);
    // 列宽按原图位置：第一格到第二格的左边，最后一格到它的右边。
    expect(tables.cells.map((c) => Math.round(c.width))).toEqual([500, 300]);
    const columns = doc.blocks[2] as DocRow;
    expect(
      columns.cells.map((c) => c.blocks.map((b) => (b as DocParagraph).text.slice(0, 5))),
    ).toEqual([['Left '], ['Right']]);
    expect(leafBlocks(doc).map((b) => b.kind)).toEqual([
      'paragraph',
      'table',
      'table',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
  });

  it('drops short stray marks at the page edge or far from the text, keeps short real text (D-334)', () => {
    const { image, lines } = textPage([
      // 页角的污点认成「00」：贴着页边，框比正文行高很多。
      { text: '00', x: 4, y: 0, width: 40, h: 90 },
      { text: 'GENERAL CONDITIONS', x: 300, y: 150, width: 400, h: 30 },
      { text: 'Never put a hot pan directly on the worktop, use a', x: 100, y: 250, width: 800 },
      { text: 'trivet.', x: 100, y: 275, width: 100 },
      // 签名认成「Q」：离别的字很远，没把握。
      { text: 'Q', x: 600, y: 500, width: 40, h: 50 },
      // 离得远、但认得准、和正文一样高的编号（「②」）照样留下。
      { text: '(2)', x: 100, y: 700, width: 30 },
      { text: 'Ok', x: 100, y: 900, width: 30 },
    ]);
    const scored = lines.map((l) =>
      l.text === 'Q' ? { ...l, score: 0.6 } : { ...l, score: l.text === '00' ? 0.95 : 0.99 },
    );
    const doc = buildDocPage({ image, lines: scored, source: 's', skew: 0 });
    const texts = leafBlocks(doc).map((b) => (b.kind === 'paragraph' ? b.text : ''));
    expect(texts).not.toContain('00');
    expect(texts).not.toContain('Q');
    expect(texts).toContain('(2)');
    expect(texts).toContain('Ok');
    expect(texts[0]).toBe('GENERAL CONDITIONS');
  });

  it('sizes a form in proportion to the page, down to about 6 pt; prose stays at 9 pt or more (D-335)', () => {
    // 原图 1000 像素宽按 A4 595 磅换算：行高 13 像素的字约 7 磅。
    const form = textPage(
      Array.from({ length: 8 }, (_, i) => [
        { text: `LABEL ${i}`, x: 80, y: 100 + i * 30, width: 90, h: 13 },
        { text: `${i}0,00`, x: 700, y: 100 + i * 30, width: 50, h: 13 },
      ]).flat(),
    );
    expect(buildDocPage({ ...form, source: 's', skew: 0 }).bodySize).toBe(7);
    const tiny = textPage([
      { text: 'NAME', x: 80, y: 100, width: 40, h: 9 },
      { text: 'DATE', x: 80, y: 130, width: 40, h: 9 },
    ]);
    expect(buildDocPage({ ...tiny, source: 's', skew: 0 }).bodySize).toBe(6);
    // 条款页：一样小的字，但都是折行的长段落：正文不小于 9 磅。
    const prose = textPage(
      Array.from({ length: 4 }, (_, p) =>
        [0, 1, 2].map((r) => ({
          text: `Paragraph ${p} line ${r} of small print that runs across the whole page width`,
          x: 80,
          y: 100 + p * 80 + r * 18,
          width: r === 2 ? 400 : 840,
          h: 13,
        })),
      ).flat(),
    );
    expect(buildDocPage({ ...prose, source: 's', skew: 0 }).bodySize).toBe(9);
  });

  it('gives a ruled table the size of its own text (D-335)', () => {
    const { image, lines } = textPage(
      [
        {
          text: 'Some body text that wraps across the page width here',
          x: 100,
          y: 100,
          width: 800,
        },
        { text: 'and ends on this line.', x: 100, y: 125, width: 300 },
        { text: 'Name', x: 120, y: 712, width: 60, h: 13 },
        { text: 'Total', x: 420, y: 712, width: 60, h: 13 },
        { text: 'Alice', x: 120, y: 752, width: 60, h: 13 },
        { text: '12', x: 420, y: 752, width: 20, h: 13 },
      ],
      gridRects([100, 400, 700], [700, 740, 780]),
    );
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const table = leafBlocks(doc).find((b) => b.kind === 'table');
    expect(table).toMatchObject({ size: 7 });
  });

  it('keeps each line of a table cell on its own line in Word (D-333)', () => {
    const { image, lines } = textPage(
      [
        { text: 'Logement F44', x: 120, y: 110, width: 200 },
        { text: 'Valable 2030', x: 120, y: 135, width: 200 },
        { text: 'Type Habitation', x: 120, y: 160, width: 200 },
        { text: 'Date 21/02', x: 420, y: 110, width: 200 },
      ],
      gridRects([100, 400, 900], [100, 200]),
    );
    // App 的接法（D-268）会把够长的几行接成一段；表格的格子里按原图换行。
    const join = (ls: readonly OcrBox[]) =>
      [...ls]
        .sort((a, b) => a.y - b.y)
        .map((l) => l.text)
        .join(' ');
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 }, { joinLines: join });
    const table = leafBlocks(doc).find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.table.cells[0]!.text).toBe(
      'Logement F44\nValable 2030\nType Habitation',
    );
  });

  it('pairs form labels with their values row by row (D-332)', () => {
    const { image, lines } = textPage([
      // 右边一块的上面还有一行（和值连成了一块），不参加配对。
      { text: 'IN EUROS', x: 830, y: 120, width: 120 },
      // 左边：地址；右边：一列标签、一列值（隔得远，分成了两块）。
      { text: 'ACME SARL', x: 80, y: 150, width: 160 },
      { text: '12 RUE DE PARIS', x: 80, y: 175, width: 220 },
      { text: '75003 PARIS', x: 80, y: 200, width: 160 },
      { text: 'START OF PERIOD', x: 560, y: 150, width: 160 },
      { text: 'END OF PERIOD', x: 560, y: 175, width: 140 },
      { text: 'HIRED ON', x: 560, y: 200, width: 100 },
      { text: 'SOCIAL SECURITY NO', x: 560, y: 225, width: 190 },
      { text: '1 MARCH 2019', x: 830, y: 150, width: 140 },
      { text: '31 MARCH 2019', x: 830, y: 175, width: 140 },
      { text: '2 MAY 2017', x: 830, y: 200, width: 120 },
      { text: '1 85 03 75 115 042', x: 830, y: 225, width: 160 },
      // 冒号结尾的标签，一行也配。
      { text: 'Date :', x: 100, y: 600, width: 80 },
      { text: '12 mars 2019', x: 500, y: 600, width: 150 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'row', 'paragraph']);
    expect((doc.blocks[0] as DocParagraph).text).toBe('IN EUROS');
    const row = doc.blocks[1] as DocRow;
    expect(row.cells).toHaveLength(2);
    const form = row.cells[1]!.blocks[0] as DocParagraph;
    expect(form.text).toBe(
      [
        'START OF PERIOD\t1 MARCH 2019',
        'END OF PERIOD\t31 MARCH 2019',
        'HIRED ON\t2 MAY 2017',
        'SOCIAL SECURITY NO\t1 85 03 75 115 042',
      ].join('\n'),
    );
    // 值的位置：相对标签左边的距离（原图像素）。
    expect(form.tab).toBe(270);
    expect(doc.blocks[2]).toMatchObject({ text: 'Date :\t12 mars 2019', tab: 400 });
  });
});
