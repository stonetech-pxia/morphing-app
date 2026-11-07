import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildDocPage, type DocDoc, type DocTable } from './doc';
import { RECEIPT } from './fixtures/receipt-ocr';
import { writeDocx } from './docx';
import { renderPage, type Rect } from './test-helpers';
import { findBarcodes, levelLines, pageSlope } from './text-table';
import type { OcrBox } from './types';

// 转 Word 的通用版面修正（D-471）。小票是创始人 2026-11-06 发来的一张（Lidl，拍得有点斜、纸是弯的），
// 识别结果是 macOS 系统识别（Vision）认出来的行（fixtures/receipt-ocr.ts，只有店名地址和价格）。
// 以前：右边一列比左边高，被分到上一行；几列接成了一句话（「Article P.U.EUR Qté 2,76 A T Oeufs sol x12 2,76 1」）。

const receipt = RECEIPT;
const white = (width: number, height: number) => renderPage(width, height, []);

const rowsOf = (t: DocTable) =>
  Array.from({ length: t.table.rows }, (_, r) =>
    t.table.cells
      .filter((c) => c.row === r)
      .map((c) => c.text)
      .filter(Boolean),
  );

describe('tilt (D-471)', () => {
  it('finds the receipt’s tilt: the right column sits higher than the left', () => {
    expect(pageSlope(receipt.lines, 36)).toBeCloseTo(-0.05, 2);
  });

  it('leveled, each amount is on the same row as its article', () => {
    const lv = levelLines(receipt.lines, 36, receipt.width / 2);
    const mid = (text: string) => {
      const l = lv.find((x) => x.text === text)!;
      return l.y + l.height / 2;
    };
    expect(Math.abs(mid('Oeufs sol x12') - mid('2,76 A T'))).toBeLessThan(10);
    expect(Math.abs(mid('Article') - mid('2,76 A T'))).toBeGreaterThan(25);
    // 下面纸弯得不一样：合计也和它的标签在同一排。
    expect(Math.abs(mid('A payer') - mid('14,60'))).toBeLessThan(15);
  });

  it('a straight page stays as it is', () => {
    const lines: OcrBox[] = [
      { text: 'Name', x: 50, y: 100, width: 100, height: 20 },
      { text: 'Price', x: 500, y: 100, width: 80, height: 20 },
      { text: 'Tea', x: 50, y: 140, width: 60, height: 20 },
      { text: '2,00', x: 500, y: 140, width: 60, height: 20 },
    ];
    expect(pageSlope(lines, 20)).toBe(0);
  });
});

