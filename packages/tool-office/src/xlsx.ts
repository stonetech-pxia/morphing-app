import { strToU8, zipSync, type Zippable } from 'fflate';

import type { TableBlock, TableDoc, TablePage } from './types';

// 写 xlsx（D-272）：自己写 XML，用 fflate 的同步 API 打包（Hermes 没有 Worker，也没有 Node 的 stream）。
// 每页一张工作表；字符串放 sharedStrings（Numbers 和 WPS 对它的支持比 inlineStr 稳）；
// 样式只有三类：表格格（细边框、自动换行、靠上）、表外的文字（自动换行、无边框）、数字（表格格加数字格式）。

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** 一格最多 32767 个字符（Excel 的上限）。 */
const MAX_CELL_CHARS = 32767;
/** 原图的整页宽度大约等于这么多个字符宽（Excel 的列宽单位）。 */
const PAGE_CHARS = 110;
/** 没有表格时，表外的文字从 A 列合并到 D 列。 */
const TEXT_ONLY_COLS = 4;
/** 一行字的高度（磅，11 号字）。 */
const LINE_POINTS = 15;

/** XML 里不允许的字符（控制字符、FFFE / FFFF、落单的代理项）去掉，换行统一成 \n。 */
export function cleanXmlText(text: string): string {
  const s = text.replace(/\r\n?/g, '\n');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0xfffe || c === 0xffff) continue;
    out += s[i]!;
  }
  return out;
}

const escapeXml = (text: string) =>
  cleanXmlText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 列号（从 0 开始）→ 列字母：0 → A，25 → Z，26 → AA。 */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const ref = (row: number, col: number) => `${columnName(col)}${row + 1}`;

/**
 * 工作表名：去掉 Excel 不允许的 []:*?/\ 和控制字符，首尾的单引号也去掉，最长 31 个字符；
 * 空了用 Sheet N，和前面的重名（不分大小写）时加「 (2)」。
 */
export function sheetName(name: string, index: number, taken: ReadonlySet<string>): string {
  let base = cleanXmlText(name)
    .replace(/[[\]:*?/\\\n\t]/g, '')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  const cut = (s: string, max: number) => Array.from(s).slice(0, max).join('');
  base = cut(base, 31) || `Sheet${index + 1}`;
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = cut(base, 31 - suffix.length) + suffix;
  }
  return candidate;
}

/**
 * 纯数字写成数字类型（Excel 里能直接求和）：1234、1,234.56、-5、12%。
 * 以 0 开头的（电话、编号）、超过 15 位的、日期和别的都按文字写。format 是 Excel 的数字格式（保留千分位、小数位、百分号）。
 */
export function cellNumber(text: string): { value: number; format: string } | null {
  const m = /^([-−])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%)?$/.exec(text.trim());
  if (!m) return null;
  const [, sign, int, frac = '', percent] = m;
  const digits = int!.replace(/,/g, '');
  if (digits.length > 1 && digits.startsWith('0')) return null;
  if (digits.length + frac.length > 15) return null;
  let value = Number(`${digits}${frac ? `.${frac}` : ''}`);
  if (sign) value = -value;
  if (percent) value = Number((value / 100).toPrecision(15));
  const format =
    (int!.includes(',') ? '#,##0' : '0') +
    (frac ? `.${'0'.repeat(frac.length)}` : '') +
    (percent ?? '');
  return { value, format };
}

/** Excel 自带的数字格式编号；别的自己定义（164 起）。 */
const BUILT_IN_FORMATS: Record<string, number> = {
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
  '0%': 9,
  '0.00%': 10,
};

/** 估一段文字在 width 个字符宽的格子里占几行（中日韩文字算两个字符宽）。 */
function lineCount(text: string, width: number): number {
  const avail = Math.max(1, width - 1);
  let lines = 0;
  for (const para of text.split('\n')) {
    let units = 0;
    for (const ch of para)
      units += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) || ch.length > 1 ? 2 : 1.1;
    lines += Math.max(1, Math.ceil(units / avail));
  }
  return lines;
}

interface Styles {
  /** 表格格（文字）。 */
  table: number;
  /** 表外的文字。 */
  text: number;
  /** 数字格式 → 样式编号。 */
  number(format: string): number;
  xml(): string;
}

