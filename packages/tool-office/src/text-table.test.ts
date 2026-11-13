import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildDocPage, leafBlocks, type DocDoc, type DocTable } from './doc';
import { INVOICE, INVOICE_ITEMS } from './fixtures/invoice-ocr';
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

  it('keeps a Word barcode beside text without swallowing that text', () => {
    const beside = Array.from({ length: 5 }, (_, i) => ({
      text: `Address ${i + 1}`,
      x: 5,
      y: 300 + i * 24,
      width: 70,
      height: 20,
    }));
    const framed = renderPage(800, 500, [
      ...bars,
      ...text,
      { x: 1, y: 300, width: 2, height: 120 },
      { x: 797, y: 300, width: 2, height: 120 },
    ]);
    const doc = buildDocPage({ image: framed, lines: beside, source: 's', skew: 0 });
    const pictures = leafBlocks(doc).filter((b) => b.kind === 'image');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]!.box.x).toBeGreaterThanOrEqual(90);
    expect(pictures[0]!.box.x + pictures[0]!.box.width).toBeLessThanOrEqual(710);
    expect(pictures[0]!.box.height).toBeGreaterThanOrEqual(100);
    expect(JSON.stringify(doc)).toContain('Address 1');
    expect(JSON.stringify(doc)).toContain('Address 5');
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

describe('rows kept together when no table lines are found (D-502)', () => {
  const box = (text: string, x: number, y: number, width = 80): OcrBox => ({
    text,
    x,
    y,
    width,
    height: 20,
  });
  const tablesIn = (lines: OcrBox[]) =>
    buildDocPage({ image: white(1400, 900), lines, source: 's', skew: 0 }).blocks.filter(
      (b): b is DocTable => b.kind === 'table',
    );

  it('a payslip body (item names far from columns of amounts) becomes one row per item', () => {
    // 工资单的表身，表格线没认出来：左边项目名，隔着七八个行高，右边三列金额；有的项目只有一两列有数。
    const items = [
      ['Salaire de base', '151.67', '12.3100', '1 867.06'],
      ['Heures supplémentaires 10 %', '17.33', '13.5410', '234.67'],
      ['Sous total Salaire de base', '169.00', '', '2 101.73'],
      ['Indemnité congés payés', '', '', '404.18'],
      ['AeN nourriture (repas pris)', '44.00', '4.3500', '191.40'],
    ];
    const lines = items.flatMap(([label, ...amounts], r) => [
      box(label!, 100, 100 + r * 30, 300),
      ...amounts.flatMap((a, c) => (a ? [box(a, 600 + c * 150, 100 + r * 30)] : [])),
    ]);
    const [table, ...others] = tablesIn(lines);
    expect(others).toHaveLength(0);
    expect(rowsOf(table!)).toEqual(items.map((row) => row.filter(Boolean)));
  });

  it('a list of labels with amounts far to the right becomes a two-column table', () => {
    // 小票的合计：两列，隔得很远，右边是数。
    const pairs = [
      ['Total', 'RM 30.91'],
      ['ROUNDING ADJUSTMENT', '-RM 0.01'],
      ['TOTAL ROUNDED', 'RM 30.90'],
      ['CASH', 'RM 51.00'],
    ];
    const lines = pairs.flatMap(([label, amount], r) => [
      box(label!, 100, 100 + r * 30, 220),
      box(amount!, 700, 100 + r * 30, 90),
    ]);
    const [table] = tablesIn(lines);
    expect(rowsOf(table!)).toEqual(pairs);
  });

  it('a two-column list does not take rows from a three-column table below it', () => {
    // 小票（SROIE S_094 的位置，行高 20）：合计两列、金额隔得远；下面隔一行发票号，是三列的 GST 汇总，
    // 表头「Amount  Tax」不是数，Tax 一列也隔得远。合计不能把汇总吞进一张两列的表、压成两列。
    const totals = [
      ['Sub-total', '5.90', 140],
      ['Total Sales Incl GST', '5.90', 285],
      ['Total After Adj Incl GST', '5.90', 343],
      ['CASH', '10.00', 66],
      ['Item Count 1', '4.10', 174],
    ] as const;
    const gst = [
      ['GST Summary', 'Amount', 'Tax'],
      ['SR @ 6%', '5.57', '0.33'],
      ['Total', '5.57', '0.33'],
    ];
    const lines = [
      ...totals.flatMap(([label, amount, w], r) => [
        box(label, 76, 100 + r * 20, w / 2),
        box(amount, 583 / 2, 100 + r * 20, 32),
      ]),
      box('Invoice No: 2018020951320023885', 67, 200, 221),
      ...gst.flatMap((row, r) =>
        row.map((t, c) => box(t, [38, 180, 292][c]!, 220 + r * 20, [80, 45, 32][c]!)),
      ),
    ].map((l) => ({ ...l, height: 18 }));
    const rows = tablesIn(lines).flatMap(rowsOf);
    for (const row of gst) expect(rows).toContainEqual(row);
  });

  it('a short summary right under a table joins it with the table’s columns', () => {
    // 小票（SROIE S_454 的位置）：商品和合计排成三列的表，下面紧挨着 GST 汇总（表头一排、数一排），
    // 汇总的表头横在两列之间；再下面是一行字。汇总两排接在表下面，每排三格，不散成六段。
    const t = (text: string, x: number, y: number, w: number): OcrBox => ({
      text,
      x,
      y,
      width: w,
      height: 30,
    });
    const lines = [
      t('001697', 82, 100, 85),
      t('5.00 1.00', 330, 100, 124),
      t('5.00 SR', 560, 100, 100),
      t('766271', 82, 136, 85),
      t('1.00 22.00', 320, 136, 134),
      t('22.00 SR', 560, 136, 106),
      t('Total Amt Incl. GST', 194, 172, 250),
      t('27.00', 560, 172, 71),
      t('Rounding Adjusment:', 231, 208, 210),
      t('0.00', 600, 208, 40),
      t('Total Amt Payable :', 194, 244, 249),
      t('27.00', 560, 244, 71),
      t('GST Summary', 82, 280, 182),
      t('Amount(RM)', 293, 280, 162),
      t('GST (RM)', 498, 280, 130),
      t('SR = 6 %', 83, 316, 124),
      t('25.47', 382, 316, 72),
      t('1.53', 571, 316, 57),
      t('POINT. 0.00', 232, 352, 162),
    ];
    const rows = tablesIn(lines).flatMap(rowsOf);
    expect(rows).toContainEqual(['GST Summary', 'Amount(RM)', 'GST (RM)']);
    expect(rows).toContainEqual(['SR = 6 %', '25.47', '1.53']);
  });

  it('two blocks side by side (an address next to an address) are not a table', () => {
    const left = ['ASAKI SUSHI', '48 RUE DE CHARTRES', '91410 DOURDAN', 'Siret 81265228'];
    const right = ['Monsieur XIA', '52T RUE VICTOR HUGO', 'PORTE 185', '93500 PANTIN'];
    const lines = left.flatMap((t, r) => [
      box(t, 100, 100 + r * 30, 220),
      box(right[r]!, 800, 100 + r * 30, 220),
    ]);
    expect(tablesIn(lines)).toHaveLength(0);
  });

  it('amounts shifted against their labels (a steep photo) are not paired up', () => {
    // 拍得很斜：右边的数比左边的项目高了两排，最上面两个数旁边没有项目。
    const lines = [
      box('497.16', 700, 40),
      box('184.91', 700, 70),
      ...['Room Charge', 'Room Service', 'Service VAT', 'Package VAT'].flatMap((t, r) => [
        box(t, 100, 100 + r * 30, 220),
        box(['11.09', '2.83', '695.99', '0.00'][r]!, 700, 100 + r * 30),
      ]),
    ];
    expect(tablesIn(lines)).toHaveLength(0);
  });
});

