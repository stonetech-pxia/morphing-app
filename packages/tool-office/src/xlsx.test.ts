import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { TableBlock, TableDoc, TablePage } from './types';
import {
  cellNumber,
  cleanXmlText,
  columnName,
  pagesWithoutTables,
  sheetName,
  writeXlsx,
} from './xlsx';

const box = (y: number, height = 20) => ({ x: 100, y, width: 800, height });

function table(
  y: number,
  texts: string[][],
  merges: { row: number; col: number; rowSpan: number; colSpan: number }[] = [],
): TableBlock {
  const rows = texts.length;
  const cols = texts[0]!.length;
  const covered = new Set<string>();
  const cells = [];
  for (const m of merges) {
    for (let r = m.row; r < m.row + m.rowSpan; r++)
      for (let c = m.col; c < m.col + m.colSpan; c++) covered.add(`${r},${c}`);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = merges.find((x) => x.row === r && x.col === c);
      if (m) cells.push({ ...m, text: texts[r]![c]! });
      else if (!covered.has(`${r},${c}`))
        cells.push({ row: r, col: c, rowSpan: 1, colSpan: 1, text: texts[r]![c]! });
    }
  }
  return {
    kind: 'table',
    rows,
    cols,
    colWidths: Array(cols).fill(200),
    cells,
    box: box(y, rows * 40),
  };
}

const page = (name: string, blocks: TablePage['blocks']): TablePage => ({
  name,
  source: 'file:///p.jpg',
  width: 1000,
  height: 1400,
  lineHeight: 20,
  blocks,
});

function unpack(doc: TableDoc) {
  const files = unzipSync(writeXlsx(doc));
  const text = (name: string) => strFromU8(files[name]!);
  return { files, text };
}

