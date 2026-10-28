import type { Locale } from '../schema';
import { normalizeNumber, validDate } from '../text-rules';

// 「记一笔」预填的候选（D-244 的扩展）：识别出的文字里哪一段像金额、哪一段像日期。规则为主，
// 系统识别（iOS DataDetection / NSDataDetector，Android ML Kit 实体识别）只做辅助和补充：
// 规则找到的，系统也找到就记一笔「对得上」；规则漏掉、系统找到的才作为补充加进来。
// 候选只说「这里是金额 / 日期」，不说哪个是实付：挑选在 pick.ts 和 memory.ts 里做。
// 文字只在本机处理，不发给 AI。

export type CandidateKind = 'amount' | 'date';
export type CandidateSource = 'rule' | 'system';

export interface ValueCandidate {
  kind: CandidateKind;
  /** 统一后的写法：金额 1234.56，日期 YYYY-MM-DD。 */
  value: string;
  /** 原文里的这一段。 */
  raw: string;
  /** 第几行（从 0 开始，按 \n 分）。 */
  line: number;
  /** 在这一行里的位置（UTF-16，和 JS 字符串一样）。 */
  start: number;
  end: number;
  source: CandidateSource;
  /** 规则的候选，系统识别在同一个位置也认出了同样的值。 */
  confirmed?: boolean;
  /** 数字里有识别错的字母（1O7.45、2026年S月），按常见的混淆改回数字才认出来。 */
  repaired?: boolean;
}

/** 系统识别的结果：在整段文字里的位置（UTF-16）和系统给的值；位置换成行由 systemCandidates 做。 */
export interface SystemMatch {
  kind: CandidateKind;
  start: number;
  end: number;
  /** 系统给的值：日期 YYYY-MM-DD；金额可以没有（ML Kit 的小数部分不可靠），这时按原文统一。 */
  value?: string;
}

export const splitLines = (text: string): string[] => text.split('\n');

