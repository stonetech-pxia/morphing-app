import type { Locale } from './schema';

// 从一段文字里取出固定几种内容（D-244）：命名模板的 {ocr:规则} / {qr:规则} 和「提取文字」动作共用。
// 规则只能从这里选，不接受用户或 AI 写的正则；文字只在本机处理，AI 只能看到规则的名字。
// 不用后行断言（Hermes 的老版本不支持），前面的边界用捕获组处理。

export const TEXT_RULES = [
  'firstLine',
  'invoiceNo',
  'date',
  'amount',
  'phone',
  'email',
  'url',
  'number',
] as const;
export type TextRule = (typeof TEXT_RULES)[number];

/** 「提取」能取出全部的几种（第一行、发票号、金额只有一个，不在这里）。 */
export const EXTRACT_KINDS = ['phone', 'email', 'url', 'number', 'date'] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d);
  if (y < 1900 || y > 2200) return null;
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? `${y}-${pad(m)}-${pad(d)}`
    : null;
}

const YMD = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g;
const DMY = /(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/g;

/**
 * 文字里的日期，统一成 YYYY-MM-DD。年在前的（2026-10-22、2026/10/22、2026年10月22日）直接读；
 * 年在后的（22/10/2026、10/22/2026）看哪一位大于 12，分不出来时英文按月在前、其他语言按日在前。
 */
function dates(text: string, locale: Locale): { at: number; value: string }[] {
  const found: { at: number; value: string }[] = [];
  for (const m of text.matchAll(YMD)) {
    const v = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v) found.push({ at: m.index, value: v });
  }
  for (const m of text.matchAll(DMY)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const monthFirst = a > 12 ? false : b > 12 ? true : locale === 'en';
    const v = monthFirst ? validDate(y, a, b) : validDate(y, b, a);
    if (v) found.push({ at: m.index, value: v });
  }
  return found.sort((x, y) => x.at - y.at);
}

// 手机号：国际格式（+ 开头）、中国手机号、常见的分段写法（01 23 45 67 89、(415) 555-0100）。
const PHONE_INTL = /\+\d[\d\s\-().]{6,18}\d/g;
const PHONE_CN = /(?:^|[^\d])(1[3-9]\d{9})(?!\d)/g;
// 本地写法要有分隔（空格、点、横线）或括号：一串连着的数字多半是单号、发票号，不当电话。前面是字母、横线时也不算（INV-2026-0042）。
const PHONE_LOCAL = /(?:^|[^\w+\-/.])(\(?\d{2,4}\)?(?:[\s.-]\d{2,4}){1,4})(?![\d])/g;

const digitsOnly = (s: string) => s.replace(/[^\d+]/g, '');

function phones(text: string): { at: number; value: string }[] {
  const found: { at: number; value: string }[] = [];
  const taken: [number, number][] = [];
  const add = (at: number, raw: string) => {
    const value = digitsOnly(raw);
    const digits = value.replace('+', '').length;
    if (digits < 8 || digits > 15) return;
    if (taken.some(([s, e]) => at < e && at + raw.length > s)) return;
    taken.push([at, at + raw.length]);
    found.push({ at, value });
  };
  for (const m of text.matchAll(PHONE_INTL)) add(m.index, m[0]);
  for (const m of text.matchAll(PHONE_CN)) add(m.index + m[0].indexOf(m[1]!), m[1]!);
  for (const m of text.matchAll(PHONE_LOCAL)) {
    // 日期（2026-10-22）不是电话。
    const raw = m[1]!;
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(raw)) continue;
    add(m.index + m[0].indexOf(raw), raw);
  }
  return found.sort((x, y) => x.at - y.at);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'，。、]+/gi;
const NUMBER = /-?\d{1,3}(?:[,\u00a0\u202f ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;

function all(pattern: RegExp, text: string, clean = (s: string) => s) {
  return [...text.matchAll(pattern)].map((m) => ({ at: m.index, value: clean(m[0]) }));
}

const trimUrl = (s: string) => s.replace(/[.,;:!?)\]}>]+$/, '');

/**
 * 数字统一成 1234.56：逗号和点都有时后出现的是小数点；只有一种分隔符时，出现不止一次或后面正好 3 位数
 * 是千位分隔（1,234、1.234.567），否则是小数点（12,5、3.50）。
 */
function normalizeNumber(raw: string): string {
  const s = raw.replace(/[\u00a0\u202f ]/g, '');
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    return s.split(group).join('').replace(decimal, '.');
  }
  const sep = comma >= 0 ? ',' : dot >= 0 ? '.' : null;
  if (!sep) return s;
  const parts = s.split(sep);
  if (parts.length > 2 || parts[1]!.length === 3) return parts.join('');
  return parts.join('.');
}

const INVOICE =
  /(?:invoice|inv|receipt|bill|order|facture|commande|reçu|n°|no\.|№|发票号码|发票代码|发票号|单据号|订单号|单号|编号|票号)\s*(?:number|no\.?|n°|#|num(?:éro)?)?\s*[:：#.]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{3,29})/i;
const TOTAL =
  /(?:\btotal\b|\bamount due\b|\bbalance\b|\bmontant\b|net à payer|合计|总计|总额|价税合计|实付|应付|金额)[^\d\n-]{0,12}(-?\d[\d\s,.\u00a0\u202f]*\d|\d)/i;

const firstLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
    ?.slice(0, 40) ?? null;

/** 按规则取第一个；没有时返回 null。 */
export function extractFirst(text: string, rule: TextRule, locale: Locale): string | null {
  switch (rule) {
    case 'firstLine':
      return firstLine(text);
    case 'invoiceNo': {
      const m = INVOICE.exec(text);
      return m && /\d/.test(m[1]!) ? m[1]! : null;
    }
    case 'amount': {
      const m = TOTAL.exec(text);
      if (m) return normalizeNumber(m[1]!.trim());
      // 没有「合计」之类的字：取带两位小数的数里最大的那个。
      const money = extractAll(text, 'number', locale)
        .filter((n) => /\.\d{2}$/.test(n))
        .sort((a, b) => Number(b) - Number(a));
      return money[0] ?? null;
    }
    default:
      return extractAll(text, rule, locale)[0] ?? null;
  }
}

/** 按种类取出全部（按出现顺序，去掉重复）。 */
export function extractAll(text: string, kind: ExtractKind, locale: Locale): string[] {
  const found =
    kind === 'date'
      ? dates(text, locale)
      : kind === 'phone'
        ? phones(text)
        : kind === 'email'
          ? all(EMAIL, text)
          : kind === 'url'
            ? all(URL_PATTERN, text, trimUrl)
            : all(NUMBER, text, normalizeNumber);
  return [...new Set(found.map((f) => f.value))];
}