function createStyles(): Styles {
  const formats: string[] = [];
  const custom = new Map<string, number>();
  const formatId = (code: string) => {
    if (BUILT_IN_FORMATS[code] !== undefined) return BUILT_IN_FORMATS[code]!;
    if (!custom.has(code)) custom.set(code, 164 + custom.size);
    return custom.get(code)!;
  };
  return {
    table: 1,
    text: 2,
    number(format) {
      let i = formats.indexOf(format);
      if (i < 0) i = formats.push(format) - 1;
      formatId(format);
      return 3 + i;
    },
    xml() {
      const numberXfs = formats.map(
        (f) =>
          `<xf numFmtId="${formatId(f)}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>`,
      );
      const numFmts = custom.size
        ? `<numFmts count="${custom.size}">${[...custom]
            .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`)
            .join('')}</numFmts>`
        : '';
      return (
        HEAD +
        `<styleSheet xmlns="${NS}">${numFmts}` +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${3 + numberXfs.length}">` +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        numberXfs.join('') +
        '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>'
      );
    },
  };
}

interface SharedStrings {
  index(text: string): number;
  xml(): string;
}

function createSharedStrings(): SharedStrings {
  const list: string[] = [];
  const seen = new Map<string, number>();
  let count = 0;
  return {
    index(text) {
      count++;
      const s = cleanXmlText(text).slice(0, MAX_CELL_CHARS);
      if (!seen.has(s)) seen.set(s, list.push(s) - 1);
      return seen.get(s)!;
    },
    xml() {
      const items = list.map((s) => {
        const preserve = /^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : '';
        return `<si><t${preserve}>${escapeXml(s)}</t></si>`;
      });
      return (
        HEAD +
        `<sst xmlns="${NS}" count="${count}" uniqueCount="${list.length}">${items.join('')}</sst>`
      );
    },
  };
}

/** 这一页要写出的块：识别范围是「仅表格内容」时不写表外的文字，但这一页一张表都没有时照样写（D-272）。 */
export function pageBlocks(page: TablePage, scope: TableDoc['scope']) {
  const hasTable = page.blocks.some((b) => b.kind === 'table');
  return scope === 'tables' && hasTable
    ? page.blocks.filter((b) => b.kind === 'table')
    : page.blocks;
}

/** 识别范围是「仅表格内容」、但没有找到表格的页（从 1 开始）。 */
export function pagesWithoutTables(doc: TableDoc): number[] {
  if (doc.scope !== 'tables') return [];
  return doc.pages.flatMap((p, i) => (p.blocks.some((b) => b.kind === 'table') ? [] : [i + 1]));
}

/** 一张工作表的列宽（字符）：每一列取这一页各张表里同一列最宽的；没有表时 A–D 平分页宽。 */
export function sheetColumns(page: TablePage, blocks = page.blocks): number[] {
  const tables = blocks.filter((b): b is TableBlock => b.kind === 'table');
  const toChars = (px: number) =>
    Math.round(Math.min(120, Math.max(4, (px / Math.max(1, page.width)) * PAGE_CHARS)) * 10) / 10;
  if (!tables.length) {
    return Array.from({ length: TEXT_ONLY_COLS }, () => toChars(page.width / TEXT_ONLY_COLS));
  }
  const cols = Math.max(...tables.map((t) => t.cols));
  return Array.from({ length: cols }, (_, c) =>
    toChars(Math.max(...tables.map((t) => t.colWidths[c] ?? 0))),
  );
}