// ---- 日期 ----

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  janvier: 1,
  janv: 1,
  feb: 2,
  february: 2,
  février: 2,
  fevrier: 2,
  févr: 2,
  fev: 2,
  mar: 3,
  march: 3,
  mars: 3,
  apr: 4,
  april: 4,
  avril: 4,
  avr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  june: 6,
  juin: 6,
  jul: 7,
  july: 7,
  juillet: 7,
  juil: 7,
  aug: 8,
  august: 8,
  août: 8,
  aout: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septembre: 9,
  oct: 10,
  october: 10,
  octobre: 10,
  nov: 11,
  november: 11,
  novembre: 11,
  dec: 12,
  december: 12,
  décembre: 12,
  decembre: 12,
  déc: 12,
};
const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const YMD = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g;
// 年在后：两位或四位的年（05/03/26、05/03/2026）。前面不能是数字，后面不能还是数字。
const DMY = /(^|[^\d])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g;
// 12 mars 2026、1er avril 2026、5 March 2026
const D_MONTH_Y = new RegExp(
  `(^|[^\\w])(\\d{1,2})(?:er)?\\s+(${MONTH_NAMES})\\.?\\s+(\\d{4})(?!\\d)`,
  'gi',
);
// March 5, 2026、Mar 5 2026
const MONTH_D_Y = new RegExp(
  `(^|[^\\w])(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`,
  'gi',
);

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** 一行里的日期。年在后、日月分不清时英文按月在前，其他语言按日在前（和 text-rules 一样）。 */
function datesInLine(
  line: string,
  locale: Locale,
): { start: number; end: number; value: string }[] {
  const found: { start: number; end: number; value: string }[] = [];
  const add = (start: number, raw: string, value: string | null) => {
    if (!value) return;
    const end = start + raw.length;
    if (found.some((f) => start < f.end && end > f.start)) return;
    found.push({ start, end, value });
  };
  for (const m of line.matchAll(YMD)) {
    add(m.index, m[0].trimEnd(), validDate(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  for (const m of line.matchAll(D_MONTH_Y)) {
    const month = MONTHS[m[3]!.toLowerCase()];
    const raw = m[0].slice(m[1]!.length);
    add(m.index + m[1]!.length, raw, month ? validDate(Number(m[4]), month, Number(m[2])) : null);
  }
  for (const m of line.matchAll(MONTH_D_Y)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    const raw = m[0].slice(m[1]!.length);
    add(m.index + m[1]!.length, raw, month ? validDate(Number(m[4]), month, Number(m[3])) : null);
  }
  for (const m of line.matchAll(DMY)) {
    const a = Number(m[2]);
    const b = Number(m[3]);
    const y = fullYear(m[4]!);
    const monthFirst = a > 12 ? false : b > 12 ? true : locale === 'en';
    const raw = m[0].slice(m[1]!.length);
    add(m.index + m[1]!.length, raw, monthFirst ? validDate(y, a, b) : validDate(y, b, a));
  }
  return found.sort((x, y) => x.start - y.start);
}

// ---- 金额 ----

const CURRENCY_BEFORE = /(?:[$€£¥￥]|rmb|cny|eur|usd|gbp|us\$)\s*$/i;
const CURRENCY_AFTER = /^\s*(?:[€$£¥￥元]|eur|euros?|rmb|cny|usd|gbp)/i;
// 数字（千位分隔可以是逗号、点、空格），后面可以有一位或两位小数。
const NUMBER = /-?\d{1,3}(?:[,.   ]\d{3})+(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g;
// 数量、重量、百分比、时间后面跟的东西：不是金额。
const NOT_MONEY_AFTER = /^\s*(?:%|kg|g\b|ml|l\b|x\b|×|件|个|份|张|pcs|km|h\b|min|:\d)/i;

/** 一行里像金额的数：有两位小数，或者紧挨着货币符号。日期、时间、百分比、数量不算。 */
function amountsInLine(
  line: string,
  dates: readonly { start: number; end: number }[],
  locale: Locale,
): { start: number; end: number; raw: string; value: string }[] {
  const out: { start: number; end: number; raw: string; value: string }[] = [];
  for (const m of line.matchAll(NUMBER)) {
    let raw = m[0];
    let start = m.index;
    // 千位分隔用空格时，正则可能把前面的数量也连进来（「2 120,00」）：只有前面紧挨货币符号或标签时才信。
    const end = start + raw.length;
    if (dates.some((d) => start < d.end && end > d.start)) continue;
    const before = line.slice(0, start);
    const after = line.slice(end);
    if (/[\d.,]$/.test(before) || /^[\d]/.test(after)) continue;
    if (NOT_MONEY_AFTER.test(after)) continue;
    // 前面紧挨着字母或横线的是单号的一部分（INV-2026-0042、A12）。
    if (/[A-Za-z\-/#]$/.test(before) && !CURRENCY_BEFORE.test(before)) continue;
    const decimals = /[.,]\d{2}$/.test(raw);
    const currency = CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after);
    if (!decimals && !currency) continue;
    // 英文、法文的四位以上整数金额会写千位分隔（1,234 / 1 234）：连着写又没有小数的（5256 €），
    // 多半是小数点没认出来，不当金额。中文常常不写千位分隔，不受这条限制。
    if (locale !== 'zh' && !decimals && /^-?\d{4,}$/.test(raw)) continue;
    if (raw.startsWith('-')) {
      // 「-2.00」是负数（优惠）；保留负号，挑选时会排除。
    } else if (/\s/.test(raw) && !currency) {
      // 空格分隔又没有货币符号时，只取最后一段（「2 x 3 12,50」里的 12,50）。
      const last = raw.split(/\s/).pop()!;
      start = end - last.length;
      raw = last;
      if (!/[.,]\d{2}$/.test(raw)) continue;
    }
    out.push({ start, end, raw, value: normalizeNumber(raw) });
  }
  return out;
}

// 文字识别常把数字认成长得像的字母。只在「像金额或日期」的一段里改，一个字换一个字，位置不变。
const LOOKALIKE: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  S: '5',
  s: '5',
  l: '1',
  I: '1',
  '|': '1',
  B: '8',
  Z: '2',
};
const NUMERIC_RUN = /[0-9OoDSslI|BZ][0-9OoDSslI|BZ.,/\-年月]*[0-9OoDSslI|BZ]/g;
const MONEY_SHAPE = /^\d{1,3}(?:[,.]\d{3})*[.,]\d{2}$|^\d+[.,]\d{2}$/;
const DATE_SHAPE =
  /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})$|^\d{4}年\d{1,2}月\d{1,2}$/;

/** 改回数字后的这一行，和改过的位置；改完不像金额或日期的不改。 */
export function repairDigits(line: string): { text: string; changed: boolean[] } {
  const chars = [...line];
  const changed = line.split('').map(() => false);
  for (const m of line.matchAll(NUMERIC_RUN)) {
    const run = m[0];
    const digits = run.replace(/[^\d]/g, '').length;
    if (digits < 2 || !/[OoDSslI|BZ]/.test(run)) continue;
    // 前后紧挨着字母的是单词或单号（SOS、B12、Total），不改。
    const before = line[m.index - 1] ?? '';
    const after = line[m.index + run.length] ?? '';
    if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) continue;
    const fixed = run.replace(/[OoDSslI|BZ]/g, (ch) => LOOKALIKE[ch]!);
    if (!MONEY_SHAPE.test(fixed) && !DATE_SHAPE.test(fixed)) continue;
    for (let i = 0; i < run.length; i++) {
      if (fixed[i] !== run[i]) {
        chars[m.index + i] = fixed[i]!;
        changed[m.index + i] = true;
      }
    }
  }
  return { text: chars.join(''), changed };
}

/** 规则找出的全部金额和日期候选，按行、按位置排好。raw 是原文（没改过的）。 */
export function ruleCandidates(text: string, locale: Locale): ValueCandidate[] {
  const out: ValueCandidate[] = [];
  splitLines(text).forEach((original, index) => {
    const { text: line, changed } = repairDigits(original);
    const repaired = (start: number, end: number) => changed.slice(start, end).some(Boolean);
    const dates = datesInLine(line, locale);
    for (const d of dates)
      out.push({
        kind: 'date',
        value: d.value,
        raw: original.slice(d.start, d.end),
        line: index,
        start: d.start,
        end: d.end,
        source: 'rule',
        ...(repaired(d.start, d.end) ? { repaired: true } : {}),
      });
    for (const a of amountsInLine(line, dates, locale))
      out.push({
        kind: 'amount',
        value: a.value,
        raw: original.slice(a.start, a.end),
        line: index,
        start: a.start,
        end: a.end,
        source: 'rule',
        ...(repaired(a.start, a.end) ? { repaired: true } : {}),
      });
  });
  return out;
}

export const sameValue = (kind: CandidateKind, a: string, b: string) =>
  kind === 'amount' ? Math.abs(Number(a) - Number(b)) < 0.005 : a === b;

/** 系统识别的结果（整段文字里的位置）换成候选；一段跨了行的不要。 */
export function systemCandidates(text: string, matches: readonly SystemMatch[]): ValueCandidate[] {
  const lines = splitLines(text);
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const out: ValueCandidate[] = [];
  for (const m of matches) {
    let index = starts.length - 1;
    while (index > 0 && starts[index]! > m.start) index--;
    const line = lines[index]!;
    const start = m.start - starts[index]!;
    const end = m.end - starts[index]!;
    if (start < 0 || end > line.length || end <= start) continue;
    const raw = line.slice(start, end);
    let value = m.value;
    if (m.kind === 'amount' && value === undefined) {
      const number = /-?\d[\d,.   ]*\d|\d/.exec(raw);
      if (!number) continue;
      value = normalizeNumber(number[0]);
    }
    if (value === undefined || (m.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))) continue;
    out.push({ kind: m.kind, value, raw, line: index, start, end, source: 'system' });
  }
  return out;
}

/**
 * 规则为主、系统为辅：规则的候选都留下；系统在同一位置认出同样的值时，规则的候选记 confirmed；
 * 系统在规则没有候选的地方认出来的，作为补充加进来；同一位置值不一样时听规则的。
 */
export function mergeCandidates(
  rules: readonly ValueCandidate[],
  system: readonly ValueCandidate[],
): ValueCandidate[] {
  const out = rules.map((c) => ({ ...c }));
  for (const s of system) {
    const overlap = out.filter(
      (r) => r.kind === s.kind && r.line === s.line && s.start < r.end && s.end > r.start,
    );
    if (overlap.length === 0) {
      out.push({ ...s });
      continue;
    }
    for (const r of overlap)
      if (r.source === 'rule' && sameValue(r.kind, r.value, s.value)) r.confirmed = true;
  }
  return out.sort((a, b) => a.line - b.line || a.start - b.start);
}