describe('an invoice’s item table with its totals under the right-hand columns (D-506)', () => {
  // 用户测试（2026-11-09）里的文字版发票：表头和四排商品，每排下面一条很浅的细横线（找线找不到）；
  // 表下面隔一段，右边两列是 Subtotal / VAT 20% / Total due。
  // 以前：合计一排排只在远处的两列、左边没字，被当成「错开的数」（D-502），整张表不认；
  // 商品名接成一段、几列数各成一段，最后一排和合计凑成一张两列的表。
  const page = buildDocPage({
    image: white(INVOICE.width, INVOICE.height),
    lines: INVOICE.lines,
    source: 's',
    skew: 0,
  });
  const leaves = leafBlocks(page);
  const tables = leaves.filter((b): b is DocTable => b.kind === 'table');

  it('the header and the four items become one four-column table', () => {
    const items = tables.find((t) => rowsOf(t)[0]?.[0] === 'Item');
    expect(items?.table.cols).toBe(4);
    expect(rowsOf(items!).slice(0, INVOICE_ITEMS.length)).toEqual(INVOICE_ITEMS);
  });

  it('no paragraph holds item names or their amounts, and nothing is lost', () => {
    const paragraphs = leaves.flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    for (const text of ['Toner cartridge', '£129.80', 'Desk organiser']) {
      expect(paragraphs.filter((p) => p.includes(text))).toEqual([]);
    }
    const all = [...paragraphs, ...tables.flatMap((t) => t.table.cells.map((c) => c.text))].join(
      ' ',
    );
    for (const l of INVOICE.lines) expect(all).toContain(l.text);
  });
});