function sheetXml(
  page: TablePage,
  scope: TableDoc['scope'],
  styles: Styles,
  strings: SharedStrings,
): string {
  const blocks = pageBlocks(page, scope);
  const widths = sheetColumns(page, blocks);
  const lastCol = widths.length - 1;
  const rows: { cells: string[]; lines: number }[] = [];
  const merges: string[] = [];
  let prevBottom: number | null = null;
  for (const block of blocks) {
    // 块和块之间空隙超过 1.5 倍行高时空一行，大致保留原来的间距。
    if (prevBottom !== null && block.box.y - prevBottom > 1.5 * page.lineHeight) {
      rows.push({ cells: [], lines: 1 });
    }
    prevBottom = block.box.y + block.box.height;
    if (block.kind === 'text') {
      const r = rows.length;
      const text = cleanXmlText(block.text);
      const cells = [
        `<c r="${ref(r, 0)}" s="${styles.text}" t="s"><v>${strings.index(text)}</v></c>`,
      ];
      if (lastCol > 0) merges.push(`${ref(r, 0)}:${ref(r, lastCol)}`);
      const width = widths.reduce((a, b) => a + b, 0);
      rows.push({ cells, lines: lineCount(text, width) });
      continue;
    }
    const start = rows.length;
    const table: { cells: string[]; lines: number }[] = Array.from({ length: block.rows }, () => ({
      cells: [],
      lines: 1,
    }));
    // 合并区域盖住的格子也要写（带边框样式），否则合并后的格子只有左上角有边框。
    const grid: (string | null)[][] = Array.from({ length: block.rows }, () =>
      Array.from({ length: block.cols }, () => null),
    );
    for (const cell of block.cells) {
      const r = start + cell.row;
      const text = cleanXmlText(cell.text).trim();
      const number = cellNumber(text);
      let xml: string;
      if (!text) xml = `<c r="${ref(r, cell.col)}" s="${styles.table}"/>`;
      else if (number) {
        xml = `<c r="${ref(r, cell.col)}" s="${styles.number(number.format)}"><v>${number.value}</v></c>`;
      } else {
        xml = `<c r="${ref(r, cell.col)}" s="${styles.table}" t="s"><v>${strings.index(text)}</v></c>`;
      }
      grid[cell.row]![cell.col] = xml;
      for (let dr = 0; dr < cell.rowSpan; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = cell.row + dr;
          const cc = cell.col + dc;
          if (rr < block.rows && cc < block.cols) {
            grid[rr]![cc] = `<c r="${ref(start + rr, cc)}" s="${styles.table}"/>`;
          }
        }
      }
      if (cell.rowSpan > 1 || cell.colSpan > 1) {
        merges.push(
          `${ref(r, cell.col)}:${ref(r + cell.rowSpan - 1, cell.col + cell.colSpan - 1)}`,
        );
      }
      if (cell.rowSpan === 1 && text) {
        let width = 0;
        for (let c = cell.col; c < cell.col + cell.colSpan; c++) width += widths[c] ?? 8;
        const row = table[cell.row]!;
        row.lines = Math.max(row.lines, lineCount(text, width));
      }
    }
    for (const [r, row] of table.entries())
      row.cells = grid[r]!.filter((c): c is string => c !== null);
    rows.push(...table);
  }
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const data = rows
    .map((row, r) =>
      row.cells.length || row.lines > 1
        ? `<row r="${r + 1}" ht="${row.lines * LINE_POINTS}" customHeight="1">${row.cells.join('')}</row>`
        : '',
    )
    .join('');
  return (
    HEAD +
    `<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">` +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="${LINE_POINTS}"/>` +
    `<cols>${cols}</cols>` +
    (data ? `<sheetData>${data}</sheetData>` : '<sheetData/>') +
    (merges.length
      ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '') +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>'
  );
}

/** TableDoc → xlsx 文件的字节。 */
export function writeXlsx(doc: TableDoc): Uint8Array {
  const styles = createStyles();
  const strings = createSharedStrings();
  const taken = new Set<string>();
  const names = doc.pages.map((p, i) => {
    const name = sheetName(p.name, i, taken);
    taken.add(name.toLowerCase());
    return name;
  });
  // 至少要有一张工作表。
  const pages = doc.pages.length
    ? doc.pages
    : [{ name: 'Sheet1', source: '', width: 1, height: 1, lineHeight: 20, blocks: [] }];
  if (!doc.pages.length) names.push('Sheet1');
  const sheets = pages.map((p) => sheetXml(p, doc.scope, styles, strings));
  const n = sheets.length;
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      HEAD +
        `<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>` +
        names
          .map(
            (name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId${n + 2}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
        '</Relationships>',
    ),
    ...Object.fromEntries(
      sheets.map((xml, i) => [`xl/worksheets/sheet${i + 1}.xml`, strToU8(xml)]),
    ),
    'xl/styles.xml': strToU8(styles.xml()),
    'xl/sharedStrings.xml': strToU8(strings.xml()),
  };
  return zipSync(files, { level: 6 });
}
