import { describe, expect, it } from 'vitest';

import { arrangeUnits, buildDocPage, leafBlocks, insertWordFigures, type DocBlock } from './doc';
import type { LayoutRegion } from './layout';
import {
  fakeLine,
  glyphs,
  gridRects,
  renderPage,
  textConservation,
  type Rect,
} from './test-helpers';
import type { OcrBox } from './types';
import { restoreWordCellSpans } from './word-cell-spans';

const size = { width: 1000, height: 1400 };
const hint = (
  kind: LayoutRegion['kind'],
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutRegion => ({ kind, label, score: 0.9, box: { x, y, width, height } });
const line = (text: string, x: number, y: number, width: number, height = 20): OcrBox =>
  fakeLine(text, { x, y, width, height }, size);
const text = (page: ReturnType<typeof buildDocPage>) =>
  leafBlocks(page)
    .flatMap((b) =>
      b.kind === 'paragraph'
        ? [b.text]
        : b.kind === 'list'
          ? b.items
          : b.kind === 'table'
            ? b.table.cells.map((c) => c.text)
            : [],
    )
    .join(' ');
function fixture() {
  const picture = hint('image', 'image', 100, 100, 700, 240);
  const caption = hint('text', 'figure_title', 100, 365, 700, 25);
  const labels = [
    line('Encoder', 130, 125, 90),
    line('<TR><TD>1</TD><TD colspan="2">', 400, 125, 260),
    line('Structure tags', 130, 205, 130),
    line('Output boxes', 400, 205, 120),
  ];
  const outside = [
    line('Figure 1: Pipeline overview.', 100, 365, 380),
    line('Ordinary body text remains editable after the diagram.', 100, 460, 750),
    line('The next body line remains outside the preserved picture.', 100, 490, 750),
  ];
  const rects: Rect[] = gridRects([110, 300, 520, 790], [110, 180, 250, 330], { thickness: 2 });
  return {
    picture,
    caption,
    labels,
    outside,
    image: renderPage(size.width, size.height, rects),
    lines: [...labels, ...outside],
  };
}

describe('Word figure ownership', () => {
  it('does not take a whole cover page with its title as one uncaptioned picture (EU sample 036)', () => {
    // 右半是照片、左上是深色标题带：版面模型给一个盖满整页的图框，里面只有四行字。
    const image = renderPage(size.width, size.height, [
      { x: 560, y: 0, width: 440, height: 1400, shade: 120 },
      { x: 0, y: 140, width: 670, height: 280, shade: 40 },
    ]);
    const lines = [
      line('Contrato modelo', 110, 230, 420, 50),
      line('Arrendamiento de vivienda', 110, 290, 540, 42),
      line('Programa', 150, 1250, 120),
      line('Vivienda Escolar', 60, 1275, 210),
    ];
    const page = buildDocPage({
      image,
      lines,
      source: 'p.jpg',
      regions: [hint('image', 'image', 0, 0, 1000, 1400)],
    });
    expect(text(page)).toContain('Contrato modelo');
    expect(text(page)).toContain('Vivienda Escolar');
    expect(leafBlocks(page).some((b) => b.kind === 'image' && b.box.width > 900)).toBe(false);
  });

  it('keeps a tall margin graphic beside the complete figure-caption-body band', () => {
    const figure = { x: 100, y: 200, width: 800, height: 250 },
      margin = { x: 60, y: 180, width: 35, height: 600 };
    const caption = {
      kind: 'paragraph' as const,
      text: 'Caption',
      box: { x: 100, y: 470, width: 800, height: 30 },
    };
    const body = {
      kind: 'paragraph' as const,
      text: 'Body',
      box: { x: 100, y: 520, width: 800, height: 400 },
    };
    const next = insertWordFigures(
      { source: 'p.jpg', width: 1000, height: 1400, bodySize: 11, blocks: [caption, body] },
      [margin, figure],
    );
    expect(next.blocks).toHaveLength(1);
    const row = next.blocks[0]!;
    expect(
      row.kind === 'row' &&
        row.cells[1]!.blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.kind)),
    ).toEqual(['image', 'Caption', 'Body']);
  });
  it('puts a figure inside one column of a two-column row back into that column, above its caption', () => {
    const para = (text: string, x: number, y: number, height = 60) => ({
      kind: 'paragraph' as const,
      text,
      box: { x, y, width: 520, height },
    });
    const figure = { x: 724, y: 413, width: 560, height: 259 };
    const left = [para('Left start', 133, 334, 190), para('Left end', 133, 742, 140)];
    const right = [
      para('Right start', 733, 336),
      para('Figure 1', 734, 691, 27),
      para('Right end', 733, 746, 140),
    ];
    const next = insertWordFigures(
      {
        source: 'p.pdf',
        width: 1408,
        height: 2016,
        bodySize: 10.5,
        blocks: [
          {
            kind: 'row',
            box: { x: 132, y: 280, width: 1132, height: 654 },
            cells: [
              { width: 599, blocks: left },
              { width: 542, blocks: right },
            ],
          },
        ],
      },
      [figure],
    );
    expect(next.blocks).toHaveLength(1);
    const row = next.blocks[0]!;
    const texts = (blocks: readonly DocBlock[]) =>
      blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.kind));
    expect(row.kind === 'row' && row.cells.map((c) => texts(c.blocks))).toEqual([
      ['Left start', 'Left end'],
      ['Right start', 'image', 'Figure 1', 'Right end'],
    ]);
  });
  it('places a wide figure before its caption when a stale model row still starts above the figure', () => {
    const figure = { x: 100, y: 200, width: 800, height: 250 };
    const caption = {
      kind: 'paragraph' as const,
      text: 'Figure caption',
      box: { x: 100, y: 470, width: 800, height: 30 },
    };
    const body = {
      kind: 'paragraph' as const,
      text: 'Editable body',
      box: { x: 100, y: 550, width: 800, height: 300 },
    };
    const next = insertWordFigures(
      {
        source: 'p.jpg',
        width: 1000,
        height: 1400,
        bodySize: 11,
        blocks: [
          {
            kind: 'row',
            box: { x: 80, y: 180, width: 840, height: 600 },
            cells: [{ width: 840, blocks: [{ kind: 'image', box: figure }, caption] }],
          },
          {
            kind: 'row',
            box: { x: 80, y: 180, width: 840, height: 800 },
            cells: [{ width: 840, blocks: [body] }],
          },
        ],
      },
      [figure],
    );
    expect(leafBlocks(next).map((b) => (b.kind === 'paragraph' ? b.text : b.kind))).toEqual([
      'image',
      'Figure caption',
      'Editable body',
    ]);
    expect(next.blocks[1]!.box.y).toBe(caption.box.y);
  });
  it('restores adjacent labels together when a coarse grid splits both labels in one shared cell', () => {
    const box = { x: 100, y: 100, width: 800, height: 40 };
    const xs = [100, 400, 500, 600, 700, 900];
    const block = {
      kind: 'table' as const,
      box,
      colWidths: xs.slice(1).map((x, i) => x - xs[i]!),
      table: {
        kind: 'table' as const,
        box,
        col: 0,
        rows: 1,
        cols: 5,
        cells: xs.slice(0, -1).map((x, i) => ({
          row: 0,
          col: i,
          rowSpan: 1,
          colSpan: 1,
          box: { ...box, x, width: xs[i + 1]! - x },
          text: ['Vehicle identifi', 'cation number  Ge', 'nre', '  Other ', 'label'][i]!,
        })),
      },
    };
    const lines = [
      fakeLine(
        'Vehicle identification number',
        { x: 110, y: 110, width: 480, height: 20 },
        size,
        true,
      ),
      fakeLine('Genre  Other label', { x: 580, y: 110, width: 300, height: 20 }, size, true),
    ];
    // 故意按粗网格分配原字，第二行的开头和第一行的末尾落在同一格。
    for (const c of block.table.cells)
      c.text = lines
        .map((l) =>
          l
            .chars!.filter(
              (ch) =>
                l.x + ch.at * l.width >= c.box.x && l.x + ch.at * l.width < c.box.x + c.box.width,
            )
            .map((ch) => ch.text)
            .join(''),
        )
        .filter(Boolean)
        .join(' ');
    restoreWordCellSpans(block, renderPage(1000, 1400, []), lines, (ls) =>
      ls.map((l) => l.text).join(' '),
    );
    expect(block.table.cells.filter((c) => c.text.trim()).map((c) => c.text)).toEqual([
      lines.map((l) => l.text).join('\t'),
    ]);
  });
  it('separates a full-width label below writing fields from the preceding text in the same coarse row', () => {
    const image = renderPage(1100, 1400, [
      ...gridRects([100, 1000], [300, 550, 800], { thickness: 2 }),
      ...[400, 700].flatMap((x) => [300, 550].map((y) => ({ x, y, width: 2, height: 180 }))),
    ]);
    const lines = [
      fakeLine(
        'Registration',
        { x: 150, y: 440, width: 180, height: 24 },
        { width: 1100, height: 1400 },
        true,
      ),
      fakeLine(
        'Vehicle identification number and category',
        { x: 150, y: 510, width: 700, height: 24 },
        { width: 1100, height: 1400 },
        true,
      ),
      fakeLine(
        'Owner',
        { x: 150, y: 760, width: 180, height: 24 },
        { width: 1100, height: 1400 },
        true,
      ),
    ];
    const table = leafBlocks(buildDocPage({ image, lines, source: 'form.jpg', skew: 0 })).find(
      (b) => b.kind === 'table',
    );
    expect(
      table?.kind === 'table' && table.table.cells.filter((c) => c.text.trim()).map((c) => c.text),
    ).toEqual(lines.map((l) => l.text));
  });
  it('keeps a body line editable when only part of its OCR box overlaps a native figure', () => {
    const f = fixture();
    const body = line('Editable body continues below the diagram.', 100, 320, 500, 30);
    const page = buildDocPage({
      image: f.image,
      lines: [...f.lines, body],
      source: 'mixed.jpg',
      nativeFigures: [f.picture.box],
    });
    expect(textConservation(page, [...f.lines, body])).toEqual({ missing: [], extra: [] });
    expect(text(page)).toContain(body.text);
  });
  it('keeps labels inside a native figure as text when their PDF text is not drawn into the crop', () => {
    // 轴标签和图右边的说明在同一段 PDF 文字里：这段字只有约六成在图里，不画进剪图；
    // 图里的标签就不能当成图的一部分从正文里去掉，不然哪儿都没有。
    const f = fixture();
    const loose = { x: 120, y: 120, width: 860, height: 110 };
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      source: 'chart.pdf',
      nativeFigures: [f.picture.box],
      nativeText: [loose],
    });
    for (const label of ['Encoder', 'Structure tags', 'Output boxes'])
      expect(text(page)).toContain(label);
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
    // 画进了剪图的字（不在 nativeText 里）照旧归图。
    const drawn = buildDocPage({
      image: f.image,
      lines: f.lines,
      source: 'chart.pdf',
      nativeFigures: [f.picture.box],
      nativeText: [],
    });
    expect(text(drawn)).not.toContain('Encoder');
  });
  it('keeps complete pictures side by side even when crop margins narrow the white gutter', () => {
    const a = { x: 20, y: 100, width: 200, height: 150 },
      b = { ...a, x: 222 };
    const result = arrangeUnits(
      [a, b].map((box) => ({ box, blocks: [{ kind: 'image', box }] })),
      20,
    );
    expect(result[0]?.kind === 'row' && result[0].cells).toHaveLength(2);
  });
  it('retains outside paragraph formatting when native figure labels leave the font statistics', () => {
    const f = fixture();
    const prior = buildDocPage({ image: f.image, lines: f.lines, source: 'same.jpg' });
    const body = leafBlocks(prior).find(
      (b) => b.kind === 'paragraph' && b.text.includes('Ordinary body'),
    );
    if (!body || body.kind !== 'paragraph') throw new Error('fixture');
    body.size = 17.5;
    body.bold = true;
    body.color = '114477';
    const next = buildDocPage({
      image: f.image,
      lines: f.lines,
      source: 'same.jpg',
      nativeFigures: [f.picture.box],
      prior,
    });
    expect(next.bodySize).toBe(prior.bodySize);
    expect(
      leafBlocks(next).find((b) => b.kind === 'paragraph' && b.text === body.text),
    ).toMatchObject({ size: 17.5, bold: true, color: '114477' });
    expect(leafBlocks(next).filter((b) => b.kind === 'image')).toHaveLength(1);
  });
  it('retains distinct table values when the OCR character gaps already prove separate columns', () => {
    const image = renderPage(1100, 1400, [
      ...gridRects([100, 1000], [300, 550, 800], { thickness: 2 }),
      ...[400, 700].flatMap((x) => [300, 550].map((y) => ({ x, y, width: 2, height: 180 }))),
    ]);
    const text = 'Alpha Beta Gamma';
    const xs = [150, 170, 190, 210, 230, 350, 450, 470, 490, 510, 650, 750, 770, 790, 810, 830];
    const lines = [
      {
        text,
        x: 150,
        y: 510,
        width: 700,
        height: 24,
        chars: [...text].map((text, i) => ({ text, at: (xs[i]! - 150) / 700 })),
      },
      fakeLine(
        'Owner',
        { x: 150, y: 760, width: 180, height: 24 },
        { width: 1100, height: 1400 },
        true,
      ),
    ];
    const table = leafBlocks(buildDocPage({ image, lines, source: 'values.jpg', skew: 0 })).find(
      (b) => b.kind === 'table',
    );
    expect(
      table?.kind === 'table' && table.table.cells.filter((c) => c.text.trim()).map((c) => c.text),
    ).toEqual(['Alpha', 'Beta', 'Gamma', 'Owner']);
  });
  it('keeps a form label across short field dividers that end above the text', () => {
    const image = renderPage(1100, 1400, [
      ...gridRects([100, 1000], [300, 550, 800], { thickness: 2 }),
      ...[400, 700].flatMap((x) => [300, 550].map((y) => ({ x, y, width: 2, height: 180 }))),
    ]);
    const lines = [
      fakeLine(
        'Vehicle identification number and category',
        { x: 150, y: 510, width: 700, height: 24 },
        { width: 1100, height: 1400 },
        true,
      ),
      fakeLine(
        'Owner',
        { x: 150, y: 760, width: 180, height: 24 },
        { width: 1100, height: 1400 },
        true,
      ),
    ];
    const page = buildDocPage({ image, lines, source: 'form.jpg', skew: 0 });
    const table = leafBlocks(page).find((b) => b.kind === 'table');
    expect(
      table?.kind === 'table' && table.table.cells.filter((c) => c.text.trim()).map((c) => c.text),
    ).toEqual(lines.map((l) => l.text));
  });
  it('keeps parallel form-header paragraphs side by side when their OCR boxes barely overlap', () => {
    const blocks = [
      {
        kind: 'paragraph' as const,
        text: 'Ministry',
        box: { x: 20, y: 50, width: 140, height: 60 },
      },
      {
        kind: 'paragraph' as const,
        text: 'Application title',
        box: { x: 145, y: 40, width: 600, height: 25 },
      },
    ];
    const result = arrangeUnits([{ box: { x: 20, y: 40, width: 725, height: 70 }, blocks }], 20);
    expect(result[0]?.kind).toBe('row');
    expect(result[0]?.kind === 'row' && result[0].cells).toHaveLength(2);
    expect(leafBlocks({ blocks: result }).map((b) => b.kind === 'paragraph' && b.text)).toEqual([
      'Ministry',
      'Application title',
    ]);
  });
  it('places a source-PDF diagram in flow before its editable caption, even when its grid fooled table detection', () => {
    const f = fixture();
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      source: 'diagram.jpg',
      // 原始 PDF 已证明这些像素是图；不能再次被表格/短标签的启发式否决。
      nativeFigures: [f.picture.box],
    } as Parameters<typeof buildDocPage>[0]);
    const blocks = leafBlocks(page);
    expect(blocks.filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(blocks.find((b) => b.kind === 'image')).toMatchObject({ box: f.picture.box });
    expect(text(page)).toContain('Figure 1: Pipeline overview.');
    expect(text(page)).toContain('Ordinary body text');
    expect(text(page)).not.toContain('Encoder');
    expect(blocks.every((b) => b.kind !== 'image' || !b.background)).toBe(true);
  });
  it('retains existing vertical-text crops while adapting the writing direction of a landscape page', () => {
    const image = renderPage(1400, 1000, gridRects([700, 850, 1000, 1150], [100, 500, 900]));
    const lines = [700, 850, 1000].flatMap((x, c) =>
      [100, 500].map((y, r) => ({
        text: `Vertical ${r}-${c}`,
        x: x + 35,
        y: y + 30,
        width: 24,
        height: 180,
      })),
    );
    lines.push(
      ...[180, 230, 280, 1300].map((x, i) => ({
        text: `Long header number ${i}`,
        x,
        y: 100,
        width: 24,
        height: 280,
      })),
    );
    const before = buildDocPage({ image, lines, source: 's', skew: 0 });
    const after = buildDocPage({
      image,
      lines,
      paper: { width: 840, height: 600 },
      source: 's',
      skew: 0,
    });
    const pictures = (page: typeof before) =>
      leafBlocks(page)
        .filter((b) => b.kind === 'image')
        .map((b) => b.box);
    expect(pictures(before).length).toBeGreaterThan(0);
    expect(pictures(after)).toEqual(pictures(before));
  });

  it('keeps predominantly rotated table text editable in its source direction', () => {
    const image = renderPage(1400, 1000, gridRects([100, 240, 380, 520], [100, 360, 620, 880]));
    const lines = [100, 240, 380].flatMap((x, c) =>
      [100, 360, 620].map((y, r) => ({
        text: `Vertical ${r + 1}-${c + 1}`,
        x: x + 40,
        y: y + 30,
        width: 24,
        height: 180,
      })),
    );
    const page = buildDocPage({
      image,
      lines,
      paper: { width: 840, height: 600 },
      source: 's',
      skew: 0,
    });
    const table = leafBlocks(page).find((b) => b.kind === 'table');
    expect(table && 'direction' in table && table.direction).toBe('tbRl');
    expect(text(page)).toContain('Vertical 3-3');
  });

  it('centers a symmetric source heading over two lines on known paper', () => {
    const heading = [
      line('A source title', 200, 100, 600, 80),
      line('Over two lines', 200, 180, 600, 80),
    ];
    const body = Array.from({ length: 5 }, (_, i) =>
      line('Editable body text.', 100, 400 + i * 30, 600, 20),
    );
    const page = buildDocPage({
      image: renderPage(size.width, size.height, []),
      lines: [...heading, ...body],
      regions: [hint('title', 'doc_title', 200, 100, 600, 160)],
      paper: { width: 600, height: 840 },
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, [...heading, ...body])).toEqual({ missing: [], extra: [] });
    const title = leafBlocks(page).find((b) => b.kind === 'paragraph' && b.heading === 1);
    expect(title && 'align' in title && title.align).toBe('center');
  });

  it('separates a chart from a false ruled grid while retaining the real data below it', () => {
    const picture = hint('image', 'chart', 100, 100, 700, 240);
    const rows = [460, 510, 560].flatMap((y, i) => [
      line(`Service ${i + 1}`, 120, y, 150),
      line(`${20 + i}`, 350, y, 80),
      line(`${40 + i}.50`, 600, y, 90),
    ]);
    const image = renderPage(size.width, size.height, [
      ...gridRects([100, 300, 550, 800], [80, 350, 450, 500, 550, 600]),
      ...[150, 300, 450, 600].map((x) => ({ x, y: 120, width: 100, height: 180 })),
    ]);
    const page = buildDocPage({
      image,
      lines: rows,
      regions: [picture, hint('table', 'table', 100, 450, 700, 150)],
      source: 's',
      skew: 0,
    });
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(text(page)).toContain('Service 1');
    expect(text(page)).toContain('42.50');
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.box.y).toBeGreaterThanOrEqual(picture.box.y + picture.box.height);
  });

  it('keeps many short fields editable on a colorful form with an uncaptioned image proposal', () => {
    const box = { x: 50, y: 100, width: 900, height: 1000 };
    const fields = Array.from({ length: 18 }, (_, i) =>
      line(`Field ${i + 1}: ${100 + i}`, 100 + (i % 3) * 260, 150 + Math.floor(i / 3) * 100, 200),
    );
    const page = buildDocPage({
      image: renderPage(size.width, size.height, [box]),
      lines: fields,
      regions: [{ kind: 'image', label: 'image', score: 0.95, box }],
      source: 's',
      skew: 0,
    });
    expect(text(page)).toContain('Field 1: 100');
    expect(text(page)).toContain('Field 18: 117');
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(0);
  });

  it('uses known paper geometry to keep a clamped body font from inflating a source heading', () => {
    const page = buildDocPage({
      image: renderPage(size.width, size.height, []),
      lines: [
        line('A large source heading', 100, 100, 700, 40),
        ...Array.from({ length: 5 }, (_, i) =>
          line('Ordinary body text on a short line.', 100, 250 + i * 20, 300, 10),
        ),
      ],
      paper: { width: 600, height: 840 },
      source: 's',
      skew: 0,
    });
    const title = leafBlocks(page).find(
      (b) => b.kind === 'paragraph' && b.text === 'A large source heading',
    );
    expect(title?.kind).toBe('paragraph');
    expect(title && 'size' in title && title.size).toBeLessThanOrEqual(22);
  });

  it.each([false, true])('keeps an uncaptioned large illustration whole (fused=%s)', (fused) => {
    const b = { x: 30, y: 350, width: 940, height: 850 };
    const image = renderPage(size.width, size.height, [b]);
    const page = buildDocPage({
      image,
      lines: [line('Editable report title', 100, 80, 500)],
      regions: [{ kind: 'image', label: 'image', score: 0.9, box: b, ...(fused ? { fused } : {}) }],
      source: 's',
      skew: 0,
    });
    const pictures = leafBlocks(page).filter((b) => b.kind === 'image');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]!.box.height).toBeGreaterThanOrEqual(850);
    expect(text(page)).toContain('Editable report title');
  });

  it('keeps a confirmed diagram when its grid contributed shared columns to a separate table', () => {
    const f = fixture();
    const image = renderPage(size.width, size.height, [
      ...gridRects([110, 300, 520, 790], [110, 180, 250, 330]),
      ...gridRects([100, 450, 800], [600, 650, 700, 750]),
    ]);
    const data = [610, 660, 710].flatMap((y, i) => [
      line(`Entry ${i + 1}`, 120, y, 120),
      line(`${100 + i}`, 480, y, 80),
    ]);
    const page = buildDocPage({
      image,
      lines: [...f.lines, ...data],
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, [...f.lines, ...data])).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(text(page)).not.toContain('Encoder');
    expect(text(page)).toContain('Entry 1');
    expect(text(page)).toContain('102');
    const table = leafBlocks(page).find((b) => b.kind === 'table');
    expect(table?.box.y).toBeGreaterThan(590);
  });

  it('preserves a captioned sparse diagram with long labels before its grid becomes a table', () => {
    const f = fixture();
    const original = f.image.data.slice();
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [f.picture, f.caption],
      source: 'original',
      skew: 0,
    });
    expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    expect(text(page)).toContain('Figure 1: Pipeline overview.');
    expect(text(page)).toContain('Ordinary body text remains editable');
    expect(text(page)).not.toContain('Encoder');
    expect(text(page)).not.toContain('colspan');
    expect(f.image.data.every((v, i) => v === original[i])).toBe(true);
  });

  it.each(['Figure 1 : Vue du pipeline.', '图1：流程示意图。'])(
    'recognizes the caption role across languages: %s',
    (captionText) => {
      const f = fixture();
      f.lines[f.labels.length] = line(captionText, 100, 365, 380);
      const page = buildDocPage({
        image: f.image,
        lines: f.lines,
        regions: [f.picture, f.caption],
        source: 's',
        skew: 0,
      });
      expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
      expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
      expect(text(page)).toContain(captionText);
    },
  );

  it.each([1, 5])(
    'does not rasterize %i wide prose lines even with an image hint and caption',
    (count) => {
      const f = fixture();
      const prose = Array.from({ length: count }, (_, i) =>
        line(
          `Line ${i}: ordinary prose extending across this entire text region.`,
          110,
          110 + i * 40,
          670,
        ),
      );
      const page = buildDocPage({
        image: f.image,
        lines: [...prose, ...f.outside],
        regions: [f.picture, f.caption],
        source: 's',
        skew: 0,
      });
      expect(textConservation(page, [...prose, ...f.outside])).toEqual({ missing: [], extra: [] });
      expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(0);
      expect(text(page)).toContain('ordinary prose');
    },
  );

  it('retains editable cells when a competing table detection covers the region', () => {
    const f = fixture();
    const table = { ...f.picture, kind: 'table' as const, label: 'table' };
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [f.picture, table, f.caption],
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).some((b) => b.kind === 'table')).toBe(true);
    expect(text(page)).toContain('Encoder');
  });

  it('keeps the label intact when a picture edge clips the last label row', () => {
    const f = fixture();
    f.lines.push(line('Model Pipeline', 400, 332, 180));
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
    const pictures = leafBlocks(page).filter((b) => b.kind === 'image');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]!.box.y + pictures[0]!.box.height).toBeGreaterThanOrEqual(352);
    expect(text(page)).not.toContain('Model Pipeline');
    expect(text(page)).toContain('Figure 1:');
  });

  it('does not remove labels if later duplicate suppression rejects the protected image', () => {
    const f = fixture();
    const competing = { ...hint('image', 'image', 80, 80, 800, 500), score: 0.99, fused: true };
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [competing, f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
    expect(text(page)).toContain('Encoder');
    expect(text(page)).toContain('Ordinary body text remains editable');
  });

  it('does not trust an image hint plus caption when there are no graphics outside OCR boxes', () => {
    const f = fixture();
    const image = renderPage(size.width, size.height, []);
    const page = buildDocPage({
      image,
      lines: f.lines,
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
    expect(text(page)).toContain('Encoder');
  });

  it('rejects a picture boundary crossing a line of adjacent prose', () => {
    const f = fixture();
    const crossing = line(
      'An adjacent paragraph must remain editable across its complete line.',
      750,
      300,
      240,
    );
    const page = buildDocPage({
      image: f.image,
      lines: [...f.lines, crossing],
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(textConservation(page, [...f.lines, crossing])).toEqual({ missing: [], extra: [] });
    expect(text(page)).toContain('Encoder');
    expect(text(page)).toContain('An adjacent paragraph must remain editable');
  });

  it('keeps two captioned figures side by side instead of making their labels a bridging table', () => {
    const left = hint('image', 'image', 80, 100, 360, 240);
    const right = hint('image', 'image', 550, 100, 360, 240);
    const captions = [
      hint('text', 'figure_title', 80, 365, 360, 25),
      hint('text', 'figure_title', 550, 365, 360, 25),
    ];
    const labels = [80, 550].flatMap((x) => [
      line('Input', x + 15, 140, 75),
      line('Output', x + 180, 140, 90),
      line('Block A', x + 15, 200, 85),
      line('Block B', x + 180, 200, 90),
      line('Weight', x + 15, 260, 85),
      line('Result', x + 180, 260, 90),
    ]);
    const image = renderPage(
      size.width,
      size.height,
      [80, 550].flatMap((x) =>
        gridRects([x + 5, x + 160, x + 345], [110, 180, 240, 330], { thickness: 2 }),
      ),
    );
    const page = buildDocPage({
      image,
      lines: [
        ...labels,
        line('Figure 1: Left diagram.', 80, 365, 320),
        line('Figure 2: Right diagram.', 550, 365, 320),
      ],
      regions: [left, right, ...captions],
      source: 's',
      skew: 0,
    });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(2);
    expect(
      page.blocks.some(
        (b) =>
          b.kind === 'row' &&
          b.cells.length === 2 &&
          b.cells.every((c) => c.blocks.some((p) => p.kind === 'image')),
      ),
    ).toBe(true);
    expect(text(page)).toContain('Figure 1:');
    expect(text(page)).toContain('Figure 2:');
  });

  it.each(['no caption', 'body mention', 'distant caption', 'wrong column', 'weak fusion'])(
    'keeps ambiguous inputs on their existing path: %s',
    (mode) => {
      const f = fixture();
      const caption = {
        ...f.caption,
        label: mode === 'body mention' ? 'text' : f.caption.label,
        box: {
          ...f.caption.box,
          ...(mode === 'distant caption'
            ? { y: 900 }
            : mode === 'wrong column'
              ? { x: 850, width: 100 }
              : {}),
        },
      };
      const picture = { ...f.picture, ...(mode === 'weak fusion' ? { fused: true } : {}) };
      const page = buildDocPage({
        image: f.image,
        lines: f.lines,
        regions: mode === 'no caption' ? [picture] : [picture, caption],
        source: 's',
        skew: 0,
      });
      expect(textConservation(page, f.lines)).toEqual({ missing: [], extra: [] });
      expect(text(page)).toContain('Encoder');
      expect(text(page)).toContain('Ordinary body text remains editable');
    },
  );

  it('keeps a bordered form as a table when a photo sits inside one of its cells', () => {
    const labels = ['Surname', 'Given names', 'Date of birth', 'Nationality', 'Passport no.'];
    const values = ['Fischer', 'Amara Nwosu', '1990-04-12', 'German', 'C01X00T47'];
    const lines = labels.flatMap((t, i) => [
      line(t, 120, 120 + i * 60, 150),
      line(values[i]!, 370, 120 + i * 60, 160),
    ]);
    // 证件照：右边一列合并的四格里一块有纹理的深色图。
    const photo: Rect[] = [{ x: 740, y: 140, width: 120, height: 150 }];
    for (let y = 115; y < 330; y += 4)
      for (let x = 720; x < 880; x += 4)
        if ((x + y) % 8 === 0) photo.push({ x, y, width: 3, height: 3 });
    const grid = gridRects([100, 350, 700, 900], [100, 160, 220, 280, 340, 400], {
      skipH: [
        [1, 2],
        [2, 2],
        [3, 2],
      ],
    });
    const page = buildDocPage({
      image: renderPage(size.width, size.height, [
        ...grid,
        ...photo,
        ...lines.flatMap((l) => glyphs(l.x, l.y + 4, l.width, 12)),
      ]),
      lines,
      source: 'id-form',
      skew: 0,
      regions: [hint('image', 'image', 715, 110, 170, 225)],
    });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    const cells = tables[0]!.table.cells;
    for (const [i, label] of labels.entries()) {
      const row = cells.find((c) => c.text === label)!.row;
      expect(cells.find((c) => c.text === values[i])!.row).toBe(row);
    }
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
  });

  it('keeps a ruled form as a table when a logo above it reaches into its top band (EU sample 062)', () => {
    // 表上面的标志：PDF 里的图比画出来的标志高，下面透明的一截压进了表的标题条（约占图高的四分之一）。
    const labels = ['Section A', 'Surname', 'Given names', 'Street', 'House no.'];
    const lines = [
      line(labels[0]!, 120, 235, 150),
      line(labels[1]!, 120, 290, 150),
      line(labels[2]!, 520, 290, 150),
      line(labels[3]!, 120, 350, 150),
      line(labels[4]!, 520, 350, 150),
    ];
    const grid = gridRects([100, 500, 900], [220, 280, 340, 400], { skipV: [[1, 0]] });
    const logo: Rect[] = [{ x: 110, y: 110, width: 150, height: 70 }];
    const page = buildDocPage({
      image: renderPage(size.width, size.height, [
        ...grid,
        ...logo,
        ...lines.flatMap((l) => glyphs(l.x, l.y + 4, l.width, 12)),
      ]),
      lines,
      source: 'form.pdf',
      skew: 0,
      nativeFigures: [{ x: 100, y: 100, width: 200, height: 160 }],
    });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.rows).toBe(3);
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
  });

  it('keeps the rules a native logo overlaps, so its cell and the merged band below stay whole (EU sample 090)', () => {
    // 表头左上格的标志：PDF 里的图框压过了这一格的上下两条横线。抹图时把横线也抹掉一截，
    // 标志格和下面横跨整张表的「Dati paziente」一排连成不是长方形的一块，整张表退回不合并，标志跨了好几格。
    const lines = [
      line('MODULO RICHIESTA ESAMI', 450, 150, 350),
      line('Dati paziente', 430, 232, 140),
      line('Glucosio', 240, 290, 120),
      line('mg/dL', 450, 290, 80),
      line('65 - 100', 700, 290, 100),
      line('Urea', 240, 350, 80),
      line('mg/dL', 450, 350, 80),
      line('10 - 50', 700, 350, 100),
    ];
    // 第一列（勾选框那一列，100–220）只在下面的数据行有竖线。
    const grid = gridRects([100, 220, 400, 650, 900], [100, 220, 260, 320, 380], {
      skipV: [
        [1, 0],
        [3, 0],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    });
    const logo: Rect[] = [{ x: 170, y: 120, width: 150, height: 80 }];
    const page = buildDocPage({
      image: renderPage(size.width, size.height, [
        ...grid,
        ...logo,
        ...lines.flatMap((l) => glyphs(l.x, l.y + 4, l.width, 12)),
      ]),
      lines,
      source: 'form.pdf',
      skew: 0,
      nativeFigures: [{ x: 150, y: 96, width: 200, height: 128 }],
    });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    const band = tables[0]!.table.cells.find((c) => c.text === 'Dati paziente')!;
    expect(band.colSpan).toBe(4);
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
  });
});
