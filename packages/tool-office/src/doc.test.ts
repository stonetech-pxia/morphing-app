import { describe, expect, it, vi } from 'vitest';

import {
  arrangeUnits,
  buildDocPage,
  clusterLines,
  foldEmptyColumns,
  hasUnderline,
  isRuleGrid,
  isVertical,
  leafBlocks,
  looksLikeHeading,
  mergeColumnRows,
  mergeTextRegions,
  paragraphsOf,
  splitLabelColumn,
  strokeRatio,
  textColor,
  textEm,
  type DocList,
  type DocParagraph,
  type DocBlock,
  type DocRow,
  verticalBoxes,
} from './doc';
import { isDiagram, type LayoutRegion } from './layout';
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
  it('keeps a wrapped numeric page-range tail in its paragraph, but preserves a real numbered item and a bare label', () => {
    const reference = line('[1] Martin, E. Document analysis. 2024. pp. 12-', 100, 100, 550, 30);
    const tail = line('18.', 100, 135, 45, 30);
    const paras = paragraphsOf([reference, tail]);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.list).toBe(false);
    expect(paras[0]!.rows.map((r) => r.text)).toEqual([reference.text, '18.']);
    expect(paragraphsOf([reference, { ...tail, text: '18. A new entry' }])).toHaveLength(2);
    const label = paragraphsOf([
      { ...reference, text: 'A complete preceding sentence without a numeric range.' },
      tail,
    ]);
    expect(label).toHaveLength(2);
    expect(label[1]!.list).toBe(false);
  });

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

describe('OCR region paragraph fragments', () => {
  it('keeps the legacy joining of an unrepaired paragraph, including a label and decimal value', () => {
    const lines = [line('Total due', 100, 200, 180, 24), line('739.55', 100, 230, 170, 24)];
    const joinLines = (ls: readonly OcrBox[]) => ls.map((l) => l.text).join('\n');
    const joinParagraph = vi.fn((ls: readonly OcrBox[]) => ls.map((l) => l.text).join(' '));
    const doc = buildDocPage(
      { image: renderPage(W, H, []), lines, source: 's', skew: 0 },
      { joinLines, joinParagraph },
    );
    expect(leafBlocks(doc)[0]).toMatchObject({ kind: 'paragraph', text: 'Total due\n739.55' });
    expect(joinParagraph).not.toHaveBeenCalled();
  });
  it('retains the legacy joiner on dense pages as well as retaining their region groups', () => {
    const lines = Array.from({ length: 90 }, (_, i) =>
      line('A long line of ordinary text on a dense page.', 100, 30 + i * 12, 700, 10),
    );
    const joinLines = vi.fn((ls: readonly OcrBox[]) => ls.map((l) => l.text).join(' '));
    const joinParagraph = vi.fn(() => 'A replacement that must not be used here');
    const doc = buildDocPage(
      { image: renderPage(W, H, []), lines, source: 's', skew: 0 },
      { joinLines, joinParagraph },
    );
    expect(leafBlocks(doc).length).toBeGreaterThan(0);
    expect(joinLines).toHaveBeenCalled();
    expect(joinParagraph).not.toHaveBeenCalled();
  });
  const body = [
    {
      text: 'A complete opening line reaches the column edge before it wraps',
      x: 100,
      y: 200,
      width: 700,
    },
    {
      text: 'The following line continues the same paragraph across the region boundary',
      x: 100,
      y: 225,
      width: 700,
    },
    {
      text: 'More of the same paragraph reaches the column edge once again',
      x: 100,
      y: 250,
      width: 700,
    },
    { text: 'ending here.', x: 100, y: 275, width: 160 },
  ];
  const region = (y: number, height: number): LayoutRegion => ({
    kind: 'text',
    label: 'text',
    score: 0.9,
    box: { x: 95, y, width: 715, height },
  });
  const paragraphs = (rows: typeof body, regions: LayoutRegion[]) => {
    const { image, lines } = textPage(rows);
    return leafBlocks(buildDocPage({ image, lines, regions, source: 's', skew: 0 })).filter(
      (b): b is DocParagraph => b.kind === 'paragraph',
    );
  };
  it.each([
    ['unowned first line', [region(223, 80)]],
    ['unowned final line', [region(195, 77)]],
    ['nested model regions', [region(190, 120), region(223, 80)]],
    [
      'nested model regions with edge jitter',
      [
        region(190, 120),
        {
          ...region(223, 80),
          box: { ...region(223, 80).box, x: 91 },
        },
      ],
    ],
  ])('reconciles %s from physical wrapping evidence without losing any line', (_, regions) => {
    const paras = paragraphs(body, regions as LayoutRegion[]);
    expect(paras).toHaveLength(1);
    expect(paras[0]!.text).toBe(body.map((r) => r.text).join(' '));
  });
  it('keeps a genuine paragraph indent or large gap across an ownership boundary', () => {
    const indented = [...body.slice(0, 3), { ...body[3]!, x: 150 }];
    expect(paragraphs(indented, [region(195, 77)])).toHaveLength(2);
    const spaced = [...body.slice(0, 3), { ...body[3]!, y: 340 }];
    expect(paragraphs(spaced, [region(195, 77)])).toHaveLength(2);
  });

  it('does not absorb separate single-line metadata just because another paragraph shares its region', () => {
    const rows = [
      { text: 'Elena Martin | ID: DOC-106-1 | 2026-10-15', x: 100, y: 175, width: 700 },
      { text: 'Northfield Municipal Office', x: 100, y: 200, width: 300 },
      ...body.slice(0, 3).map((r, i) => ({ ...r, y: 250 + i * 25 })),
    ];
    const paras = paragraphs(rows, [region(195, 130)]);
    expect(paras).toHaveLength(3);
    expect(paras[0]!.text).toBe(rows[0]!.text);
    expect(paras[1]!.text).toBe(rows[1]!.text);
  });

  it('preserves independently inferred font sizes when a region boundary separates different styles', () => {
    const { image, lines } = textPage(body.map((r, i) => ({ ...r, h: i === 0 ? 27 : 20 })));
    const doc = buildDocPage({ image, lines, regions: [region(223, 80)], source: 's', skew: 0 });
    const paras = leafBlocks(doc).filter((b): b is DocParagraph => b.kind === 'paragraph');
    expect(paras).toHaveLength(2);
    expect(paras[0]!.text).toBe(body[0]!.text);
    expect(paras[0]!.size).toBeGreaterThan(paras[1]!.size ?? doc.bodySize);
  });
});

