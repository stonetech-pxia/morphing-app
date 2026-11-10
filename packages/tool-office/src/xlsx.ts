import { strToU8, zipSync, type Zippable } from 'fflate';

import type { Box, CellAlign, TableBlock, TableCell, TableDoc, TablePage } from './types';

// 写 xlsx（D-272）：自己写 XML，用 fflate 的同步 API 打包（Hermes 没有 Worker，也没有 Node 的 stream）。
// 每页一张工作表；字符串放 sharedStrings（Numbers 和 WPS 对它的支持比 inlineStr 稳）；
// 样式按需要生成：表格格（细边框、自动换行、靠上）、表外的文字（自动换行、无边框）、数字（表格格加数字格式），
// 再按对齐（左、居中、右；没有时是「常规」）分开。

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** 一格最多 32767 个字符（Excel 的上限）。 */
const MAX_CELL_CHARS = 32767;
/** 原图的整页宽度大约等于这么多个字符宽（Excel 的列宽单位）。 */
const PAGE_CHARS = 110;
/** 一行字的高度（磅，11 号字）。 */
export const LINE_POINTS = 15;
/** Excel 的行高上限（磅）；超过时它会说文件坏了。 */
const MAX_ROW_POINTS = 409;
/** 没写字号的格子（老文件、编辑页加的）用的字号：xlsx 默认字体是 11 磅 Calibri。 */
export const DEFAULT_FONT_SIZE = 11;
/** 一个字符宽（Excel 列宽的单位）大约这么多像素（Calibri 11 的数字宽）。 */
const CHAR_PIXELS = 7;
const EMU_PER_PIXEL = 9525;
const EMU_PER_POINT = 12700;

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
  General: 0,
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
  '0%': 9,
  '0.00%': 10,
  // 日期、时间（外来的 xlsx 读进来的，D-509）：写回自带的编号，Excel 按手机、电脑的地区显示短日期。
  'mm-dd-yy': 14,
  'd-mmm-yy': 15,
  'd-mmm': 16,
  'mmm-yy': 17,
  'h:mm AM/PM': 18,
  'h:mm:ss AM/PM': 19,
  'h:mm': 20,
  'h:mm:ss': 21,
  'm/d/yy h:mm': 22,
  'mm:ss': 45,
  '[h]:mm:ss': 46,
  'mmss.0': 47,
};

