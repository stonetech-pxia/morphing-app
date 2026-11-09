import { builtinFormat, formatNumber } from './number-format';
import { OfficeImportFailure, openPackage, relKind } from './ooxml';
import type { CellAlign, TableBlock, TableCell, TableDoc, TablePage } from './types';
import { child, children, descendants, ownText, type XmlElement } from './xml';

// 外来的 xlsx（别的 App、电脑上的 Excel 做的）→ TableDoc（D-509）：放上桌用同一个表格编辑器改，存的时候照旧
// 由 writeXlsx 重新生成。每张工作表一页、一张表（从 A1 到最后一个有内容的格子，格子的位置和原来一样）：
// 格子的值（共享字符串、行内字符串、数字、布尔、错误）、合并格子、列宽、水平对齐。数字带着原来的值和数字格式
// （存的时候还是数字、日期），表上显示按格式写成的字；公式只留最后算出的结果，存的时候写成值（没有算过的写出公式本身的字）。
// 不读的：字体、颜色、填充、边框（存的时候也不画边框）、行高、隐藏、冻结、筛选、批注、图片和图表、数据验证、条件格式、名称。
// 纯 TS，在本机解析，不联网（不变量 1）；结果只在本机，不发给 AI（不变量 2）。

export interface XlsxImport {
  doc: TableDoc;
  /** 有几个公式格子（存的时候变成值）。 */
  formulas: number;
}

/** 整个工作簿最多这么多格（每张表从 A1 到最后一格的方块）：再多编辑页、预览画不动，当作太大。 */
export const MAX_IMPORT_CELLS = 20000;
/** writeXlsx 的页宽按这么多个字符算：页宽写成它，列宽就按字符数原样写回去。 */
const PAGE_CHARS = 110;

/** A1 这样的地址 → 行、列（从 0 起）；不是地址时 null。 */
export function cellRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]) - 1;
  return row >= 0 && col >= 1 ? { row, col: col - 1 } : null;
}

/** 共享字符串、行内字符串：直接的 t，或者几截富文本的 t 连起来（注音 rPh 不要）。 */
function stringItem(si: XmlElement | undefined): string {
  if (!si) return '';
  const t = child(si, 'x:t');
  if (t) return ownText(t);
  return children(si, 'x:r')
    .map((r) => ownText(child(r, 'x:t')))
    .join('');
}

const flag = (v: string | undefined) => v === '1' || v === 'true';

function alignOf(h: string | undefined): CellAlign | undefined {
  if (h === 'center' || h === 'centerContinuous') return 'center';
  if (h === 'right') return 'right';
  if (h === 'left') return 'left';
  return undefined;
}

interface Xf {
  format: string;
  align?: CellAlign;
}

function readStyles(root: XmlElement | undefined): Xf[] {
  const custom = new Map<number, string>();
  for (const f of children(child(root, 'x:numFmts'), 'x:numFmt')) {
    const id = Number(f.attrs.numFmtId);
    if (Number.isFinite(id) && f.attrs.formatCode !== undefined) custom.set(id, f.attrs.formatCode);
  }
  return children(child(root, 'x:cellXfs'), 'x:xf').map((xf) => {
    const id = Number(xf.attrs.numFmtId ?? 0);
    const align = alignOf(child(xf, 'x:alignment')?.attrs.horizontal);
    return {
      format: custom.get(id) ?? builtinFormat(id) ?? 'General',
      ...(align ? { align } : {}),
    };
  });
}

interface Value {
  text: string;
  write: NonNullable<TableCell['write']>;
  align?: CellAlign;
}

/** 读一份外来的 xlsx。加了密码、不是 xlsx、坏了、太大时抛 OfficeImportFailure。 */
export function importXlsx(data: Uint8Array): XlsxImport {
  const pkg = openPackage(data, (name) => /\.(xml|rels)$/i.test(name));
  const main = pkg.main() ?? (pkg.xml('xl/workbook.xml') ? 'xl/workbook.xml' : undefined);
  const workbook = main ? pkg.xml(main) : undefined;
  if (!main || workbook?.name !== 'x:workbook') throw new OfficeImportFailure('notOffice');
  const rels = pkg.rels(main);
  const relOf = (kind: string) =>
    [...rels.values()].find((r) => relKind(r) === kind && !r.external);
  const stringsPart = relOf('sharedStrings')?.target;
  const strings = children(stringsPart ? pkg.xml(stringsPart) : undefined, 'x:si').map(stringItem);
  const stylesPart = relOf('styles')?.target;
  const xfs = readStyles(stylesPart ? pkg.xml(stylesPart) : undefined);
  const date1904 = flag(child(workbook, 'x:workbookPr')?.attrs.date1904);
  let formulas = 0;
  let total = 0;
  const pages: TablePage[] = [];
  for (const sheet of children(child(workbook, 'x:sheets'), 'x:sheet')) {
    const rel = rels.get(sheet.attrs['r:id'] ?? '');
    // 图表工作表、对话框工作表没有格子。
    if (!rel || rel.external || relKind(rel) !== 'worksheet') continue;
    const root = pkg.xml(rel.target);
    if (!root) continue;
    const values = new Map<string, Value>();
    let maxRow = -1;
    let maxCol = -1;
    let row = -1;
    for (const r of children(child(root, 'x:sheetData'), 'x:row')) {
      row = r.attrs.r ? Number(r.attrs.r) - 1 : row + 1;
      if (!Number.isInteger(row) || row < 0) continue;
      let col = -1;
      for (const c of children(r, 'x:c')) {
        const at = c.attrs.r ? cellRef(c.attrs.r) : null;
        col = at ? at.col : col + 1;
        const value = readCell(c, strings, xfs, date1904);
        if (child(c, 'x:f')) formulas++;
        if (!value) continue;
        values.set(`${row},${col}`, value);
        if (values.size > MAX_IMPORT_CELLS) throw new OfficeImportFailure('tooLarge');
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, col);
      }
    }
    const merges: { row: number; col: number; rows: number; cols: number }[] = [];
    for (const m of children(child(root, 'x:mergeCells'), 'x:mergeCell')) {
      const [a, b] = (m.attrs.ref ?? '').split(':');
      const from = a ? cellRef(a) : null;
      const to = b ? cellRef(b) : from;
      if (!from || !to) continue;
      const top = Math.min(from.row, to.row);
      const left = Math.min(from.col, to.col);
      const rows = Math.abs(to.row - from.row) + 1;
      const cols = Math.abs(to.col - from.col) + 1;
      merges.push({ row: top, col: left, rows, cols });
      maxRow = Math.max(maxRow, top + rows - 1);
      maxCol = Math.max(maxCol, left + cols - 1);
    }
    const rows = Math.max(1, maxRow + 1);
    const cols = Math.max(1, maxCol + 1);
    total += rows * cols;
    if (total > MAX_IMPORT_CELLS) throw new OfficeImportFailure('tooLarge');
    pages.push(sheetPage(sheet.attrs.name ?? '', root, values, merges, rows, cols));
  }
  if (!pages.length) pages.push(sheetPage('Sheet1', undefined, new Map(), [], 1, 1));
  return { doc: { version: 2, scope: 'all', pages }, formulas };
}

