import type { Locale } from '../schema';
import { extractAll } from '../text-rules';
import { ruleCandidates } from './candidates';
import { ctx } from './doc-context';
import type { ValueKind } from './concepts';

// 新记录表单的候选值（D-394）：识别出的文字行（带框）按竖直重叠分排，再切出「标签 → 值」。
// 照搬测量用的 side-session-notes/prefill-ranking/scripts/emit.ts：按排的文字比 layoutOcrLines
// 接成一段的准（prefill-real-ocr 第 8 节第 5 条）。文字只在本机，不发给 AI。
// 不用后行断言（Hermes 的老版本不支持）：前面的边界用捕获组。

/** 一行识别结果：文字和它在这一页上的框（像素）。 */
export interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一页：识别（或 PDF 文字层）给出的行。 */
export interface TextPage {
  width: number;
  height: number;
  lines: readonly TextBox[];
}

/** 一处值：种类、统一后的写法、原文和它的标签（没有标签时为 ""）。 */
export interface Occurrence {
  kind: ValueKind;
  value: string;
  raw: string;
  label: string;
  /** 第几页（从 0 开始）、这一页的第几排。 */
  page: number;
  row: number;
  /** 这一排在这一页上的竖直位置（0 顶，1 底）。 */
  relY: number;
  dateOrder?: 'DMY' | 'MDY';
  /** 文字值看起来是别的种类（日期、金额、电话、网址……），文字字段不要它。 */
  other?: boolean;
}

export interface PageRows {
  rows: { text: string; relY: number }[];
}

function rowsOf(lines: readonly TextBox[]): TextBox[][] {
  const sorted = lines
    .filter((l) => l.text.trim())
    .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const groups: TextBox[][] = [];
  for (const line of sorted) {
    const first = groups.at(-1)?.[0];
    if (first) {
      const overlap =
        Math.min(first.y + first.height, line.y + line.height) - Math.max(first.y, line.y);
      if (overlap >= 0.5 * Math.min(first.height, line.height)) {
        groups.at(-1)!.push(line);
        continue;
      }
    }
    groups.push([line]);
  }
  return groups.map((g) => g.sort((a, b) => a.x - b.x));
}

/** 一排切成单元格：相邻两段的空隙小于 0.8 倍字高就接起来，否则分开。 */
function cellsOf(row: readonly TextBox[]): string[] {
  const h = Math.min(...row.map((s) => s.height));
  const cells: string[] = [];
  let prevEnd = -Infinity;
  for (const s of row) {
    if (cells.length && s.x - prevEnd < 0.8 * h) cells[cells.length - 1] += ' ' + s.text.trim();
    else cells.push(s.text.trim());
    prevEnd = s.x + s.width;
  }
  return cells;
}