/** 估一段文字在 width 个字符宽的格子里占几行（中日韩文字算两个字符宽）。编辑页也用它估行高。 */
export function lineCount(text: string, width: number): number {
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

interface StyleKey {
  /** 表格格：细边框；表外的文字没有边框。 */
  border: boolean;
  /** 数字格式；文字没有（文字自动换行，数字不换）。 */
  format?: string;
  align?: CellAlign;
  /** 字号（磅）和粗体（D-521）；11 磅不加粗是默认字体。 */
  size?: number;
  bold?: boolean;
}

interface Styles {
  /** 样式编号（cellXfs 里的下标）；0 是默认样式。 */
  style(key: StyleKey): number;
  xml(): string;
}

function createStyles(): Styles {
  const keys: StyleKey[] = [];
  const ids = new Map<string, number>();
  const custom = new Map<string, number>();
  const fonts: { size: number; bold: boolean }[] = [{ size: DEFAULT_FONT_SIZE, bold: false }];
  const fontId = (key: StyleKey) => {
    const size = key.size ?? DEFAULT_FONT_SIZE;
    const bold = key.bold === true;
    let i = fonts.findIndex((f) => f.size === size && f.bold === bold);
    if (i < 0) i = fonts.push({ size, bold }) - 1;
    return i;
  };
  const formatId = (code: string) => {
    if (BUILT_IN_FORMATS[code] !== undefined) return BUILT_IN_FORMATS[code]!;
    if (!custom.has(code)) custom.set(code, 164 + custom.size);
    return custom.get(code)!;
  };
  return {
    style(key) {
      const id = `${key.border}|${key.format ?? ''}|${key.align ?? ''}|${key.size ?? DEFAULT_FONT_SIZE}|${key.bold === true}`;
      if (!ids.has(id)) {
        if (key.format) formatId(key.format);
        fontId(key);
        ids.set(id, keys.push(key));
      }
      return ids.get(id)!;
    },
    xml() {
      const xfs = keys.map((k) => {
        const align =
          (k.align ? ` horizontal="${k.align}"` : '') +
          ' vertical="top"' +
          (k.format ? '' : ' wrapText="1"');
        return (
          `<xf numFmtId="${k.format ? formatId(k.format) : 0}" fontId="${fontId(k)}" fillId="0" borderId="${k.border ? 1 : 0}" xfId="0"` +
          (k.format ? ' applyNumberFormat="1"' : '') +
          (fontId(k) ? ' applyFont="1"' : '') +
          (k.border ? ' applyBorder="1"' : '') +
          ` applyAlignment="1"><alignment${align}/></xf>`
        );
      });
      const numFmts = custom.size
        ? `<numFmts count="${custom.size}">${[...custom]
            .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`)
            .join('')}</numFmts>`
        : '';
      return (
        HEAD +
        `<styleSheet xmlns="${NS}">${numFmts}` +
        `<fonts count="${fonts.length}">${fonts
          .map(
            (f) =>
              `<font>${f.bold ? '<b/>' : ''}<sz val="${f.size}"/><name val="Calibri"/><family val="2"/></font>`,
          )
          .join('')}</fonts>` +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${1 + xfs.length}">` +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        xfs.join('') +
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

/** 一张工作表的列宽（字符）：整页共用的列（D-272），原图像素按页宽换算。 */
export function sheetColumns(page: TablePage): number[] {
  const toChars = (px: number) =>
    Math.round(Math.min(120, Math.max(4, (px / Math.max(1, page.width)) * PAGE_CHARS)) * 10) / 10;
  return page.colWidths.map(toChars);
}

/** 工作表上的一格（合并格子只有左上角）：表格里的格子记着是哪张表的第几格，表外的文字、图片记着是第几块。 */
export interface SheetCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  align?: CellAlign;
  /** 在 page.blocks 里的下标。 */
  block: number;
  /** 表格格子在 table.cells 里的下标；表外的文字、图片没有。 */
  cell?: number;
  /** 表格格子在它那张表里是第几行（并排的两张表共用工作表的行，rows[].tableRow 只记第一张）。 */
  tableRow?: number;
  write?: TableCell['write'];
  /** 字号（磅）和粗体（D-521）；没有时是 11 磅。 */
  size?: number;
  bold?: boolean;
  /** 这一格是一张图片（D-520）：src 是图片的地址（还没剪出来时没有）；width、height 是它在工作表上的大小（磅）；text 是空的。 */
  image?: { src?: string; width: number; height: number };
}

/** 一页排到工作表上的样子：编辑页照着它画，写 xlsx 也照着它写，两边一样。 */
export interface SheetLayout {
  /** 列宽（Excel 的字符宽）。 */
  colWidths: number[];
  /**
   * 每一行：估的行数（按这一行里字最多的格子算）、行高（磅，按字号）、属于哪一块（空行是 null；
   * 并排的几块共用的行记第一块）、是那张表的第几行。
   */
  rows: { lines: number; points: number; block: number | null; tableRow?: number }[];
  cells: SheetCell[];
}

/** 一行字的行高（磅）：和 11 磅配 15 磅的比例一样。 */
const linePoints = (size: number) =>
  Math.round(((size * LINE_POINTS) / DEFAULT_FONT_SIZE) * 10) / 10;

/** 估一段文字在 width 个字符宽的格子里占几行；字号小于 11 磅时一行放得下更多的字。 */
export function lineCountAt(text: string, width: number, size = DEFAULT_FONT_SIZE): number {
  return lineCount(text, (width * DEFAULT_FONT_SIZE) / size);
}

/** 一张图片在工作表上的大小（磅）：宽是它占的几列的宽，高按原图里框的长宽比。 */
export function imageSizePoints(colWidths: readonly number[], col: number, cols: number, box: Box) {
  let chars = 0;
  for (let c = col; c < col + cols; c++) chars += colWidths[c] ?? 8;
  const width = (chars * CHAR_PIXELS * EMU_PER_PIXEL) / EMU_PER_POINT;
  return { width, height: (width * box.height) / Math.max(1, box.width) };
}

/**
 * 一页排成工作表：块按顺序往下排，块和块之间空隙超过 1.5 倍行高时空一行（大致保留原来的间距）；
 * 整页一套列（D-272），表格从它的第一列（TableBlock.col）开始；表外的文字每段一行，没有列范围时从第一列合并到最后一列。
 * 同一个 band（D-522）的块从同一行起：左栏、右栏、旁边的图片各排各的列，每一栏的块在栏里从上往下排，
 * 一带排完以后下一块从最长的一栏的下面开始。图片（D-520）占的行数按它的大小排，字号（D-521）定行高。
 */
export function layoutSheet(page: TablePage, scope: TableDoc['scope']): SheetLayout {
  const blocks = pageBlocks(page, scope);
  const colWidths = sheetColumns(page);
  const bodySize = page.bodySize ?? DEFAULT_FONT_SIZE;
  const rows: SheetLayout['rows'] = [];
  const cells: SheetCell[] = [];
  const ensure = (row: number, block: number | null) => {
    while (rows.length <= row) rows.push({ lines: 1, points: LINE_POINTS, block: null });
    if (block !== null && rows[row]!.block === null) rows[row]!.block = block;
  };
  /** 一行的高度只增不减。 */
  const grow = (row: number, lines: number, points: number) => {
    const r = rows[row]!;
    r.lines = Math.max(r.lines, lines);
    r.points = Math.max(r.points, points);
  };
  let prevBottom: number | null = null;
  // 一带：从哪一行起、每一列下一个空行、每一列上一块的下边（原图像素）。
  interface Band {
    id: number;
    start: number;
    next: number[];
    bottom: (number | null)[];
  }
  let band = null as Band | null;
  for (const block of blocks) {
    const index = page.blocks.indexOf(block);
    if (block.kind === 'table' && block.rows < 1) continue;
    const from = block.kind === 'text' ? (block.col ?? 0) : block.col;
    const span =
      block.kind === 'text' ? (block.cols ?? Math.max(1, colWidths.length - from)) : block.cols;
    const col0 = Math.min(Math.max(0, from), Math.max(0, colWidths.length - 1));
    const cols = Math.max(1, Math.min(span, colWidths.length - col0));
    const bandId = block.band;
    let start: number;
    if (bandId !== undefined && band?.id === bandId) {
      // 同一带里的块：在自己这一栏里接着上一块往下排，栏里的段落之间空隙大时空一行。
      start = Math.max(...band.next.slice(col0, col0 + cols));
      const above = Math.max(...band.bottom.slice(col0, col0 + cols).map((b) => b ?? -Infinity));
      if (start > band.start && block.box.y - above > 1.5 * page.lineHeight) start++;
      prevBottom = Math.max(prevBottom ?? -Infinity, block.box.y + block.box.height);
    } else {
      start = rows.length;
      if (prevBottom !== null && block.box.y - prevBottom > 1.5 * page.lineHeight) start++;
      prevBottom = block.box.y + block.box.height;
      band =
        bandId !== undefined
          ? {
              id: bandId,
              start,
              next: colWidths.map(() => start),
              bottom: colWidths.map(() => null),
            }
          : null;
    }
    ensure(start, index);
    let used = 1;
    if (block.kind === 'text') {
      const text = cleanXmlText(block.text);
      let width = 0;
      for (let c = col0; c < col0 + cols; c++) width += colWidths[c] ?? 8;
      const size = block.size ?? bodySize;
      const lines = lineCountAt(text, width, size);
      // 并排的一带里的文字（旁边是表、图片、别的栏）不撑高行，不然旁边那张表的行被撑得很高：
      // 往下合并几行，高度够放下它的字。
      if (bandId !== undefined) {
        used = Math.max(1, Math.ceil((lines * linePoints(size)) / LINE_POINTS - 1e-6));
        ensure(start + used - 1, index);
      }
      cells.push({
        row: start,
        col: col0,
        rowSpan: used,
        colSpan: cols,
        text,
        ...(block.align ? { align: block.align } : {}),
        block: index,
        ...(size !== DEFAULT_FONT_SIZE ? { size } : {}),
        ...(block.bold ? { bold: true } : {}),
      });
      if (bandId === undefined) grow(start, lines, lines * linePoints(size));
    } else if (block.kind === 'image') {
      const { width, height } = imageSizePoints(colWidths, col0, cols, block.box);
      used = Math.max(1, Math.ceil(height / LINE_POINTS - 1e-6));
      ensure(start + used - 1, index);
      for (let r = start; r < start + used; r++) grow(r, 1, LINE_POINTS);
      cells.push({
        row: start,
        col: col0,
        rowSpan: used,
        colSpan: cols,
        text: '',
        block: index,
        image: { ...(block.src ? { src: block.src } : {}), width, height },
      });
    } else {
      used = block.rows;
      ensure(start + used - 1, index);
      for (let r = 0; r < block.rows; r++) rows[start + r]!.tableRow = r;
      for (const [i, cell] of block.cells.entries()) {
        const text = cleanXmlText(cell.text).trim();
        const { box: _box, size: cellSize, ...rest } = cell;
        const col = block.col + cell.col;
        const size = cellSize ?? bodySize;
        cells.push({
          ...rest,
          row: start + cell.row,
          col,
          text,
          block: index,
          cell: i,
          tableRow: cell.row,
          ...(size !== DEFAULT_FONT_SIZE ? { size } : {}),
        });
        if (cell.rowSpan === 1 && text) {
          let width = 0;
          for (let c = col; c < col + cell.colSpan; c++) width += colWidths[c] ?? 8;
          const lines = lineCountAt(text, width, size);
          grow(start + cell.row, lines, lines * linePoints(size));
        }
      }
    }
    if (band) {
      for (let c = col0; c < col0 + cols; c++) {
        band.next[c] = start + used;
        band.bottom[c] = block.box.y + block.box.height;
      }
    }
  }
  return { colWidths, rows, cells };
}

/** 写进 xlsx 的图片：JPG（或 PNG）字节和像素大小（和 docx 里的 DocxImage 一样）。 */
export interface XlsxImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** 图片文件的格式（看开头的字节）：PNG；别的按 JPG。 */
const imageType = (bytes: Uint8Array): 'png' | 'jpg' =>
  bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : 'jpg';

/** 一张工作表里要放的图片：左上角在哪一格、大小（磅）、是整个文件里的第几张图片文件。 */
interface SheetPicture {
  row: number;
  col: number;
  width: number;
  height: number;
  media: number;
}

function sheetXml(
  page: TablePage,
  scope: TableDoc['scope'],
  styles: Styles,
  strings: SharedStrings,
  images: ReadonlyMap<string, XlsxImage>,
  media: Uint8Array[],
): { xml: string; pictures: SheetPicture[] } {
  const layout = layoutSheet(page, scope);
  const rowCells: Map<number, string>[] = layout.rows.map(() => new Map());
  const merges: string[] = [];
  const pictures: SheetPicture[] = [];
  for (const cell of layout.cells) {
    if (cell.image) {
      // 图片锚在它左上角那一格；没有剪出来、读不到的图片不写。
      const image = cell.image.src ? images.get(cell.image.src) : undefined;
      if (image) {
        let at = media.indexOf(image.bytes);
        if (at < 0) at = media.push(image.bytes) - 1;
        pictures.push({
          row: cell.row,
          col: cell.col,
          width: cell.image.width,
          height: cell.image.height,
          media: at + 1,
        });
      }
      continue;
    }
    const table = cell.cell !== undefined;
    // 外来的 xlsx 读进来的表（D-509）不画边框。
    const plain = table && (page.blocks[cell.block] as TableBlock).borderless === true;
    const at = ref(cell.row, cell.col);
    const number =
      cell.write?.kind === 'number'
        ? cell.write
        : table && cell.text && !cell.write
          ? cellNumber(cell.text)
          : null;
    const align = cell.align ? { align: cell.align } : {};
    const font = {
      ...(cell.size !== undefined ? { size: cell.size } : {}),
      ...(cell.bold ? { bold: true } : {}),
    };
    const empty = styles.style({ border: !plain, ...font });
    let xml: string;
    if (!cell.text) xml = `<c r="${at}" s="${empty}"/>`;
    else if (number) {
      const s = styles.style({ border: !plain, format: number.format, ...align, ...font });
      xml = `<c r="${at}" s="${s}"><v>${number.value}</v></c>`;
    } else {
      const s = styles.style({ border: table && !plain, ...align, ...font });
      xml = `<c r="${at}" s="${s}" t="s"><v>${strings.index(cell.text)}</v></c>`;
    }
    rowCells[cell.row]!.set(cell.col, xml);
    if (cell.rowSpan > 1 || cell.colSpan > 1) {
      merges.push(`${at}:${ref(cell.row + cell.rowSpan - 1, cell.col + cell.colSpan - 1)}`);
    }
    // 合并区域盖住的表格格子也要写（带边框样式），否则合并后的格子只有左上角有边框。
    if (!table) continue;
    for (let dr = 0; dr < cell.rowSpan; dr++) {
      for (let dc = 0; dc < cell.colSpan; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = cell.row + dr;
        const c = cell.col + dc;
        if (rowCells[r]) rowCells[r]!.set(c, `<c r="${ref(r, c)}" s="${empty}"/>`);
      }
    }
  }
  const cols = layout.colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const data = layout.rows
    .map((row, r) => {
      const cells = [...rowCells[r]!].sort((a, b) => a[0] - b[0]).map(([, xml]) => xml);
      return cells.length || row.points > LINE_POINTS
        ? `<row r="${r + 1}" ht="${Math.min(MAX_ROW_POINTS, row.points)}" customHeight="1">${cells.join('')}</row>`
        : '';
    })
    .join('');
  const xml =
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
    (pictures.length ? '<drawing r:id="rId1"/>' : '') +
    '</worksheet>';
  return { xml, pictures };
}

/** 一张工作表的图片放置（drawing 部分）：每张图锚在左上角那一格，大小按磅；rId 对应 drawing 的关系文件。 */
function drawingXml(pictures: readonly SheetPicture[]): string {
  const anchors = pictures
    .map((p, i) => {
      const cx = Math.round(p.width * EMU_PER_POINT);
      const cy = Math.round(p.height * EMU_PER_POINT);
      return (
        '<xdr:oneCellAnchor>' +
        `<xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>'
      );
    })
    .join('');
  return (
    HEAD +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}">` +
    anchors +
    '</xdr:wsDr>'
  );
}

/**
 * TableDoc → xlsx 文件的字节。images 按图片块的 src 给剪好的图片字节（D-520）；没有的图片块跳过。
 */
export function writeXlsx(
  doc: TableDoc,
  images: ReadonlyMap<string, XlsxImage> = new Map(),
): Uint8Array {
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
    : [
        {
          name: 'Sheet1',
          source: '',
          width: 1,
          height: 1,
          lineHeight: 20,
          colWidths: [1, 1, 1, 1],
          blocks: [],
        },
      ];
  if (!doc.pages.length) names.push('Sheet1');
  const media: Uint8Array[] = [];
  const built = pages.map((p) => sheetXml(p, doc.scope, styles, strings, images, media));
  const sheets = built.map((b) => b.xml);
  const n = sheets.length;
  // 有图片的工作表：sheetN.xml 的关系文件指向 drawingM.xml，它再指向 media 里的图片。
  const drawn = built.flatMap((b, i) => (b.pictures.length ? [{ sheet: i + 1, ...b }] : []));
  const mediaExt = media.map(imageType);
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        (mediaExt.includes('jpg') ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : '') +
        (mediaExt.includes('png') ? '<Default Extension="png" ContentType="image/png"/>' : '') +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        drawn
          .map(
            (_, k) =>
              `<Override PartName="/xl/drawings/drawing${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
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
    ...Object.fromEntries(
      drawn.flatMap((d, k) => [
        [
          `xl/worksheets/_rels/sheet${d.sheet}.xml.rels`,
          strToU8(
            HEAD +
              `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/drawing" Target="../drawings/drawing${k + 1}.xml"/></Relationships>`,
          ),
        ],
        [`xl/drawings/drawing${k + 1}.xml`, strToU8(drawingXml(d.pictures))],
        [
          `xl/drawings/_rels/drawing${k + 1}.xml.rels`,
          strToU8(
            HEAD +
              `<Relationships xmlns="${PKG_REL}">` +
              d.pictures
                .map(
                  (p, i) =>
                    `<Relationship Id="rId${i + 1}" Type="${REL_NS}/image" Target="../media/image${p.media}.${mediaExt[p.media - 1]}"/>`,
                )
                .join('') +
              '</Relationships>',
          ),
        ],
      ]),
    ),
    ...Object.fromEntries(
      media.map((bytes, i) => [`xl/media/image${i + 1}.${mediaExt[i]}`, [bytes, { level: 0 }]]),
    ),
    'xl/styles.xml': strToU8(styles.xml()),
    'xl/sharedStrings.xml': strToU8(strings.xml()),
  };
  return zipSync(files, { level: 6 });
}