describe('xlsx writer (D-272)', () => {
  it('writes the parts Excel, Numbers and WPS need', () => {
    const { files, text } = unpack({
      version: 1,
      scope: 'all',
      pages: [page('Page 1', [table(100, [['a']])])],
    });
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(text('[Content_Types].xml')).toContain('/xl/worksheets/sheet1.xml');
    expect(text('xl/_rels/workbook.xml.rels')).toContain('Target="sharedStrings.xml"');
  });

  it('writes one sheet per page with cleaned, unique names', () => {
    const { text } = unpack({
      version: 1,
      scope: 'all',
      pages: [
        page('第 1 页', []),
        page('a/b:c*d?[e]\\f', []),
        page('A/B:C*D?[E]\\F', []),
        page('x'.repeat(40), []),
        page("''", []),
      ],
    });
    const names = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toEqual(['第 1 页', 'abcdef', 'ABCDEF (2)', 'x'.repeat(31), 'Sheet5']);
  });

  it('stores numbers as numbers and keeps codes, long numbers and dates as text', () => {
    const { text } = unpack({
      version: 1,
      scope: 'all',
      pages: [
        page('P', [
          table(100, [
            ['1234', '1,234.56', '-5', '12%', '0123', '1234567890123456', '2026-10-28', '0.5'],
          ]),
        ]),
      ],
    });
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toMatch(/<c r="A1" s="\d+"><v>1234<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="B1" s="\d+"><v>1234.56<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="C1" s="\d+"><v>-5<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="D1" s="\d+"><v>0.12<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="E1" s="1" t="s">/);
    expect(sheet).toMatch(/<c r="F1" s="1" t="s">/);
    expect(sheet).toMatch(/<c r="G1" s="1" t="s">/);
    expect(sheet).toMatch(/<c r="H1" s="\d+"><v>0.5<\/v><\/c>/);
    const strings = text('xl/sharedStrings.xml');
    expect(strings).toContain('<t>0123</t>');
    expect(strings).toContain('<t>2026-10-28</t>');
    // 千分位和百分号的格式保留下来。
    const styles = text('xl/styles.xml');
    expect(styles).toContain('numFmtId="4"');
    expect(styles).toContain('numFmtId="9"');
  });

  it('parses numbers the way the cells read', () => {
    expect(cellNumber('1,234.56')).toEqual({ value: 1234.56, format: '#,##0.00' });
    expect(cellNumber('12.5%')).toEqual({ value: 0.125, format: '0.0%' });
    expect(cellNumber('−7')).toEqual({ value: -7, format: '0' });
    expect(cellNumber('007')).toBeNull();
    expect(cellNumber('12/03')).toBeNull();
    expect(cellNumber('1,23')).toBeNull();
    expect(cellNumber('¥12')).toBeNull();
  });

  it('writes merged cells, with the bordered style on every covered cell', () => {
    const t = table(
      100,
      [
        ['head', '', 'x'],
        ['tall', 'b', 'c'],
        ['', 'd', 'e'],
      ],
      [
        { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
        { row: 1, col: 0, rowSpan: 2, colSpan: 1 },
      ],
    );
    const { text } = unpack({ version: 1, scope: 'all', pages: [page('P', [t])] });
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain(
      '<mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="A2:A3"/></mergeCells>',
    );
    expect(sheet).toContain('<c r="B1" s="1"/>');
    expect(sheet).toContain('<c r="A3" s="1"/>');
  });

  it('escapes XML and drops control characters', () => {
    const t = table(100, [['a & b < c > "d"', 'bad\u0001\u0008char￾', 'lone\uD800 surrogate']]);
    const { text } = unpack({ version: 1, scope: 'all', pages: [page('P&Q', [t])] });
    const strings = text('xl/sharedStrings.xml');
    expect(strings).toContain('<t>a &amp; b &lt; c &gt; &quot;d&quot;</t>');
    expect(strings).toContain('<t>badchar</t>');
    expect(strings).toContain('<t>lone surrogate</t>');
    expect(text('xl/workbook.xml')).toContain('name="P&amp;Q"');
    expect(cleanXmlText('😀\r\nok')).toBe('😀\nok');
  });

  it('keeps line breaks inside a cell', () => {
    const { text } = unpack({
      version: 1,
      scope: 'all',
      pages: [page('P', [table(100, [['one\ntwo']])])],
    });
    expect(text('xl/sharedStrings.xml')).toContain('<t xml:space="preserve">one\ntwo</t>');
    // 两行字的行高是 2 × 15 磅。
    expect(text('xl/worksheets/sheet1.xml')).toContain('<row r="1" ht="30" customHeight="1">');
  });

  it('writes text outside tables as merged rows, with a blank row for big gaps', () => {
    const doc: TableDoc = {
      version: 1,
      scope: 'all',
      pages: [
        page('P', [
          { kind: 'text', text: 'Title', box: box(20) },
          { kind: 'text', text: 'Right below', box: box(45) },
          table(200, [['a', 'b', 'c']]),
          { kind: 'text', text: 'Footer', box: box(400) },
        ]),
      ],
    };
    const sheet = unpack(doc).text('xl/worksheets/sheet1.xml');
    // 标题和下一段之间没有空行；表格前后的空隙超过 1.5 倍行高，各空一行。
    expect(sheet).toContain('<mergeCell ref="A1:C1"/>');
    expect(sheet).toContain('<mergeCell ref="A2:C2"/>');
    expect(sheet).toMatch(/<c r="A4" s="1" t="s">/);
    expect(sheet).toContain('<mergeCell ref="A6:C6"/>');
    expect(sheet).toMatch(/<c r="A6" s="2" t="s">/);
  });

  it('leaves out text outside tables for “tables only”, except on pages without a table', () => {
    const doc: TableDoc = {
      version: 1,
      scope: 'tables',
      pages: [
        page('P1', [{ kind: 'text', text: 'Title', box: box(20) }, table(200, [['a']])]),
        page('P2', [{ kind: 'text', text: 'Only text', box: box(20) }]),
      ],
    };
    const { text } = unpack(doc);
    expect(text('xl/sharedStrings.xml')).not.toContain('Title');
    expect(text('xl/sharedStrings.xml')).toContain('Only text');
    expect(pagesWithoutTables(doc)).toEqual([2]);
    expect(pagesWithoutTables({ ...doc, scope: 'all' })).toEqual([]);
  });

  it('sets column widths from the table and spreads text-only pages over A–D', () => {
    const t = { ...table(100, [['a', 'b']]), colWidths: [100, 500] };
    const { text } = unpack({
      version: 1,
      scope: 'all',
      pages: [page('P', [t]), page('Q', [{ kind: 'text', text: 'x', box: box(0) }])],
    });
    expect(text('xl/worksheets/sheet1.xml')).toContain(
      '<col min="1" max="1" width="11" customWidth="1"/><col min="2" max="2" width="55" customWidth="1"/>',
    );
    const sheet2 = text('xl/worksheets/sheet2.xml');
    expect(sheet2.match(/<col /g)).toHaveLength(4);
    expect(sheet2).toContain('<mergeCell ref="A1:D1"/>');
  });

  it('names columns like Excel', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
    expect(sheetName('  ', 0, new Set())).toBe('Sheet1');
  });
});
