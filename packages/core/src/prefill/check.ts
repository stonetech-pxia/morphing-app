import type { Field, Locale } from '../schema';
import { ruleCandidates } from './candidates';
import { conceptOf, fieldTerms, type ConceptId } from './concepts';
import { BAD_DATE_ROW, NOT_NO, stripNoPrefix } from './zh-rules';

// 模型的回答要过的核对（D-396）：值必须真的在识别出的文字里，而且不在明显不对的那一排。
// 过不了的丢掉，所以模型编不出文字里没有的值。这些规则来自 per-field/REPORT.md 的错例分析。

export const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const NO_DECIMALS = new Set(['IDR', 'JPY', 'KRW', 'VND']);
/** 这种币种没有小数（字段的货币）。 */
export const hasNoDecimals = (f: Field) =>
  f.type === 'money' &&
  f.currency !== undefined &&
  f.currencyField === undefined &&
  NO_DECIMALS.has(f.currency);

const LOCALES: readonly Locale[] = ['en', 'fr', 'zh'];
/** 这一排能读出的日期（三种语言的写法都试，日月分不清时两种都算）。 */
function dateReadings(row: string): string[] {
  const out = new Set<string>();
  for (const l of LOCALES)
    for (const c of ruleCandidates(row, l)) if (c.kind === 'date') out.add(c.value);
  for (const v of [...out]) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m && Number(m[3]) <= 12) out.add(`${m[1]}-${m[3]}-${m[2]}`);
  }
  return [...out];
}
/** 这个日期能从这一排读出来吗（规则候选的过滤也用）。 */
export const rowHasDate = (row: string, date: string) => dateReadings(row).includes(date);

const PAY =
  /\b(cash|tender|tendered|change|payment|visa|master|card|credit|debit|rounding adj)\b|找零|现金|实收|收款|monnaie|espèces/i;
const TAX_WORD = /tax|tva|gst|vat|sst|税/i;
const ADDRESS =
  /\b\d{5}\b|\b(jalan|jln|taman|lorong|street|road|rue|avenue|blvd)\b|[路街]\d|\d+号|大道/i;
const TOTAL_WORD = /total|合计|总计|montant|grand|net\s*amt|amount\s*due|payer|ttc|应付|实付/i;
const NOT_TOTAL =
  /sub\s*-?\s*total|小计|优惠|discount|remise|rounding|change|找零|paid\s*amount|tendered/i;
/** 这些字段的值不会在这种标签那一排。 */
const OTHER_LABEL: Partial<Record<ConceptId, RegExp>> = {
  origin: /^(to|arriv[ée]e|到达|终点|destination)\s*[:：]/i,
  destination: /^(from|d[ée]part|出发|地址|address)\s*[:：]/i,
  merchant:
    /^(invoice\s*no|bill\s*no|n°|station|cashier|tel|t[ée]l|电话|地址|address|order|订单)\b.*[:：]/i,
  company: /^(tel|t[ée]l|电话|地址|address|email)\b.*[:：]/i,
  name: /^(tel|t[ée]l|电话|地址|address|email)\b.*[:：]/i,
  number: /^(tel|t[ée]l|phone|电话|地址|address|total|合计|小计|date|日期)\b.*[:：]?/i,
};
/** 代码认得出的误导排：不给模型看（有合计字样的排留着）。 */
const MISLEAD =
  /sub\s*-?\s*total|小计|sous-total|优惠|折扣|discount|remise|promo|thank\s*you|thankyou|merci|谢谢|欢迎|welcome|scan\s*qr|二维码|qr\s*au\s*verso|gst\s*summary|tax\s*code|\b(tel|t[ée]l|phone|fax|mobile)\b|电话|手机|传真|\S+@\S+\.\w+|地址|address|adresse|\bchange\b|找零|monnaie|rendu|\b(cash|tender(ed)?|visa|master(card)?)\b|现金|实收/i;
const BARE_LABELS = new Set([
  'from',
  'to',
  'départ',
  'arrivée',
  'origin',
  'destination',
  'name',
  'company',
  'merchant',
  'total',
  'date',
  'tax',
]);

/**
 * 这一排说的就是这个字段（字段名或它的概念的关键词在这一排上）：用户自建的「优惠金额」「现金」「地址」，
 * 要的正是别的字段的误导排。中文对上名字里连续两个字（优惠金额 → 优惠），英文、法文按整个词。
 */
