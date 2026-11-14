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

  it('keeps receipt item lines apart when each has its own amount far to the right (EU sample 003)', () => {
    // 小票：「1 0,4 Schorle」「1 T-RINDERSTEAK」两行，右边隔得很远各有单价和金额；上面一行「Bed. 2 Rg.」
    // 让右边看着没有空。不是一段折行。
    const items = [
      line('10,4 Schorle', 52, 709, 214, 39),
      line('1 T-RINDERSTEAK', 51, 749, 246, 38),
    ];
    const peers = [
      line('Bed. 2 Rg.:244744', 373, 590, 330, 38),
      line('3.60', 503, 712, 73, 37),
      line('3.60', 631, 713, 75, 37),
      line('19.90', 491, 751, 86, 40),
      line('19.90', 620, 752, 86, 40),
    ];
    expect(paragraphsOf(items, peers)).toHaveLength(2);
    // 右边是正文（不是金额）时照旧按折行判断。
    const prose = peers.map((p) => ({ ...p, text: 'and so on' }));
    expect(paragraphsOf(items, prose)).toHaveLength(1);
  });

  it('keeps two short lines apart when a blank line height separates them (EU sample 041, 049)', () => {
    // 答案一列里上下两个「○ ja ○ nein」，中间空着将近一个行高：两行，不是一段折行。
    const a = line('Oja Onein', 1140, 930, 165, 28);
    const b = line('O ja O nein', 1140, 984, 165, 28);
    expect(paragraphsOf([a, b])).toHaveLength(2);
    // 平常行距的两行短行（窄栏里的折行）照样接成一段。
    expect(paragraphsOf([a, { ...b, y: 962 }])).toHaveLength(1);
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

  it('keeps centred letterhead lines apart when the next first word would have fit, and joins a wrapped centred title', () => {
    // 同一条中线、左边只差 9 和 15 像素（不到半个行高）。下面的正文写满 129–1239：
    // 「Telefon」接在上一行后面、照样居中也排得下，却换了行，是一行一行排的。
    const lines = [
      line('Praxis für Allgemeinmedizin · Dr. med. Lena Hartmann', 279, 158, 849, 37),
      line('Lindenstraße 14, 79098 Freiburg im Breisgau', 347, 207, 713, 41),
      line('Telefon 0761 555 0192 · Fax 0761 555 0193', 356, 256, 695, 37),
      line('Sprechzeiten Montag bis Freitag 8–12 Uhr', 371, 308, 666, 37),
    ];
    const body = line(
      'Ibuprofen 400 mg, one tablet up to three times a day with food',
      129,
      475,
      1110,
      40,
    );
    expect(paragraphsOf(lines, [body])).toHaveLength(4);
    // 居中的标题折成两行、两行差不多长：第二行的第一个词在这一栏的宽里放不下，是同一段。
    const title = [
      line('Annual report on the regional water quality of', 200, 100, 600, 40),
      line('measurements taken in the alpine lakes', 215, 145, 570, 40),
    ];
    const narrow = line('Body text of this column.', 200, 260, 600, 40);
    expect(paragraphsOf(title, [narrow])).toHaveLength(1);
  });

  it('does not take the widest of a few short lines as the right edge when the column around them is wider', () => {
    const pets = line(
      'Pets are allowed with the written consent of the landlord. Small',
      170,
      438,
      1081,
      46,
    );
    const lines = [
      line('Subletting is not permitted.', 170, 540, 318, 37),
      line('Inventory checked: Ok', 170, 603, 263, 31),
    ];
    // 同一栏里上面的正文写到 1251：「Inventory」接在 488 后面放得下，是两段。
    expect(paragraphsOf(lines, [pets])).toHaveLength(2);
    // 别的栏里的行（左边不齐）不算这一栏的宽。
    expect(paragraphsOf(lines, [{ ...pets, x: 700, width: 500 }])).toHaveLength(1);
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

  it('does not center a line that nearly fills the text width (EU sample 021)', () => {
    // 页眉的字比正文宽一点：接近整行宽的一行左右各空出两个多行高，不是居中的。
    const { image, lines } = textPage([
      { text: 'Gazette of the Region', x: 60, y: 100, width: 220, h: 22 },
      { text: 'No. 2292', x: 840, y: 100, width: 100, h: 22 },
      {
        text: 'He was employed at the company from the first of May until today',
        x: 110,
        y: 300,
        width: 780,
        h: 22,
      },
      { text: 'Short note', x: 110, y: 400, width: 120, h: 22 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const wide = leafBlocks(doc).find(
      (b): b is DocParagraph => b.kind === 'paragraph' && b.text.startsWith('He was'),
    )!;
    expect(wide.align).toBeUndefined();
  });

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

  it('keeps short text the layout model calls a page number unless it reads like one', () => {
    const { image, lines } = textPage([
      {
        text: 'Il Ministro decreta quanto segue per tutte le parti della legge',
        x: 100,
        y: 150,
        width: 800,
      },
      { text: 'Decreta:', x: 440, y: 1150, width: 120 },
      { text: 'Art. 1', x: 450, y: 1210, width: 100 },
      { text: 'n.a.', x: 100, y: 1270, width: 45 },
      { text: 'Pagina 2 di 3', x: 820, y: 1360, width: 140 },
    ]);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      regions: regions([
        ['text', 'text', { x: 90, y: 140, width: 820, height: 40 }],
        ['pageNumber', 'number', { x: 445, y: 1205, width: 110, height: 30 }],
        ['pageNumber', 'number', { x: 95, y: 1265, width: 55, height: 30 }],
        ['pageNumber', 'number', { x: 815, y: 1355, width: 150, height: 30 }],
      ]),
    });
    const text = leafBlocks(doc)
      .flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []))
      .join('\n');
    expect(text).toContain('Art. 1');
    expect(text).toContain('n.a.');
    // 真的页码照旧不写（D-334）。
    expect(text).not.toContain('Pagina 2');
  });

  it('does not take decorative asterisks or dashes around a line for a bullet', () => {
    const { image, lines } = textPage([
      { text: '*** ATTO COMPLETO ***', x: 380, y: 100, width: 240 },
      { text: 'Il testo segue qui sotto.', x: 100, y: 160, width: 300 },
      { text: '– Anmeldebestätigung –', x: 380, y: 260, width: 240 },
      { text: 'Bitte aufbewahren.', x: 100, y: 320, width: 250 },
      { text: '*********RECHNUNG**********', x: 340, y: 420, width: 320 },
      { text: 'Tisch: 137', x: 100, y: 480, width: 120 },
      { text: '- echter Punkt eins', x: 100, y: 580, width: 260 },
      { text: '- echter Punkt zwei', x: 100, y: 605, width: 260 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const leaves = leafBlocks(doc);
    const paragraphs = leaves.flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    expect(paragraphs).toContain('*** ATTO COMPLETO ***');
    expect(paragraphs).toContain('– Anmeldebestätigung –');
    expect(paragraphs).toContain('*********RECHNUNG**********');
    expect(leaves.filter((b) => b.kind === 'list')).toMatchObject([
      { items: ['echter Punkt eins', 'echter Punkt zwei'] },
    ]);
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

  it('starts a new numbered list when the number does not continue the last item (EU sample 037)', () => {
    const { image, lines } = textPage([
      { text: '1. Opening of the meeting', x: 100, y: 150, width: 420 },
      { text: '2. Reading of the rules', x: 100, y: 175, width: 400 },
      { text: '3. Any other business', x: 100, y: 200, width: 380 },
      { text: '1. Decisions:', x: 100, y: 225, width: 220 },
      { text: '1. The meeting opened at ten o’clock.', x: 100, y: 250, width: 560 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const shown = leafBlocks(doc).flatMap((b) =>
      b.kind === 'list' ? b.items.map((t, i) => `${(b.start ?? 1) + i} ${t}`) : [],
    );
    expect(shown).toEqual([
      '1 Opening of the meeting',
      '2 Reading of the rules',
      '3 Any other business',
      '1 Decisions:',
      '1 The meeting opened at ten o’clock.',
    ]);
  });

  it('keeps a force-justified line whose words OCR returned one by one as one line (EU sample 037)', () => {
    const words = ['whose', 'seat', 'is', 'set', 'at', '(full', 'address)'];
    const { image, lines } = textPage([
      {
        text: 'The meeting decided to found the association named below.',
        x: 100,
        y: 100,
        width: 800,
      },
      ...words.map((text, i) => ({ text, x: 100 + i * 120, y: 160, width: 60 })),
      { text: 'The chair then presents the draft statutes.', x: 100, y: 220, width: 620 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const texts = leafBlocks(doc).flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    expect(texts.some((t) => t.includes('whose seat is set at (full address)'))).toBe(true);
  });

  it('still splits a row whose far-apart pieces are not single words with even gaps', () => {
    const { image, lines } = textPage([
      { text: 'Atelier Lindenhof', x: 100, y: 100, width: 220 },
      { text: 'Rechnung RE-2026-0311', x: 600, y: 100, width: 300 },
    ]);
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    const texts = leafBlocks(doc).flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    expect(texts.some((t) => t.includes('Lindenhof Rechnung'))).toBe(false);
  });

  it('keeps each number of a numbered item column with its own text (EU sample 032)', () => {
    const items = [
      'Name of the manufacturer:',
      'Object of the declaration:',
      'The object is in conformity with the following Directives:',
      'References to the harmonised standards used:',
      'Additional information:',
    ];
    const rows = items.flatMap((text, i) => [
      { text: `${i + 2}.`, x: 100, y: 120 + i * 70, width: 24 },
      { text, x: 190, y: 120 + i * 70, width: 14 * text.length },
    ]);
    const { image, lines } = textPage(rows);
    // 版面模型把编号划进了一个大区域，第一项的条文另有一个小区域。
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      regions: regions([
        ['text', 'text', { x: 95, y: 110, width: 800, height: 380 }],
        ['text', 'text', { x: 105, y: 115, width: 500, height: 32 }],
      ]),
    });
    // 编号写成列表的编号也行：按列表的起始编号算出显示的编号。
    const texts = leafBlocks(doc).flatMap((b) =>
      b.kind === 'paragraph'
        ? [b.text]
        : b.kind === 'list'
          ? b.items.map((t, k) => `${(b.start ?? 1) + k}. ${t}`)
          : [],
    );
    for (const [i, text] of items.entries())
      expect(texts.some((t) => t.startsWith(`${i + 2}.`) && t.includes(text))).toBe(true);
    expect(leafBlocks(doc).some((b) => b.kind === 'paragraph' && b.text === '2.')).toBe(false);
  });

  it('does not centre a ragged-right paragraph whose lines share one left edge (EU sample 036)', () => {
    // 字的左右两边空得差不多（满版的图把整页文字的左右边撑到了纸边），但几行左边对齐、右边参差：左对齐。
    const { image, lines } = textPage([
      { text: 'A margin note sits at the far left.', x: 5, y: 60, width: 300 },
      {
        text: 'The programme supports schools and towns in planning their buildings',
        x: 160,
        y: 200,
        width: 680,
      },
      {
        text: 'and offers a library of tools, independent advice and a community',
        x: 160,
        y: 228,
        width: 600,
      },
      { text: 'A footer mark sits at the far right.', x: 690, y: 1300, width: 305 },
    ]);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: 0,
      paper: { width: 595, height: 842 },
    });
    const para = leafBlocks(doc).find(
      (b): b is DocParagraph => b.kind === 'paragraph' && b.text.startsWith('The programme'),
    );
    expect(para?.text).toContain('and offers a library');
    expect(para?.align).toBeUndefined();
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

  it('keeps a short tall code printed white on a coloured band (EU sample 056)', () => {
    // 表单抬头的绿条上白色的大字「A1」：短、高、离别的字远，但不是污点。
    const code = { x: 120, y: 120, width: 80, height: 70 };
    const white: Rect[] = [];
    for (let s = 0; s + 6 <= code.width; s += 14)
      white.push({ x: code.x + s, y: code.y + 12, width: 6, height: 46, shade: 255 });
    const band: Rect = { x: 100, y: 100, width: 800, height: 110, color: [74, 140, 63] };
    const { image, lines } = textPage(
      [
        { text: 'INFORMATION FOR THE HOLDER', x: 100, y: 400, width: 400 },
        {
          text: 'This certificate concerns the legislation which applies to you.',
          x: 100,
          y: 440,
          width: 800,
        },
      ],
      [...white, band],
    );
    const a1 = fakeLine('A1', code, page);
    const doc = buildDocPage({ image, lines: [a1, ...lines], source: 's', skew: 0 });
    const texts = leafBlocks(doc).map((b) => (b.kind === 'paragraph' ? b.text : ''));
    expect(texts).toContain('A1');
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

  it('sizes text on a landscape page by the landscape paper width, not the portrait A4 width (EU sample 017)', () => {
    // 横向 A4（842 × 595 磅）渲染成 1400 × 990 像素：20 像素高的行约 842 × 0.9 × 20 / 1400 ≈ 11 磅。
    const LW = 1400;
    const LH = 990;
    const rects: Rect[] = [];
    const lines: OcrBox[] = [];
    [
      'An editable paragraph on a landscape source page.',
      'The same landscape page continues with a second line.',
      'And a third body line keeps the size estimate stable.',
    ].forEach((text, i) => {
      const y = 100 + i * 45;
      for (let s = 0; s + 2 <= 900; s += 9)
        rects.push({ x: 80 + s, y: y + 4, width: 2, height: 12 });
      lines.push(fakeLine(text, { x: 80, y, width: 900, height: 20 }, { width: LW, height: LH }));
    });
    const image = renderPage(LW, LH, rects);
    const pdf = buildDocPage({
      image,
      lines,
      source: 's',
      paper: { width: 841.9, height: 595.3 },
      skew: 0,
    });
    // 旧的按 595 磅估：约 7.7 磅（只有原来的 0.71 倍），再被正文下限抬到 9 磅。
    expect(pdf.bodySize).toBeGreaterThanOrEqual(10.5);
    // 横拍的照片没有纸张信息，Word 的纸也按横向 A4：字一样大。
    expect(buildDocPage({ image, lines, source: 's', skew: 0 }).bodySize).toBe(pdf.bodySize);
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
  it('gives a photo without paper metadata a page with its own proportions', () => {
    const page = (width: number, height: number) => {
      const lines = [
        fakeLine('Corner Bakery', { x: 150, y: 80, width: 300, height: 30 }, { width, height }),
        fakeLine(
          'Total 12.50',
          { x: 150, y: height - 200, width: 260, height: 30 },
          { width, height },
        ),
      ];
      return buildDocPage({
        image: renderPage(
          width,
          height,
          lines.flatMap((l) => glyphs(l.x, l.y + 6, l.width, 18)),
        ),
        lines,
        source: 'receipt.jpg',
        skew: 0,
      });
    };
    // 不是 A4 比例的一页纸（如 Letter）：纸的高宽比和照片一样，横竖用同一个比例，不把竖向压扁。
    const letter = page(1000, 1290);
    expect(letter.paper!.width).toBeCloseTo(595.3, 1);
    expect(letter.paper!.height / letter.paper!.width).toBeCloseTo(1290 / 1000, 3);
    // 接近 A4 比例的照片仍是 A4；竖长的小票不设纸，按旧版连续排、自然分页（不压扁成一页 A4）。
    expect(page(1000, 1400).paper).toEqual({ width: 595.3, height: 841.9 });
    expect(page(600, 1500).paper).toBeUndefined();
    expect(page(600, 2400).paper).toBeUndefined();
  });
  it('fits a PDF page far larger than A3 (a scan stored at one point per pixel) to A4 width', () => {
    const { image, lines } = textPage([
      {
        text: 'Montant total prélevé ce mois-ci sur votre compte bancaire',
        x: 60,
        y: 150,
        width: 800,
      },
      { text: 'Le détail de vos communications se trouve en page 2.', x: 60, y: 180, width: 700 },
    ]);
    const build = (paper: { width: number; height: number }) =>
      buildDocPage({ image, lines, source: 's', paper, skew: 0 });
    const scan = build({ width: 2481, height: 3508.5 });
    const a4 = build({ width: 595.3, height: 841.9 });
    expect(scan.paper!.width).toBeCloseTo(595.3, 1);
    expect(scan.paper!.height / scan.paper!.width).toBeCloseTo(3508.5 / 2481, 3);
    // 字号、页边和 A4 原件一样，不因为纸大就把字缩成一小团。
    expect(scan.bodySize).toBe(a4.bodySize);
    expect(scan.margins!.left).toBeCloseTo(a4.margins!.left, 0);
    // 横向的大纸按 A4 长边；A3 和 Letter、Legal 这类真实纸张照旧。
    expect(build({ width: 3508.5, height: 2481 }).paper!.width).toBeCloseTo(841.9, 1);
    expect(build({ width: 841.9, height: 1190.6 }).paper).toEqual({ width: 841.9, height: 1190.6 });
    expect(build({ width: 612, height: 1008 }).paper).toEqual({ width: 612, height: 1008 });
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

  it('keeps the letter-width size of an all-capitals heading on known paper, only removing the body-minimum inflation', () => {
    // 全大写的行没有上下伸的字母，识别框比同字号的正文矮：框高只说 1.2 倍，字宽说 1.41 倍（D-463 按字宽）。
    const px = (text: string, size: number) => Math.round(textEm(text) * size);
    const body = [
      'Docteur Claire FONTAINE',
      'Ophtalmologiste diplômée',
      'Ancienne assistante des hôpitaux',
      'Réf. cabinet 2026-0417',
      'Vallon le 11/05/2026',
    ];
    const title = 'ORDONNANCE DE LUNETTES';
    const rows = [
      ...body.map((text, i) => ({ text, x: 100, y: 100 + i * 60, width: px(text, 17) })),
      { text: title, x: 300, y: 500, width: px(title, 24), h: 24 },
    ];
    const { image, lines } = textPage(rows);
    const sizes = (paper: { width: number; height: number }) => {
      const doc = buildDocPage({ image, lines, source: 's', paper, skew: 0 });
      const para = (doc.blocks as DocParagraph[]).find((p) => p.text === title)!;
      return { body: doc.bodySize, title: para.size ?? doc.bodySize };
    };
    const a4 = sizes({ width: 595.3, height: 841.9 });
    expect(a4.title / a4.body).toBeCloseTo(24 / 17, 1);
    // 窄纸（D-533）：正文按物理宽度约 5.4 磅，被抬到最小字号 6 磅；标题按原图约 7.6 磅，不跟着这次抬高再放大。
    const narrow = sizes({ width: 300, height: 420 });
    expect(narrow.body).toBe(6);
    expect(narrow.title).toBeLessThanOrEqual(8);
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

  it('keeps stacked short lines apart when the next word would fit in the room to their right (EU sample 023, 025)', () => {
    // 地址：最宽的一行看着写满了这一块，可是右边一直空到整页的右边（或者右边隔得很远的另一块）。
    const address = [
      line('Atelier Garance', 600, 100, 150),
      line('Camille Rousseau', 600, 125, 165),
      line('8 place du Marché', 600, 150, 175),
      line('69002 Lyon', 600, 175, 105),
    ];
    expect(paragraphsOf(address, [], 950)).toHaveLength(4);
    expect(
      paragraphsOf(
        address.map((l) => ({ ...l, x: l.x - 500 })),
        [line('Kunden-Nr.: 1004711', 700, 110, 200)],
      ),
    ).toHaveLength(4);
    // 窄栏的正文：右边隔一条窄缝就是另一栏，下一个词放不下，照样是折行。
    const column = [
      line('Die Abschläge haben', 100, 100, 200),
      line('wir an Ihren Verbrauch', 100, 125, 190),
      line('angepasst.', 100, 150, 100),
    ];
    expect(paragraphsOf(column, [line('Rechte Spalte mit Text', 340, 110, 220)], 600)).toHaveLength(
      1,
    );
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

  it('sizes long lines of a slightly skewed scan by their text, not their taller box (EU sample 050)', () => {
    // 斜 0.57°：左右两块同一排的字右边低 7 像素；很长的页脚行的框比字高出 宽 × 斜率。
    const slope = 0.01;
    const rows = [0, 1, 2, 3, 4, 5].flatMap((i) => [
      { text: `Anreise ${i}`, x: 100, y: 200 + i * 40, width: 150 },
      { text: `Datum ${i}`, x: 800, y: 200 + i * 40 + Math.round(700 * slope), width: 150 },
    ]);
    const footer = 'Hotel am See | Seestraße 12 | 5020 Salzburg | Austria | T: +43 662 000000';
    const { image, lines } = textPage([
      ...rows,
      { text: footer, x: 150, y: 1200, width: 700, h: Math.round(20 + 700 * slope) },
    ]);
    const doc = buildDocPage({
      image,
      lines,
      source: 's',
      skew: (Math.atan(slope) * 180) / Math.PI,
    });
    const p = leafBlocks(doc).find(
      (b): b is DocParagraph => b.kind === 'paragraph' && b.text.startsWith('Hotel'),
    )!;
    expect(p.heading).toBeUndefined();
    expect(p.size ?? doc.bodySize).toBeLessThanOrEqual(doc.bodySize * 1.1);
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

describe('answer column beside clauses (EU sample 041)', () => {
  const para = (text: string, x: number, y: number, width: number, height: number) => ({
    kind: 'paragraph' as const,
    text,
    box: { x, y, width, height },
  });

  it('gives each short answer its own row with the clauses up to the one it stands beside', () => {
    // 一个区域里四段条款（一段没有答案），右边一列「○ ja ○ nein」各对着一段条款的最后一行。
    const clauses = [
      para('Sie darf in allen Angelegenheiten entscheiden und befugt sein.', 150, 100, 850, 90),
      para('Solange es erforderlich ist, darf sie', 150, 230, 400, 25),
      para('über meine freiheitsentziehende Unterbringung', 190, 280, 700, 25),
      para('über ärztliche Zwangsmaßnahmen nach dem Gesetz entscheiden.', 190, 330, 800, 60),
    ];
    const answers = [
      para('○ ja ○ nein', 1140, 162, 165, 28),
      para('○ ja ○ nein', 1140, 278, 165, 28),
      para('○ ja ○ nein', 1140, 362, 165, 28),
    ];
    const units = [
      { box: { x: 150, y: 100, width: 850, height: 290 }, blocks: clauses },
      ...answers.map((a) => ({ box: a.box, blocks: [a] })),
    ];
    const out = arrangeUnits(units, 28);
    const rows = out.filter((b): b is DocRow => b.kind === 'row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.cells.map((c) => c.blocks.length))).toEqual([
      [1, 1],
      [2, 1],
      [1, 1],
    ]);
    expect((rows[1]!.cells[0]!.blocks[0] as DocParagraph).text).toMatch(/^Solange/);
  });

  it('keeps a column of prose beside prose as one row', () => {
    const left = [para('Lorem ipsum dolor sit amet, a long paragraph.', 100, 100, 500, 90)];
    const right = [
      para('Another long paragraph of prose in the right column here.', 700, 100, 500, 90),
      para('And a second paragraph of prose in the right column here.', 700, 220, 500, 90),
    ];
    const units = [
      { box: { x: 100, y: 100, width: 500, height: 90 }, blocks: left },
      { box: { x: 700, y: 100, width: 500, height: 210 }, blocks: right },
    ];
    const rows = arrangeUnits(units, 28).filter((b) => b.kind === 'row');
    expect(rows).toHaveLength(1);
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