function readCell(
  c: XmlElement,
  strings: readonly string[],
  xfs: readonly Xf[],
  date1904: boolean,
): Value | null {
  const type = c.attrs.t ?? 'n';
  const xf = xfs[Number(c.attrs.s ?? 0)] ?? { format: 'General' };
  const v = child(c, 'x:v');
  const raw = v ? ownText(v) : undefined;
  const align = xf.align ? { align: xf.align } : {};
  const text = (s: string): Value => ({ text: s, write: { kind: 'text' }, ...align });
  if (type === 'inlineStr') {
    const s = stringItem(child(c, 'x:is'));
    return s ? text(s) : null;
  }
  if (raw === undefined) {
    // 没算过的公式（别的程序写的）：留下公式本身的字，不然这一格什么都没有。
    const f = ownText(child(c, 'x:f'));
    return f ? text(`=${f}`) : null;
  }
  if (type === 's') {
    const s = strings[Number(raw)] ?? '';
    return s ? text(s) : null;
  }
  if (type === 'str' || type === 'e' || type === 'd') return raw ? text(raw) : null;
  if (type === 'b') return text(raw === '1' || raw === 'true' ? 'TRUE' : 'FALSE');
  const value = Number(raw);
  if (!Number.isFinite(value) || raw.trim() === '') return raw.trim() ? text(raw) : null;
  return {
    text: formatNumber(value, xf.format, date1904),
    write: { kind: 'number', value, format: xf.format },
    ...align,
  };
}

function sheetPage(
  name: string,
  root: XmlElement | undefined,
  values: Map<string, Value>,
  merges: readonly { row: number; col: number; rows: number; cols: number }[],
  rows: number,
  cols: number,
): TablePage {
  // 列宽（字符）：<col> 写的，没写的用工作表的默认列宽。
  const format = child(root, 'x:sheetFormatPr');
  // Excel 的默认列宽是 8.43 个字符（基本宽 8 加上格子的边距）。
  const fallback =
    Number(format?.attrs.defaultColWidth) || (Number(format?.attrs.baseColWidth) || 8) + 0.43;
  const colWidths = Array.from({ length: cols }, () => fallback);
  for (const c of descendants(child(root, 'x:cols'), 'x:col')) {
    const min = Number(c.attrs.min);
    const max = Number(c.attrs.max);
    const width = Number(c.attrs.width);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(width)) continue;
    for (let k = Math.max(1, min); k <= Math.min(max, cols); k++) colWidths[k - 1] = width;
  }
  // 合并格子：左上角那一格横跨几行几列，盖住的位置不再有格子；和前面的合并区域重叠的不要。
  const covered = new Set<string>();
  const spans = new Map<string, { rows: number; cols: number }>();
  for (const m of merges) {
    let clash = false;
    for (let r = m.row; r < m.row + m.rows && !clash; r++)
      for (let c = m.col; c < m.col + m.cols && !clash; c++) clash = covered.has(`${r},${c}`);
    if (clash) continue;
    for (let r = m.row; r < m.row + m.rows; r++)
      for (let c = m.col; c < m.col + m.cols; c++) covered.add(`${r},${c}`);
    spans.set(`${m.row},${m.col}`, { rows: m.rows, cols: m.cols });
  }
  const cells: TableCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      const span = spans.get(key);
      if (covered.has(key) && !span) continue;
      const value = values.get(key);
      cells.push({
        row: r,
        col: c,
        rowSpan: span?.rows ?? 1,
        colSpan: span?.cols ?? 1,
        text: value?.text ?? '',
        ...(value?.align ? { align: value.align } : {}),
        ...(value ? { write: value.write } : {}),
      });
    }
  }
  const table: TableBlock = {
    kind: 'table',
    rows,
    col: 0,
    cols,
    cells,
    box: { x: 0, y: 0, width: PAGE_CHARS, height: rows },
    borderless: true,
  };
  return {
    name,
    source: '',
    width: PAGE_CHARS,
    height: rows,
    lineHeight: 1,
    colWidths: colWidths.map((w) => Math.round(w * 100) / 100),
    blocks: [table],
  };
}