const cleanLabel = (s: string) => s.replace(/^[\s|·•*=\-–—#]+|[\s:：\-–—|·•*=#.]+$/g, '').trim();
// 电话、编号：前面不能紧挨着字母数字（用捕获组代替后行断言）。
const PHONE = /(^|[^\w+\-/#])(\+?\(?\d[\d\s\-().·]{5,}\d)(?!\d)/g;
const ID = /(^|[^\w])((?=[A-Za-z0-9\-/#.]*\d)[A-Za-z0-9][A-Za-z0-9\-/#.]{3,29})(?!\w)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const digits = (s: string) => s.replace(/\D/g, '');

interface Typed {
  kind: ValueKind;
  value: string;
  raw: string;
  start: number;
  end: number;
  dateOrder?: 'DMY' | 'MDY';
}

/** 一个单元格里的类型值（金额、日期、电话、邮箱、编号），带起止位置。 */
function typed(cell: string, locale: Locale): Typed[] {
  const out: Typed[] = [];
  for (const c of ruleCandidates(cell, locale))
    out.push({
      kind: c.kind === 'amount' ? 'money' : 'date',
      value: c.value,
      raw: c.raw,
      start: c.start,
      end: c.end,
      ...(c.dateOrder ? { dateOrder: c.dateOrder } : {}),
    });
  const overlaps = (s: number, e: number) => out.some((o) => s < o.end && e > o.start);
  for (const m of cell.matchAll(EMAIL)) {
    if (extractAll(m[0], 'email', locale).length)
      out.push({
        kind: 'email',
        value: m[0].toLowerCase(),
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
  }
  for (const m of cell.matchAll(PHONE)) {
    const at = m.index + m[1]!.length;
    const raw = m[2]!.replace(/[\s\-(.·]+$/, '');
    const n = digits(raw).length;
    if (n < 7 || n > 15 || overlaps(at, at + raw.length)) continue;
    out.push({ kind: 'phone', value: digits(raw), raw, start: at, end: at + raw.length });
  }
  for (const m of cell.matchAll(ID)) {
    const at = m.index + m[1]!.length;
    const raw = m[2]!.replace(/[.\-/]+$/, '');
    if (digits(raw).length < 3 || overlaps(at, at + raw.length)) continue;
    out.push({ kind: 'id', value: raw.toUpperCase(), raw, start: at, end: at + raw.length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 看起来是一个类型值（不是普通的字）：编号要占这段文字的一半以上。 */
export function looksTyped(s: string, locale: Locale): boolean {
  return (
    typed(s, locale).some(
      (t) => t.kind !== 'id' || t.raw.length >= 0.5 * s.replace(/\s/g, '').length,
    ) || extractAll(s, 'url', locale).length > 0
  );
}

const wordCount = (s: string) =>
  /[㐀-鿿]/.test(s)
    ? Math.ceil(s.replace(/\s/g, '').length / 3)
    : s.split(/\s+/).filter(Boolean).length;

/** 一页的排和全部「标签 → 值」。 */
export function pageOccurrences(
  page: TextPage,
  pageIndex: number,
  locale: Locale,
): { rows: { text: string; relY: number; cells: string[] }[]; occ: Occurrence[] } {
  const rows = rowsOf(page.lines);
  const pageH = page.height || 1;
  const info = rows.map((r) => {
    const top = Math.min(...r.map((s) => s.y));
    const bottom = Math.max(...r.map((s) => s.y + s.height));
    const cells = cellsOf(r);
    return { cells, text: cells.join(' '), relY: (top + bottom) / 2 / pageH };
  });
  const occ: Occurrence[] = [];
  // 只有标签的一排：自己没有类型值，短（≤4 个词），冒号后面没有字（「用途: 餐饮」已经有值了），
  // 以冒号结尾的才算「一定是标签」。
  const labelOnly = info.map(
    (r) =>
      !looksTyped(r.text, locale) &&
      wordCount(r.text) <= 4 &&
      r.text.length <= 30 &&
      !/[:：]\s*\S/.test(r.text),
  );
  const sureLabel = info.map((r, i) => labelOnly[i] && /[:：]\s*$/.test(r.text));
  info.forEach((r, ri) => {
    // 告诉日期、金额规则这一排有几个金额（空格千位分隔的数要不要整体取）。
    ctx.rowMany = (r.text.match(/\d[.,]\d{2}(?!\d)/g) ?? []).length;
    const above = ri > 0 && labelOnly[ri - 1] ? cleanLabel(info[ri - 1]!.text) : '';
    const aboveSure = ri > 0 && sureLabel[ri - 1];
    const base = { page: pageIndex, row: ri, relY: r.relY };
    let prevText = ''; // 这一排里左边最近的不是值的单元格
    for (const cell of r.cells) {
      const colon = cell.search(/[:：]/);
      const hasColon = colon > 0 && colon <= 40;
      const left = hasColon ? cleanLabel(cell.slice(0, colon)) : '';
      const right = hasColon ? cell.slice(colon + 1) : cell;
      // 类型值：标签 = 同一格里值前面的字（含冒号左边），或左边的单元格，或上面只有标签的一排。
      // 同一格里有几个值时（Inv No :KSB800 Date:11/03/18），每个值的标签是它和前一个值之间的字。
      const tc = typed(cell, locale);
      for (const v of tc) {
        const prevEnd = Math.max(0, ...tc.filter((w) => w.end <= v.start).map((w) => w.end));
        const prefix = cleanLabel(cell.slice(prevEnd, v.start).replace(/[\d.,\s$€£¥￥]+$/, ''));
        let label = prefix || prevText;
        if (!label && above) label = above;
        const order = v.dateOrder ? { dateOrder: v.dateOrder } : {};
        occ.push({ kind: v.kind, value: v.value, raw: v.raw, label, ...base, ...order });
        if (!prefix && !prevText && above && !aboveSure)
          occ.push({ kind: v.kind, value: v.value, raw: v.raw, label: '', ...base, ...order });
      }
      // 文字值（商家、姓名、出发地这类字段和单选）：整格（冒号右边）。
      const value = right.trim();
      if (value) {
        const other = looksTyped(value, locale);
        const label = left || prevText;
        if (label) occ.push({ kind: 'text', value, raw: value, label, other, ...base });
        else {
          if (above) occ.push({ kind: 'text', value, raw: value, label: above, other, ...base });
          if (!above || !aboveSure)
            occ.push({ kind: 'text', value, raw: value, label: '', other, ...base });
        }
      }
      const t = typed(right, locale);
      if (!t.some((v) => v.kind !== 'id') && !hasColon && /\p{L}/u.test(cell))
        prevText = cleanLabel(cell);
      // 「用途:」「TOTAL :」这样冒号后面空着的格子，值在右边的格子里：它就是右边的标签。
      else if (hasColon) prevText = right.trim() ? '' : left;
    }
  });
  ctx.rowMany = 0;
  return { rows: info.map((r) => ({ text: r.text, relY: r.relY, cells: r.cells })), occ };
}