function isOwnRow(f: Pick<Field, 'id' | 'name'>, row: string): boolean {
  const { concept, keywords } = fieldTerms(f);
  const lower = row.normalize('NFKC').toLowerCase();
  if (concept === 'email' && /\S+@\S+\.\w+/.test(row)) return true;
  return keywords.some((k) => {
    const term = k.normalize('NFKC').toLowerCase().trim();
    for (let i = 0; i + 2 <= term.length; i++) {
      const pair = term.slice(i, i + 2);
      if (/^[㐀-鿿]{2}$/.test(pair) && lower.includes(pair)) return true;
    }
    return term
      .split(/[^\p{L}\p{N}]+/u)
      .some(
        (w) =>
          w.length >= 3 &&
          !/[㐀-鿿]/.test(w) &&
          new RegExp(`(^|[^\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'u').test(lower),
      );
  });
}

/**
 * 这一排给不给模型看。给 field 时按字段：这个字段自己的关键词所在的排不删。总额字段例外：
 * 它的关键词（实收、paid）正好落在误导排上，提示词和测量时一样，不跟着放开。
 */
export const keepForModel = (row: string, field?: Pick<Field, 'id' | 'name'>) =>
  TOTAL_WORD.test(row) ||
  !MISLEAD.test(row) ||
  (field !== undefined && conceptOf(field) !== 'amount' && isOwnRow(field, row));

/** 日期、时间、电话这类连着的数字不是金额。 */
const NOT_AMOUNT_DIGITS =
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[-/:]\d+)+/g;

interface RowNumber {
  value: number;
  /** 写出了小数（100.00）。 */
  cents: boolean;
}

/**
 * 这段文字里的数，按整个数算。分隔符有两种读法时两种都算：32.000 是 32 或 32000，
 * 「2 500.00」是 2500.00 或者两格 2 和 500.00。
 */
function numbersIn(text: string): RowNumber[] {
  const t = text
    .replace(NOT_AMOUNT_DIGITS, ' ')
    // OCR 常在小数点两边多一个空格。
    .replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3');
  const out: RowNumber[] = [];
  for (const m of t.matchAll(/\d+(?:[ .,'’]\d+)*/g)) {
    const raw = m[0];
    const parts = raw.split(/[ .,'’]/);
    const lastSep = /[ .,'’](?=\d+$)/.exec(raw)?.[0];
    const tail = parts.at(-1)!;
    if (parts.length === 1) {
      out.push({ value: Number(raw), cents: false });
      continue;
    }
    // 最后一段不是三位：它是小数（或者空格隔开的另一格）。
    if ((lastSep === '.' || lastSep === ',') && tail.length <= 2) {
      const whole = parts.slice(0, -1);
      out.push({ value: Number(`${whole.join('')}.${tail}`), cents: true });
      // 前面用空格隔开的是另一格（数量）。
      const cells = raw.split(' ');
      if (cells.length > 1) {
        const lastCell = cells.at(-1)!;
        out.push({
          value: Number(lastCell.replace(/[.,'’](?=\d+$)/, '.').replace(/[,'’]/g, '')),
          cents: true,
        });
      }
      continue;
    }
    if (parts.slice(1).every((p) => p.length === 3))
      out.push({ value: Number(parts.join('')), cents: false });
    if ((lastSep === '.' || lastSep === ',') && parts.length === 2)
      out.push({ value: Number(`${parts[0]}.${tail}`), cents: true });
    if (lastSep === ' ') for (const p of parts) out.push({ value: Number(p), cents: false });
  }
  return out;
}

const isTotalRow = (r: string) => TOTAL_WORD.test(r) && !NOT_TOTAL.test(r);

/**
 * 这个数在不在这一排（按整个数比）。没写小数的回答（5）对上写了小数的数（5.00）只在合计排上算，否则一排明细也能对上。
 * 合计排上 OCR 常把分隔符读坏（TOTAL 20 0 0 0、36-000、19-80）：一整段数字连起来等于回答也算。
 */
function rowHasAmount(row: string, n: number, answer: string, strict: boolean): boolean {
  const wroteCents = /[.,]\d{1,2}\s*\D*$/.test(answer);
  const near = (v: number) => Math.abs(v - n) < 0.005;
  if (
    numbersIn(row).some(
      (x) => near(x.value) && (wroteCents || !x.cents || !strict || isTotalRow(row)),
    )
  )
    return true;
  if (!isTotalRow(row)) return false;
  const digits = answer.replace(/\D/g, '');
  return (row.match(/\d(?:[\s.,-]*\d)*/g) ?? []).some((b) => b.replace(/\D/g, '') === digits);
}

function checkAmount(
  f: Field,
  concept: ConceptId | null,
  s: string,
  rows: readonly string[],
  locale: Locale,
): string | null {
  let n: number | null = null;
  if (hasNoDecimals(f) && /\d/.test(s)) n = Number(s.replace(/[.,]00$/, '').replace(/[^\d]/g, ''));
  else if (/^-?\d+(\.\d+)?$/.test(s)) n = Number(s);
  else {
    const a = ruleCandidates(s, locale).find((c) => c.kind === 'amount');
    n = a ? Number(a.value) : null;
  }
  if (n === null || !Number.isFinite(n)) return null;
  const noDecimals = hasNoDecimals(f);
  // 它在哪几排（按整个数比）。
  const inRows = rows.filter((r) => rowHasAmount(r, n, s, !noDecimals));
  if (inRows.length === 0) return null;
  // 用户自建的字段（优惠金额、现金）要的就是这一排，下面这些「不是总额」的判断不算。
  if (inRows.some((r) => concept !== 'amount' && isOwnRow(f, r))) return String(n);
  if (inRows.every((r) => PAY.test(r) && !/total|合计|总|montant/i.test(r))) return null;
  if (concept === 'tax' && !inRows.some((r) => TAX_WORD.test(r))) return null;
  if (concept !== 'tax') {
    if (n === 0) return null;
    // 有合计排时，金额要在合计排。
    if (rows.some((r) => isTotalRow(r) && /\d/.test(r)) && !inRows.some(isTotalRow)) return null;
  }
  return String(n);
}

function checkDate(
  concept: ConceptId | null,
  s: string,
  rows: readonly string[],
  locale: Locale,
): string | null {
  const v = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s
    : (ruleCandidates(s, locale).find((c) => c.kind === 'date')?.value ?? null);
  if (!v) return null;
  if (!rows.some((r) => rowHasDate(r, v))) return null;
  // 有效期那排的日期就是到期日要的，只有单据日期不要它。
  if (concept !== 'dueDate' && !rows.some((r) => !BAD_DATE_ROW.test(r) && rowHasDate(r, v)))
    return null;
  return v;
}

function checkText(
  f: Field,
  concept: ConceptId | null,
  s: string,
  rows: readonly string[],
): string | null {
  const sq = squash(s);
  if (!sq) return null;
  const row = rows.find((r) => squash(r).includes(sq))?.trim();
  if (row === undefined) return null;
  if (concept && OTHER_LABEL[concept]?.test(row)) return null;
  if (concept === 'email' && !s.includes('@')) return null;
  if (concept === 'number') {
    if (NOT_NO.test(row) && !/票据号|发票号/.test(row)) return null;
    // 单号像金额或商品。
    if (/[€$¥£]|\b(article|item)\b/i.test(s) || /^\d{1,3}([., ]\d{3})*[.,]\d{2}$/.test(s))
      return null;
    if (!/\d/.test(s) || ADDRESS.test(s)) return null;
  }
  let value = s;
  // 半截店名补全成整排。
  if (
    (concept === 'merchant' || concept === 'company') &&
    squash(row) !== sq &&
    squash(row).startsWith(sq) &&
    row.split(/\s+/).length <= 4 &&
    !/[:：]/.test(row)
  )
    value = row;
  if (BARE_LABELS.has(value.toLowerCase()) || squash(f.name) === sq) return null;
  if (
    (concept === 'merchant' || concept === 'company' || concept === 'name') &&
    ADDRESS.test(value)
  )
    return null;
  // 带价格的一排是商品明细，不是店名。提前从文字里删掉反而变差（模型的回答会被打乱），所以在这里滤。
  if (
    (concept === 'merchant' || concept === 'company') &&
    /\p{L}.*\d+[.,]\d{2}\s*[A-Za-z]{0,3}\s*$/u.test(value)
  )
    return null;
  return value;
}

/** 模型的一个回答 → 表单的写法；过不了核对是 null。 */
export function checkAnswer(
  f: Field,
  answer: string,
  rows: readonly string[],
  locale: Locale,
): string | null {
  let s = answer.trim();
  if (!s || s === 'null') return null;
  const concept = conceptOf(f);
  if (concept === 'number') s = stripNoPrefix(s);
  // 去掉前面的「标签：」。
  const m = /^([^:：]{1,20})[:：]\s*(.+)$/.exec(s);
  // 12:30、https://… 里的冒号不是标签。
  if (
    m &&
    f.type !== 'date' &&
    !(/\d$/.test(m[1]!) && /^\d/.test(m[2]!)) &&
    !m[2]!.startsWith('//')
  )
    s = m[2]!.trim();
  if (f.type === 'money' || f.type === 'number') return checkAmount(f, concept, s, rows, locale);
  if (f.type === 'date') return checkDate(concept, s, rows, locale);
  return checkText(f, concept, s, rows);
}