/** 记录导出的一格（core 的 recordsToSheet 给的，D-427）。 */
export type RowValue =
  { kind: 'text'; text: string } | { kind: 'number'; value: number; format: string; text: string };

/** 列宽（字符）：够最长的内容，不窄于 8、不宽于 40。 */
function rowColumns(rows: readonly (readonly RowValue[])[]): number[] {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return Array.from({ length: cols }, (_, c) => {
    let width = 8;
    for (const row of rows) {
      const text = row[c]?.text;
      if (!text) continue;
      for (const line of text.split('\n')) {
        // lineCount 在宽 2 的格子里每个单位一行：等于这段文字的字符宽。
        width = Math.max(width, lineCount(line, 2) + 2);
        if (width >= 40) return 40;
      }
    }
    return width;
  });
}

/**
 * 一张工作表的 xlsx（记录导出，D-427）：每一格写成什么由调用方定，不猜。
 * 文字一律是共享字符串（t="s"），文件里没有公式：OCR 出来的「=SUM(A1)」「+33 1…」打开还是文字。
 */
export function writeRowsXlsx(name: string, rows: readonly (readonly RowValue[])[]): Uint8Array {
  const widths = rowColumns(rows);
  const cells: TableCell[] = rows.flatMap((row, r) =>
    row.map((value, c) => ({
      row: r,
      col: c,
      rowSpan: 1,
      colSpan: 1,
      text: value.text,
      write:
        value.kind === 'number'
          ? { kind: 'number' as const, value: value.value, format: value.format }
          : { kind: 'text' as const },
    })),
  );
  return writeXlsx({
    version: 3,
    scope: 'tables',
    pages: [
      {
        name,
        source: '',
        // 宽度 = 字符数：sheetColumns 按 宽 / 页宽 × 110 换算。
        width: PAGE_CHARS,
        height: rows.length,
        lineHeight: 1,
        colWidths: widths,
        blocks: [
          {
            kind: 'table',
            rows: rows.length,
            col: 0,
            cols: widths.length,
            cells,
            box: { x: 0, y: 0, width: PAGE_CHARS, height: rows.length },
          },
        ],
      },
    ],
  });
}