describe('paragraphsOf: centered lines (D-463)', () => {
  it('keeps centered letter-head lines one per paragraph, but still joins wrapped prose', () => {
    // 处方的页眉：每行居中、宽度差不多，最宽的一行定了右边；以前「CDS 20 PANTIN」和下一行的地址被当成折行接在一起。
    const head = [
      line('CENTRE DE SANTE', 473, 124, 304, 31),
      line('CDS 20 PANTIN', 502, 175, 243, 32),
      line('20 rue du pré saint Gervais', 478, 229, 292, 30),
      line('93500 Pantin', 552, 269, 144, 27),
      line('Tél: 01 48 46 66 66', 519, 309, 211, 27),
      line('NoFINESS :93 002 730 5', 487, 348, 275, 29),
    ];
    expect(paragraphsOf(head).map((p) => p.rows.map((r) => r.text))).toEqual(
      head.map((l) => [l.text]),
    );
    // 左边对齐、写到右边的正文照样接成一段。
    const prose = [
      line('A long line of body text that runs to the right', 100, 100, 800),
      line('edge and wraps here.', 100, 125, 300),
    ];
    expect(paragraphsOf(prose)).toHaveLength(1);
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

describe('hasUnderline (D-463)', () => {
  it('sees a line under the text as long as the text, not a longer rule or a strike-through', () => {
    const box = { x: 100, y: 100, width: 400, height: 20 };
    const text = glyphs(100, 104, 400, 12);
    const page = (extra: Rect[]) => renderPage(W, 300, [...text, ...extra]);
    expect(hasUnderline(page([]), box)).toBe(false);
    // 下划线：在字的下面，和字一样长。
    expect(hasUnderline(page([{ x: 100, y: 118, width: 400, height: 2 }]), box)).toBe(true);
    // 分隔线、表格线：比字长出去很多。
    expect(hasUnderline(page([{ x: 20, y: 118, width: 900, height: 2 }]), box)).toBe(false);
    // 删除线：在字的中间。
    expect(hasUnderline(page([{ x: 100, y: 109, width: 400, height: 2 }]), box)).toBe(false);
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

  it('preserves independent header rows after the layout regions have been merged', () => {
    const { image, lines } = textPage([
      { text: '陈晓明 | ID: DOC-101-3 | 2026-10-15', x: 105, y: 223, width: 432, h: 31 },
      { text: '开票方：北方工作室', x: 105, y: 279, width: 243, h: 31 },
      { text: '收件人：陈晓明', x: 721, y: 279, width: 189, h: 31 },
    ]);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      regions: regions([
        ['text', 'text', { x: 100, y: 220, width: 440, height: 35 }],
        ['text', 'text', { x: 100, y: 276, width: 250, height: 35 }],
        ['text', 'text', { x: 715, y: 276, width: 200, height: 35 }],
      ]),
    });
    const paragraphs = leafBlocks(doc)
      .filter((b) => b.kind === 'paragraph')
      .map((b) => b.text);
    expect(paragraphs).toContain('开票方：北方工作室');
    expect(paragraphs).toContain('收件人：陈晓明');
    expect(paragraphs).toContain(lines[0]!.text);
  });

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
    // 只有一行的段落不写首行缩进（D-463）：docx 按它的左边写左缩进，见 docx.test 的「places each paragraph」。
    expect(paras.map((p) => [p.text.slice(0, 10), p.indent, Math.round(p.box.x)])).toEqual([
      ['Indented f', 60, 100],
      ['A short in', undefined, 160],
      ['Next parag', undefined, 100],
      ['“A line of', undefined, 160],
      ['A line on ', undefined, 100],
      ['00', undefined, 20],
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

  it('calibrates fonts to a known narrow PDF before applying the readable body minimum', () => {
    const { image, lines } = textPage([
      {
        text: 'An editable paragraph on the narrow source paper.',
        x: 60,
        y: 100,
        width: 800,
        h: 32,
      },
      {
        text: 'The same source contains another complete body line.',
        x: 60,
        y: 150,
        width: 800,
        h: 32,
      },
      { text: 'This physical paper is about half the A4 width.', x: 60, y: 200, width: 800, h: 32 },
    ]);
    const old = buildDocPage({ image, lines, source: 's', skew: 0 });
    const narrow = buildDocPage({
      image,
      lines,
      source: 's',
      paper: { width: 300, height: 420 },
      skew: 0,
    });
    const letter = buildDocPage({
      image,
      lines,
      source: 's',
      paper: { width: 612, height: 792 },
      skew: 0,
    });
    expect(narrow.bodySize).toBe(9);
    expect(narrow.bodySize).toBeLessThan(old.bodySize);
    expect(letter.bodySize).toBe(old.bodySize);
  });
  it('sizes lines by the width of their letters when the page is set in one font (D-463)', () => {
    // 识别框一样高（p、g 往下伸的字母让小字的框也一样高），字宽看得出大小：正文 17 像素，小字 13，大字 22。
    const px = (text: string, size: number) => Math.round(textEm(text) * size);
    const body = [
      'Docteur Martin LEROY',
      'Ophtalmologiste diplômé',
      'Ancien Assistant à la fondation',
      'MALADIES ET CHIRURGIE DES YEUX',
      'Pantin le 11/05/2026',
    ];
    const rows = body.map((text, i) => ({ text, x: 100, y: 100 + i * 60, width: px(text, 17) }));
    const small = 'Une paire de lunettes avec monture';
    const big = 'Simple foyer';
    rows.push(
      { text: small, x: 300, y: 600, width: px(small, 13) },
      { text: big, x: 300, y: 660, width: px(big, 22) },
    );
    const { image, lines } = textPage(rows);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const paras = doc.blocks as DocParagraph[];
    const sizeOf = (text: string) => paras.find((p) => p.text === text)!.size ?? doc.bodySize;
    for (const text of body) expect(sizeOf(text)).toBe(doc.bodySize);
    expect(sizeOf(small)).toBeCloseTo((doc.bodySize * 13) / 17, 0);
    expect(sizeOf(big)).toBeCloseTo((doc.bodySize * 22) / 17, 0);
  });

  it('does not make same-size, regular lines in a title region headings; headings keep their size (D-463)', () => {
    // 版面模型把整个页眉（机构名 + 地址、电话）框成一个标题区域。
    const { image, lines } = textPage([
      { text: 'CENTRE DE SANTE', x: 380, y: 60, width: 240, h: 26, stroke: 5 },
      { text: '20 rue du pré saint Gervais', x: 400, y: 100, width: 200 },
      { text: 'Tél: 01 48 46 66 66', x: 420, y: 130, width: 160 },
      { text: 'Body text of the page that is long enough to count', x: 100, y: 300, width: 800 },
      { text: 'as prose and sets the size of the body text.', x: 100, y: 325, width: 700 },
    ]);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      regions: [
        {
          kind: 'title',
          label: 'doc_title',
          score: 0.9,
          box: { x: 370, y: 50, width: 260, height: 110 },
        },
      ],
    });
    const [title, street, phone] = doc.blocks as DocParagraph[];
    expect(title).toMatchObject({ text: 'CENTRE DE SANTE', heading: 1, bold: true });
    // 标题写明自己的字号，不按标题样式放大。
    expect(title!.size).toBeDefined();
    expect(street).toMatchObject({ text: '20 rue du pré saint Gervais', align: 'center' });
    expect(street!.heading).toBeUndefined();
    expect(phone!.heading).toBeUndefined();
  });

  it('centres a single line centred on the page although the text around it is lopsided (D-463)', () => {
    // 左边一大块医生信息、右边的字很短：整页文字的左右边不对称，按它们判断居中会漏掉页眉。
    const { image, lines } = textPage([
      { text: 'ORDONNANCE DE LUNETTES', x: 300, y: 100, width: 400 },
      { text: 'Ancien Assistant à la fondation Ophtalmologique', x: 40, y: 200, width: 500 },
      { text: 'Docteur Martin LEROY', x: 150, y: 240, width: 250 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const [title, wide, doctor] = doc.blocks as DocParagraph[];
    expect(title!.align).toBe('center');
    // 左边那块里居中的行不当整页居中：位置留给 docx 的左缩进。
    expect(wide!.align).toBeUndefined();
    expect(doctor!.align).toBeUndefined();
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

describe('ragged-right wrapping (D-473)', () => {
  it('keeps an aligned pair of header fields separate from the preceding line', () => {
    const date = line('姓名 | ID: DOC-101-3 | 2026-10-15', 105, 223, 432, 31);
    const issuer = line('开票方：北方工作室', 105, 279, 243, 31);
    const recipient = line('收件人：陈晓明', 721, 279, 189, 31);
    expect(paragraphsOf([date, issuer], [recipient]).map((p) => p.rows.map((r) => r.text))).toEqual(
      [[date.text], [issuer.text]],
    );
  });

  it('still joins prose beside a column and wrapped values below a header field', () => {
    const prose = [
      line('This is a long paragraph that reaches the edge of its own text column', 100, 100, 430),
      line('and continues on the following line.', 100, 125, 330),
    ];
    expect(paragraphsOf(prose, [line('Another column', 721, 125, 190)])).toHaveLength(1);
    const value = [
      line('Address: Northfield Studio', 100, 100, 430),
      line('Second floor', 100, 125, 240),
    ];
    expect(paragraphsOf(value, [line('Account: 123', 721, 100, 190)])).toHaveLength(1);
  });

  it('joins a line that stopped short because the next word would not fit', () => {
    // 左对齐的正文右边参差不齐：第二行没写到头（离右边 30），因为下一行的第一个词放不下。
    const lines = [
      line(
        'Whereas recognition of the inherent dignity and of the equal rights of all',
        100,
        100,
        800,
      ),
      line('the human family is the foundation of freedom, justice', 100, 125, 770),
      line('and peace in the world,', 100, 150, 280),
      // 上一行离右边很远、下一个词放得下：段落到这里结束。
      line('Whereas disregard and contempt', 100, 175, 300),
    ];
    const paras = paragraphsOf(lines);
    expect(paras.map((p) => p.rows.length)).toEqual([3, 1]);
  });

  it('keeps short label rows of uneven length as separate paragraphs', () => {
    const lines = [
      line('START OF PERIOD', 100, 100, 160),
      line('END OF PERIOD', 100, 125, 140),
      line('HIRED ON', 100, 150, 100),
      line('SOCIAL SECURITY NO', 100, 175, 190),
    ];
    expect(paragraphsOf(lines)).toHaveLength(4);
  });
});

describe('rotated text (D-473)', () => {
  it('treats tall narrow multi-character boxes as vertical text', () => {
    expect(isVertical(line('Sprouts', 1163, 1154, 60, 206))).toBe(true);
    expect(isVertical(line('W-9', 109, 67, 95, 49))).toBe(false);
    expect(isVertical(line('A', 10, 10, 20, 60))).toBe(false);
  });

  it('merges nearby vertical lines into one padded box', () => {
    const boxes = verticalBoxes(
      [
        line('Print or type.', 71, 411, 24, 108),
        line('See Specific Instructions', 92, 322, 23, 288),
      ],
      20,
      page,
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBeLessThanOrEqual(71);
    expect(boxes[0]!.y).toBeLessThanOrEqual(322);
  });

  it('cuts vertical text out as an image instead of writing it as a huge heading', () => {
    const { image, lines } = textPage([
      { text: 'Body text line one of the page', x: 100, y: 100, width: 500 },
      { text: 'Body text line two of the page', x: 100, y: 130, width: 500 },
      { text: 'Side logo', x: 900, y: 500, width: 30, h: 180 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const leaves = leafBlocks(doc);
    expect(leaves.filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain('Side logo');
  });
});

describe('mergeTextRegions (D-473)', () => {
  const r = (kind: string, x: number, y: number, width: number, height: number) => ({
    kind,
    box: { x, y, width, height },
  });
  it('joins stacked text regions with the same left edge, not columns or titles', () => {
    const out = mergeTextRegions(
      [r('text', 100, 100, 800, 50), r('text', 100, 160, 800, 25), r('title', 100, 200, 400, 30)],
      24,
    );
    expect(out.map((x) => x.kind)).toEqual(['text', 'title']);
    expect(out[0]!.box).toEqual({ x: 100, y: 100, width: 800, height: 85 });
    const cols = mergeTextRegions(
      [r('text', 100, 100, 400, 200), r('text', 520, 100, 400, 200)],
      24,
    );
    expect(cols).toHaveLength(2);
  });
});

describe('rule grids and diagrams (D-473)', () => {
  const cell = (i: number, text: string) => ({
    row: Math.floor(i / 6),
    col: i % 6,
    rowSpan: 1,
    colSpan: 1,
    text,
  });
  const grid = (filled: number, total: number): TableBlock => ({
    kind: 'table',
    rows: total / 6,
    col: 0,
    cols: 6,
    cells: Array.from({ length: total }, (_, i) => cell(i, i < filled ? 'x' : '')),
    box: { x: 0, y: 0, width: 100, height: 100 },
  });

  it('rejects a big grid that is mostly empty cells (form underlines), keeps real tables', () => {
    expect(isRuleGrid(grid(10, 60))).toBe(true);
    expect(isRuleGrid(grid(40, 60))).toBe(false);
    // 小的稀疏表（签字栏）不判。
    expect(isRuleGrid(grid(2, 12))).toBe(false);
  });

  it('rejects a layout grid: many positions but few (heavily merged) cells', () => {
    // 17 行 × 14 列只有 20 个格子：表单的版面，不是数据表（W-9 的上半页）。
    const layout = { ...grid(20, 20), rows: 17, cols: 14 };
    expect(isRuleGrid(layout)).toBe(true);
    // 8 × 6 每个位置都有格子：数据表。
    expect(isRuleGrid({ ...grid(48, 48), rows: 8, cols: 6 })).toBe(false);
  });

  it('keeps a well-structured merged form table (order form) but rejects paragraph-in-cell grids', () => {
    // 订货单：441 个位置、175 个格子（0.40），每格不到一行字：真表格，保留。
    const order = { ...grid(175, 175), rows: 21, cols: 21 };
    expect(isRuleGrid(order, 127)).toBe(false);
    // W-4：120 个位置、42 个格子（0.35），每格 1.8 行字：格子里是整段话，不当表格。
    const w4 = { ...grid(42, 42), rows: 15, cols: 8 };
    expect(isRuleGrid(w4, 74)).toBe(true);
    expect(isRuleGrid(w4, 30)).toBe(false);
  });

  it('keeps a labelled diagram as an image but not a block of prose lines', () => {
    const rects: Rect[] = [
      // 色块和线：字以外的图形。
      { x: 110, y: 110, width: 80, height: 80 },
      { x: 210, y: 110, width: 80, height: 80 },
      { x: 110, y: 210, width: 180, height: 60 },
    ];
    const box = { x: 100, y: 100, width: 200, height: 180 };
    const image = renderPage(W, H, rects);
    const labels = [line('Softmax', 120, 130, 60, 14), line('Linear', 220, 130, 60, 14)];
    expect(isDiagram(image, box, labels)).toBe(true);
    const prose = [line('This is a long sentence of ordinary prose text here', 100, 130, 190, 14)];
    expect(isDiagram(image, box, prose)).toBe(false);
    // 没有图形、只有标签（表单里认错的图片）不当示意图。
    expect(isDiagram(renderPage(W, H, []), box, labels)).toBe(false);
  });
});

describe('label column (D-473)', () => {
  it('splits a narrow label column from the content column, with full-width lines apart', () => {
    const labels = [0, 1, 2, 3, 4].map((i) => line(`Step ${i}`, 50, 200 + i * 40, 80));
    const contents = [0, 1, 2, 3, 4].map((i) =>
      line(`Content of step ${i}`, 250, 200 + i * 40, 600),
    );
    const across = line(
      'Complete steps 2 to 4 only if they apply to you, otherwise skip',
      50,
      100,
      800,
    );
    const split = splitLabelColumn([across, ...labels, ...contents], 20);
    expect(split).not.toBeNull();
    expect(split!.labels).toEqual(labels);
    expect(split!.contents).toEqual(contents);
    expect(split!.across).toEqual([across]);
  });

  it('leaves ordinary prose and two-column pages alone', () => {
    const prose = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      line(`Prose line ${i}`, 100, 100 + i * 25, 800),
    );
    expect(splitLabelColumn(prose, 20)).toBeNull();
    const columns = [0, 1, 2, 3, 4].flatMap((i) => [
      line(`left ${i}`, 100, 100 + i * 25, 380),
      line(`right ${i}`, 520, 100 + i * 25, 380),
    ]);
    expect(splitLabelColumn(columns, 20)).toBeNull();
  });
});

describe('small layout fixes (D-473)', () => {
  it('does not pair rows of very different height (logo and big title next to small print)', () => {
    // W-9 页眉的真实位置（缩到 1000 宽）：左边「Form」「W-9」大标志、小字，右边三行小字。
    const k = 0.8;
    const rows = [
      { text: 'Form', x: 71, y: 94, width: 42, h: 22 },
      { text: 'W-9', x: 109, y: 67, width: 95, h: 49 },
      { text: '(Rev. March 2024)', x: 73, y: 117, width: 122, h: 17 },
      { text: 'Department of the Treasury', x: 73, y: 138, width: 177, h: 18 },
      { text: 'Give form to the', x: 1039, y: 93, width: 145, h: 17 },
      { text: 'requester. Do not', x: 1037, y: 117, width: 161, h: 17 },
      { text: 'send to the IRS.', x: 1037, y: 139, width: 144, h: 17 },
    ].map((r) => ({ ...r, x: r.x * k, width: r.width * k }));
    const { image, lines } = textPage(rows);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const texts = leafBlocks(doc).flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    // 大标志不被配成「标签\t值」按小字的中位行高写。
    expect(texts.some((t) => t.includes('W-9') && t.includes('\t'))).toBe(false);
  });

  it('only calls letter-led, mostly-letter text a size-based heading', () => {
    expect(looksLikeHeading('Request for Taxpayer')).toBe(true);
    expect(looksLikeHeading('Displays (8) 40 Floor (40)')).toBe(false);
    expect(looksLikeHeading('# Customers Attended 35')).toBe(false);
    expect(looksLikeHeading('(if approved)')).toBe(false);
  });

  it('merges stacked two-column rows with the same columns into one row', () => {
    const para = (text: string, x: number, y: number): DocBlock => ({
      kind: 'paragraph',
      text,
      box: { x, y, width: 300, height: 20 },
    });
    const row = (y: number, a: string, b: string): DocRow => ({
      kind: 'row',
      cells: [
        { width: 400, blocks: [para(a, 100, y) as never] },
        { width: 400, blocks: [para(b, 520, y) as never] },
      ],
      box: { x: 100, y, width: 720, height: 20 },
    });
    const out = mergeColumnRows([row(100, 'L1', 'R1'), row(300, 'L2', 'R2')], 20);
    expect(out).toHaveLength(1);
    const merged = out[0] as DocRow;
    expect(merged.cells.map((c) => c.blocks.length)).toEqual([2, 2]);
    // 列位置不一样的两行不合并。
    const other = row(300, 'L2', 'R2');
    other.cells[1]!.blocks = [para('R2', 700, 300) as never];
    expect(mergeColumnRows([row(100, 'L1', 'R1'), other], 20)).toHaveLength(2);
  });
});

describe('persistent prose columns', () => {
  const unit = (text: string, x: number, y: number, width = 340, height = 80) => {
    const box = { x, y, width, height };
    return { box, blocks: [{ kind: 'paragraph' as const, text, box }] };
  };
  const body = () => [
    unit('L1', 100, 200),
    unit('R1', 520, 200),
    unit('L2 isolated', 100, 310),
    unit('L3', 100, 440),
    unit('R2 shorter', 520, 440, 250),
    unit('L4 tail', 100, 510, 300, 40),
  ];

  it('keeps isolated and trailing paragraphs in stable columns despite uneven ink widths', () => {
    const blocks = arrangeUnits(body(), 20);
    expect(blocks).toHaveLength(1);
    const row = blocks[0] as DocRow;
    expect(row.kind).toBe('row');
    expect(row.cells.map((c) => c.blocks.map((b) => (b as DocParagraph).text))).toEqual([
      ['L1', 'L2 isolated', 'L3', 'L4 tail'],
      ['R1', 'R2 shorter'],
    ]);
    expect(row.cells.map((c) => c.width)).toEqual([420, 340]);
  });

  it('ends a column scope at full-width content and keeps headers and distant footers outside', () => {
    const head = unit('Full width title', 100, 80, 760, 30);
    const author = unit('Author metadata', 100, 125, 280, 20);
    const across = unit('Spanning statement', 100, 400, 760, 25);
    const footer = unit('Page footer', 100, 700, 160, 20);
    const blocks = arrangeUnits([head, author, ...body(), across, footer], 20);
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
      'row',
      'paragraph',
      'row',
      'paragraph',
    ]);
    expect((blocks[2] as DocRow).cells[0]!.blocks.map((b) => (b as DocParagraph).text)).toEqual([
      'L1',
      'L2 isolated',
    ]);
    expect((blocks.at(-1) as DocParagraph).text).toBe('Page footer');
  });

  it('leaves sparse parallel fields and single-column prose on the existing path', () => {
    const fields = [
      unit('Seller', 100, 200, 140, 20),
      unit('Buyer', 520, 200, 140, 20),
      unit('Invoice note', 100, 300, 340, 20),
    ];
    expect(arrangeUnits(fields, 20).map((b) => b.kind)).toEqual(['row', 'paragraph']);
    expect(arrangeUnits([unit('A', 100, 200), unit('B', 100, 310)], 20).map((b) => b.kind)).toEqual(
      ['paragraph', 'paragraph'],
    );
  });

  it('extends a proven scope back into a narrow heading row without absorbing author metadata', () => {
    const blocks = arrangeUnits(
      [
        unit('Author metadata', 100, 160, 300, 20),
        unit('Opening prose', 100, 200),
        unit('Short title', 520, 200, 90, 20),
        unit('Continuing prose', 100, 310),
        unit('Right content', 520, 310),
      ],
      20,
    );
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'row']);
    expect((blocks[1] as DocRow).cells[1]!.blocks.map((b) => (b as DocParagraph).text)).toEqual([
      'Short title',
      'Right content',
    ]);
    expect((blocks[0] as DocParagraph).text).toBe('Author metadata');
  });

  it('starts a separate scope when the next column boundary changes', () => {
    const blocks = arrangeUnits(
      [unit('L1', 100, 200), unit('R1', 520, 200), unit('L2', 100, 310), unit('R2', 650, 310)],
      20,
    );
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as DocRow).cells[0]!.width).toBe(420);
    expect((blocks[1] as DocRow).cells[0]!.width).toBe(550);
  });

  it('retains separate bands for dense pages rather than creating a large pagination container', () => {
    const blocks = arrangeUnits(body(), 20, { dense: true });
    expect(blocks.map((b) => b.kind)).toEqual(['row', 'paragraph', 'row', 'paragraph']);
    expect(leafBlocks({ blocks }).map((b) => (b as DocParagraph).text)).toEqual([
      'L1',
      'R1',
      'L2 isolated',
      'L3',
      'R2 shorter',
      'L4 tail',
    ]);
  });

  it('infers alignment against the proven column, retaining genuinely centered and right-aligned text', () => {
    const rows = [
      { text: 'Full width heading across the page', x: 100, y: 60, width: 800 },
      ...[0, 1, 2, 3].map((i) => ({
        text: 'A sufficiently long prose line wraps across this column',
        x: 100,
        y: 200 + i * 25,
        width: 360,
      })),
      { text: 'Results', x: 520, y: 200, width: 80, h: 25 },
      { text: 'Right column text establishes the far edge', x: 520, y: 250, width: 380 },
      { text: 'Centered', x: 650, y: 300, width: 120 },
      { text: 'End', x: 850, y: 350, width: 50 },
      { text: 'Reference continuation', x: 520, y: 400, width: 375 },
      { text: '18.', x: 520, y: 430, width: 30 },
      ...[0, 1, 2, 3].map((i) => ({
        text: 'More ordinary prose continues down the left column',
        x: 100,
        y: 370 + i * 25,
        width: 360,
      })),
    ];
    const { image, lines } = textPage(rows);
    const regions: LayoutRegion[] = rows.map((r) => ({
      kind: 'text',
      label: 'text',
      score: 0.9,
      box: { x: r.x, y: r.y, width: r.width, height: r.h ?? 20 },
    }));
    const doc = buildDocPage({ image, lines, regions, source: 's', skew: 0 });
    const paras = leafBlocks(doc).filter((b): b is DocParagraph => b.kind === 'paragraph');
    const byText = (text: string) => paras.find((b) => b.text === text)!;
    expect(byText('Results').align).toBeUndefined();
    expect(byText('Reference continuation').align).toBeUndefined();
    expect(byText('18.').align).toBeUndefined();
    expect(byText('Centered').align).toBe('center');
    expect(byText('End').align).toBe('right');
  });
});

describe('ruled tables and barcodes (D-501)', () => {
  it('does not cut the empty part of a ruled table with many columns out as a barcode', () => {
    // 工资单下半截没字的地方只有一排平行的列线，按条形码剪成图片后是一条带黑竖线的空白图。
    const xs = Array.from({ length: 13 }, (_, i) => 100 + i * 65);
    const lines: OcrBox[] = [];
    const rects: Rect[] = [...gridRects(xs, [100, 140, 600])];
    for (let c = 0; c < 12; c++) {
      lines.push(fakeLine(`h${c}`, { x: xs[c]! + 15, y: 110, width: 35, height: 20 }, page));
      lines.push(fakeLine(`${c}.0`, { x: xs[c]! + 15, y: 150, width: 35, height: 20 }, page));
      rects.push(...glyphs(xs[c]! + 17, 113, 30, 14), ...glyphs(xs[c]! + 17, 153, 30, 14));
    }
    const doc = buildDocPage({ image: renderPage(W, H, rects), lines, source: 'p.jpg', skew: 0 });
    const leaves = leafBlocks(doc);
    expect(leaves.filter((b) => b.kind === 'table')).toHaveLength(1);
    expect(leaves.filter((b) => b.kind === 'image')).toHaveLength(0);
  });
});

describe('text left out of a table (D-501)', () => {
  it('a footer whose tall box covers the table’s bottom line comes out once, as text after the table', () => {
    // 照片里弯的一行页脚：识别框很高，罩住了表格的底线，横跨所有列线。它不进表，也不能丢。
    const xs = [100, 300, 500, 700, 900];
    const rects: Rect[] = [...gridRects(xs, [200, 240, 300])];
    const lines: OcrBox[] = [];
    for (let c = 0; c < 4; c++) {
      lines.push(fakeLine(`v${c}`, { x: xs[c]! + 40, y: 255, width: 80, height: 20 }, page));
      rects.push(...glyphs(xs[c]! + 44, 258, 72, 14));
    }
    // 中心刚过底线（离表格的框不到 0.3 个行高）：按框算会当成表里的字，表里又没放，就丢了。
    lines.push(fakeLine('Keep this payslip', { x: 100, y: 284, width: 800, height: 34 }, page));
    rects.push({ x: 300, y: 300, width: 2, height: 30 }, ...glyphs(110, 304, 780, 12));
    const doc = buildDocPage({ image: renderPage(W, H, rects), lines, source: 'p.jpg', skew: 0 });
    const leaves = leafBlocks(doc);
    const texts = leaves.flatMap((b) =>
      b.kind === 'table'
        ? b.table.cells.map((c) => c.text)
        : b.kind === 'paragraph'
          ? [b.text]
          : [],
    );
    expect(texts.filter((t) => t.includes('Keep this payslip'))).toEqual(['Keep this payslip']);
    expect(leaves.at(-1)).toMatchObject({ kind: 'paragraph', text: 'Keep this payslip' });
  });
});

describe('ruled tables whose column lines cut through words (D-502)', () => {
  it('are not used as tables; their text stays whole', () => {
    // 竖线从每行字的中间穿过（字的笔画、折痕认成了列线）：按这张表排，每行字被切成两半。
    const rects: Rect[] = [...gridRects([100, 400, 700], [100, 140, 180, 220])];
    const lines: OcrBox[] = [];
    for (let r = 0; r < 3; r++) {
      const text = `Consommations${r}annuelles`;
      lines.push(fakeLine(text, { x: 150, y: 110 + r * 40, width: 500, height: 20 }, page, true));
      rects.push(...glyphs(152, 113 + r * 40, 496, 14));
    }
    const doc = buildDocPage({ image: renderPage(W, H, rects), lines, source: 'p.jpg', skew: 0 });
    const leaves = leafBlocks(doc);
    expect(leaves.filter((b) => b.kind === 'table')).toHaveLength(0);
    const texts = leaves.flatMap((b) => (b.kind === 'paragraph' ? b.text.split('\n') : []));
    for (let r = 0; r < 3; r++) expect(texts.join(' ')).toContain(`Consommations${r}annuelles`);
  });
});
