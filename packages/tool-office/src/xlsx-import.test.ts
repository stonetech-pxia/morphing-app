import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { setCellText } from './edit';
import { formatNumber, generalNumber } from './number-format';
import { importOffice } from './office-import';
import type { TableBlock, TableDoc } from './types';
import { writeXlsx } from './xlsx';
import { importXlsx, MAX_IMPORT_CELLS } from './xlsx-import';

// 读外来的 xlsx（D-509）：用 jszip 按 Excel 的写法拼的工作簿测（共享字符串、行内字符串、合并格子、公式、
// 数字格式、列宽、几张工作表），再看写回去的 xlsx。

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const RNS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

/** 2026-10-01 在 Excel 里的序列号（1900 年制）。 */
const OCT_1 = (Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86400000;

interface SheetSpec {
  name: string;
  xml: string;
}

async function workbook(
  sheets: SheetSpec[],
  strings: string[],
  extra: { date1904?: boolean } = {},
) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships ${PKG}><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook ${NS} ${RNS}>` +
      (extra.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>') +
      `<sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}` +
      '<sheet name="Chart" sheetId="99" r:id="rIdChart"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships ${PKG}>` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rIdChart" Type="${REL}/chartsheet" Target="chartsheets/sheet1.xml"/>` +
      `<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rIdSt" Type="${REL}/styles" Target="/xl/styles.xml"/></Relationships>`,
  );
  sheets.forEach((s, i) =>
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS} ${RNS}>${s.xml}</worksheet>`,
    ),
  );
  zip.file('xl/chartsheets/sheet1.xml', `<chartsheet ${NS}/>`);
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?><sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${strings.join('')}</sst>`,
  );
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet ${NS}>` +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>' +
      '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/>' +
      '<xf numFmtId="9" applyNumberFormat="1"/><xf numFmtId="0" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs>' +
      '</styleSheet>',
  );
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

const si = (text: string) => `<si><t>${text}</t></si>`;
const STRINGS = [
  si('Expenses October 2026'),
  si('Date'),
  si('Item'),
  si('Amount'),
  // 富文本的几截连起来；注音（rPh）不要。
  '<si><r><t>Total </t></r><r><rPr><b/></rPr><t>£</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si>',
  si('Notes'),
];

const EXPENSES: SheetSpec = {
  name: 'October',
  xml:
    '<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="12.5" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/></cols>' +
    '<sheetData>' +
    '<row r="1"><c r="A1" s="4" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>' +
    `<row r="3"><c r="A3" s="1"><v>${OCT_1}</v></c><c r="B3" t="inlineStr"><is><t>Café</t></is></c><c r="C3" s="2"><v>12.5</v></c>` +
    '<c r="D3" t="b"><v>1</v></c><c r="E3" t="e"><v>#DIV/0!</v></c><c r="F3" s="3"><v>0.155</v></c></row>' +
    `<row r="4"><c r="A4" s="1"><v>${OCT_1 + 1}</v></c><c r="B4" t="inlineStr"><is><t>Train</t></is></c><c r="C4" s="2"><v>1234</v></c></row>` +
    // 公式：留下最后算出的结果；没算过的留下公式的字。
    '<row r="5"><c r="B5" t="s"><v>4</v></c><c r="C5" s="2"><f>SUM(C3:C4)</f><v>1246.5</v></c><c r="D5"><f>C5*2</f></c></row>' +
    // 只有样式、没有值的格子不算内容。
    '<row r="40"><c r="Z40" s="2"/></row>' +
    '</sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>',
};

const NOTES: SheetSpec = {
  name: 'Notes',
  xml: '<sheetFormatPr defaultColWidth="10"/><sheetData><row><c t="s"><v>5</v></c><c><v>3</v></c></row></sheetData>',
};

const table = (doc: TableDoc, page = 0) => doc.pages[page]!.blocks[0] as TableBlock;
const cellAt = (t: TableBlock, row: number, col: number) =>
  t.cells.find((c) => c.row === row && c.col === col);

describe('importXlsx', () => {
  it('reads every worksheet (not chart sheets) as one table from A1, with values and merged cells', async () => {
    const { doc, formulas } = importXlsx(await workbook([EXPENSES, NOTES], STRINGS));
    expect(doc.pages.map((p) => p.name)).toEqual(['October', 'Notes']);
    const t = table(doc);
    // A1 到 F5：最后一格有内容的是第 5 行、第 F 列（只有样式的 Z40 不算）。
    expect([t.rows, t.cols, t.col]).toEqual([5, 6, 0]);
    expect(cellAt(t, 0, 0)).toMatchObject({
      text: 'Expenses October 2026',
      colSpan: 3,
      rowSpan: 1,
      align: 'center',
    });
    // 合并区域盖住的位置没有格子。
    expect(cellAt(t, 0, 1)).toBeUndefined();
    expect(cellAt(t, 0, 3)).toMatchObject({ text: '' });
    expect(cellAt(t, 2, 1)).toMatchObject({ text: 'Café', write: { kind: 'text' } });
    expect(cellAt(t, 4, 1)!.text).toBe('Total £');
    expect(cellAt(t, 2, 3)!.text).toBe('TRUE');
    expect(cellAt(t, 2, 4)!.text).toBe('#DIV/0!');
    expect(formulas).toBe(2);
    expect(cellAt(t, 4, 3)).toMatchObject({ text: '=C5*2', write: { kind: 'text' } });
    expect(table(doc, 1).cells.map((c) => c.text)).toEqual(['Notes', '3']);
    // 不画边框（原来的边框读不出来，也不给每一格加上）。
    expect(t.borderless).toBe(true);
  });

  it('numbers keep their value and number format; the table shows them formatted', async () => {
    const t = table(importXlsx(await workbook([EXPENSES], STRINGS)).doc);
    expect(cellAt(t, 2, 0)).toMatchObject({
      text: '10-01-26',
      write: { kind: 'number', value: OCT_1, format: 'mm-dd-yy' },
    });
    expect(cellAt(t, 2, 2)).toMatchObject({
      text: '12.50 €',
      write: { kind: 'number', value: 12.5 },
    });
    expect(cellAt(t, 3, 2)!.text).toBe('1,234.00 €');
    expect(cellAt(t, 4, 2)).toMatchObject({
      text: '1,246.50 €',
      write: { kind: 'number', value: 1246.5 },
    });
    expect(cellAt(t, 2, 5)!.text).toBe('16%');
  });

  it('column widths in characters as written, the sheet default for the rest', async () => {
    const { doc } = importXlsx(await workbook([EXPENSES, NOTES], STRINGS));
    expect(doc.pages[0]!.colWidths).toEqual([12.5, 30, 8.43, 8.43, 8.43, 8.43]);
    expect(doc.pages[1]!.colWidths).toEqual([10, 10]);
  });

  it('writes back with writeXlsx: same values, numbers stay numbers, dates keep the built-in date format, no borders', async () => {
    const { doc } = importXlsx(await workbook([EXPENSES, NOTES], STRINGS));
    const files = unzipSync(writeXlsx(doc));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    const styles = strFromU8(files['xl/styles.xml']!);
    expect(sheet).toContain('<mergeCell ref="A1:C1"/>');
    expect(sheet).toMatch(new RegExp(`<c r="A3" s="\\d+"><v>${OCT_1}</v></c>`));
    expect(sheet).toMatch(/<c r="C5" s="\d+"><v>1246.5<\/v><\/c>/);
    // 日期写回自带的 14 号格式（Excel 按地区显示短日期）。
    expect(styles).toContain('numFmtId="14"');
    expect(styles).toContain('formatCode="#,##0.00\\ &quot;€&quot;"');
    expect(styles).not.toContain('borderId="1"');
    // 再读一遍：格子的字和值一样。
    const again = importXlsx(writeXlsx(doc)).doc;
    expect(table(again).cells.map((c) => c.text)).toEqual(table(doc).cells.map((c) => c.text));
    expect(again.pages.map((p) => p.name)).toEqual(['October', 'Notes']);
  });

  it('an edited number cell is written with the new number, not the old value', async () => {
    const { doc } = importXlsx(await workbook([EXPENSES], STRINGS));
    const t = table(doc);
    const index = t.cells.indexOf(cellAt(t, 3, 2)!);
    const edited = setCellText(doc, { page: 0, block: 0 }, index, '99');
    const sheet = strFromU8(unzipSync(writeXlsx(edited))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toMatch(/<c r="C4" s="\d+"><v>99<\/v><\/c>/);
    expect(sheet).not.toContain('<v>1234</v>');
  });

  it('the 1904 date system', async () => {
    const t = table(importXlsx(await workbook([EXPENSES], STRINGS, { date1904: true })).doc);
    // 同一个序列号在 1904 年制里晚 4 年零 1 天。
    expect(cellAt(t, 2, 0)!.text).toBe('10-02-30');
  });

  it('an empty workbook is one empty cell to start typing in', async () => {
    const { doc } = importXlsx(await workbook([{ name: 'Sheet1', xml: '<sheetData/>' }], []));
    expect(doc.pages).toHaveLength(1);
    expect(table(doc).cells).toEqual([{ row: 0, col: 0, rowSpan: 1, colSpan: 1, text: '' }]);
  });

  it('too many cells, a password-protected file, a Word file renamed to .xlsx', async () => {
    const rows = Array.from(
      { length: 201 },
      (_, r) => `<row r="${r + 1}"><c r="CV${r + 1}"><v>1</v></c></row>`,
    ).join('');
    // 201 行 × 100 列 = 20100 格（从 A1 到 CV201 的方块）。
    expect(201 * 100).toBeGreaterThan(MAX_IMPORT_CELLS);
    const big = await workbook([{ name: 'Big', xml: `<sheetData>${rows}</sheetData>` }], []);
    expect(importOffice(big, 'xlsx')).toEqual({ ok: false, error: 'tooLarge' });
    // Office 加密的文件装在同一种复合文件里（这份是 Pages 存的 Word）。
    const locked = new Uint8Array(
      readFileSync(join(__dirname, 'fixtures/office/password-pages.docx')),
    );
    expect(importOffice(locked, 'xlsx')).toEqual({ ok: false, error: 'encrypted' });
    const word = new Uint8Array(
      readFileSync(join(__dirname, 'fixtures/office/lease-textutil.docx')),
    );
    expect(importOffice(word, 'xlsx')).toEqual({ ok: false, error: 'notOffice' });
  });
});

describe('formatNumber', () => {
  it('general numbers', () => {
    expect(generalNumber(0.1 + 0.2)).toBe('0.3');
    expect(generalNumber(1234567)).toBe('1234567');
    expect(generalNumber(123456789012)).toBe('1.23457E+11');
    expect(formatNumber(-5, 'General')).toBe('-5');
  });

  it('decimals, thousands, percent, currency, negative sections and scientific', () => {
    expect(formatNumber(1234.5, '#,##0.00')).toBe('1,234.50');
    expect(formatNumber(-1234.5, '#,##0.00')).toBe('-1,234.50');
    expect(formatNumber(-1234.5, '#,##0.00;(#,##0.00)')).toBe('(1,234.50)');
    expect(formatNumber(0.075, '0.0%')).toBe('7.5%');
    expect(formatNumber(42, '[$$-409]#,##0.00')).toBe('$42.00');
    expect(formatNumber(42, '"USD "0')).toBe('USD 42');
    expect(formatNumber(12345, '0.00E+00')).toBe('1.23E+04');
    expect(formatNumber(7, '000')).toBe('007');
    expect(formatNumber(-3, 'General;[Red]-General')).toBe('-3');
  });

  it('dates and times', () => {
    expect(formatNumber(OCT_1, 'yyyy-mm-dd')).toBe('2026-10-01');
    expect(formatNumber(OCT_1, 'd mmmm yyyy')).toBe('1 October 2026');
    expect(formatNumber(OCT_1, 'dddd, mmm d')).toBe('Thursday, Oct 1');
    expect(formatNumber(OCT_1 + 0.75, 'h:mm AM/PM')).toBe('6:00 PM');
    expect(formatNumber(1.5, '[h]:mm')).toBe('36:00');
    expect(formatNumber(OCT_1 + 0.5, 'yyyy"年"m"月"d"日" hh:mm')).toBe('2026年10月1日 12:00');
  });
});