describe('tables without lines (D-471)', () => {
  const page = buildDocPage({
    image: white(receipt.width, receipt.height),
    lines: receipt.lines,
    source: 's',
  });
  const tables = page.blocks.filter((b): b is DocTable => b.kind === 'table');

  it('the receipt’s articles and totals become borderless tables, one row per line', () => {
    expect(tables.length).toBe(2);
    expect(tables.every((t) => t.borderless)).toBe(true);
    const items = rowsOf(tables[0]!);
    expect(items[0]).toEqual(['Article', 'P.U.EUR Qté', 'EUR']);
    expect(items[1]).toEqual(['Oeufs sol x12', '2,76', '2,76 A T']);
    expect(items[2]).toEqual(['Pizza jambon fromage', '2,29', '2,29 A T']);
    expect(items[3]).toEqual(['Pizza Crust Boeuf', '4,19', '4,19 A T']);
    const totals = rowsOf(tables[1]!);
    expect(totals).toContainEqual(['VA Taux', 'MONT.TTC MONT.TVA', 'TOTAL HT']);
    expect(totals).toContainEqual(['A 5,5%', '14,60', '0,76', '13,84']);
    // 数字一列靠右对齐。
    const price = tables[0]!.table.cells.find((c) => c.text === '2,76')!;
    expect(price.align).toBe('right');
    // 格子记着原图里的位置（原图小窗、截图核对用，D-468）。
    expect(price.box).toMatchObject({ x: 427, y: 348 });
  });

  it('no paragraph mixes the columns any more', () => {
    const texts = page.blocks.flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    expect(texts.join('\n')).not.toMatch(/Article.*Oeufs/);
    expect(texts).toContain('Ticket de vente');
  });

  it('when the layout model sees the whole receipt as one text region, the order stays top to bottom (simulator 2026-11-06)', () => {
    const doc = buildDocPage({
      image: white(receipt.width, receipt.height),
      lines: receipt.lines,
      regions: [
        {
          kind: 'text',
          label: 'text',
          score: 0.5,
          box: { x: 60, y: 100, width: 700, height: 1000 },
        },
      ],
      source: 's',
    });
    const order = doc.blocks.map((b) =>
      b.kind === 'paragraph'
        ? b.text
        : b.kind === 'table'
          ? `table:${b.table.cells[0]!.text}`
          : b.kind,
    );
    const at = (x: string) => order.findIndex((o) => o.startsWith(x));
    expect(at('Place Salvador')).toBeLessThan(at('table:Article'));
    expect(at('table:Article')).toBeLessThan(at('Enregistrez'));
    // 店名和下面的字不再连成一块（不再是一个从页顶到页底的块）。
    expect(doc.blocks.every((b) => b.box.height < 0.8 * receipt.height)).toBe(true);
  });

  it('three columns of prose are not a table', () => {
    const lines: OcrBox[] = [];
    for (let r = 0; r < 6; r++) {
      for (const x of [40, 360, 680]) {
        lines.push({
          text: 'Lorem ipsum dolor sit amet consectetur',
          x,
          y: 100 + r * 28,
          width: 280,
          height: 20,
        });
      }
    }
    const doc = buildDocPage({ image: white(1000, 400), lines, source: 's', skew: 0 });
    expect(doc.blocks.some((b) => b.kind === 'table')).toBe(false);
  });

  it('a borderless table is written to Word without borders', () => {
    const doc: DocDoc = { version: 1, pages: [{ ...page, source: 's' }] };
    const xml = strFromU8(unzipSync(writeDocx(doc))['word/document.xml']!);
    expect(xml).toContain('<w:insideV w:val="nil"/>');
    expect(xml).toContain('Oeufs sol x12');
  });
});

describe('barcodes (D-471)', () => {
  // 一行字，下面一片竖条（条形码）。
  const bars: Rect[] = [];
  for (let x = 100; x < 700; x += 12) bars.push({ x, y: 300, width: 5 + (x % 3), height: 120 });
  const text: Rect[] = [];
  for (let x = 100; x < 500; x += 9) text.push({ x, y: 104, width: 2, height: 12 });
  const image = renderPage(800, 500, [...bars, ...text]);
  const lines: OcrBox[] = [
    { text: 'Merci de votre visite', x: 100, y: 100, width: 400, height: 20 },
    // 条形码里认出来的零星的字。
    { text: '7.00', x: 600, y: 350, width: 50, height: 20 },
  ];

  it('finds the stripes, not the line of text', () => {
    const found = findBarcodes(image, lines.slice(0, 1), 20);
    expect(found).toHaveLength(1);
    expect(found[0]!.y).toBeGreaterThanOrEqual(280);
    expect(found[0]!.x).toBeLessThanOrEqual(110);
    expect(found[0]!.x + found[0]!.width).toBeGreaterThanOrEqual(690);
  });

  it('the barcode is kept as a picture and the stray digits in it are dropped', () => {
    const doc = buildDocPage({ image, lines, source: 's', skew: 0 });
    expect(doc.blocks.some((b) => b.kind === 'image')).toBe(true);
    expect(JSON.stringify(doc)).not.toContain('7.00');
  });
});

describe('numbers are not list markers (D-471)', () => {
  it('「7.29」「-7.29」 under a barcode stay text', () => {
    const lines: OcrBox[] = [
      { text: '-7.29', x: 600, y: 100, width: 80, height: 20 },
      { text: '7.29', x: 600, y: 200, width: 80, height: 20 },
      { text: '- first point', x: 100, y: 300, width: 200, height: 20 },
      { text: '2. second point', x: 100, y: 330, width: 220, height: 20 },
    ];
    const doc = buildDocPage({ image: white(800, 400), lines, source: 's', skew: 0 });
    const kinds = doc.blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === 'paragraph')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'list').length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(doc)).toContain('"text":"-7.29"');
  });
});
