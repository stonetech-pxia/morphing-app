import { normalizeNumber } from '../text-rules';
import { ctx, receiptRules } from './doc-context';
import type { ConceptId } from './concepts';
import type { Occurrence } from './rows';
import * as D from './rules-data';
import { isExcludedLabel, labelScore, norm } from './similarity';

// 票据预填规则的逻辑（词表在 rules-data.ts，D-403）。这些规则只改候选的打分和排序，不写数据，不联网；
// 不用后行断言，也不用 Hermes 没有的 Intl（PluralRules、ListFormat、RelativeTimeFormat）。

// ======== 发票还是小票 ========
// 发票上才常见的词（bill to、due date、facture…）出现两个以上就当发票：发票的店名在「开票方」后面，不在最上面几排。
let invFor = '';
let invVal = false;
export function isInvoiceText(text: string): boolean {
  if (invFor === text) return invVal;
  invFor = text;
  const t = text.toLowerCase();
  invVal = D.INVOICE_TERMS.filter((re) => re.test(t)).length >= D.INVOICE_MIN_TERMS;
  return invVal;
}

// ======== 日月顺序 ========
let evidenceFor = '';
let evidence: { DMY: Set<string>; MDY: Set<string> } = { DMY: new Set(), MDY: new Set() };
function docEvidence() {
  if (evidenceFor === ctx.text) return evidence;
  evidenceFor = ctx.text;
  evidence = { DMY: new Set(), MDY: new Set() };
  for (const m of ctx.text.matchAll(/(^|\D)(\d{1,2})([/.-])(\d{1,2})\3(\d{4}|\d{2})(?!\d)/g)) {
    const a = Number(m[2]);
    const b = Number(m[4]);
    if (a > 12 && b <= 12) evidence.DMY.add(m[3]!);
    else if (b > 12 && a <= 12) evidence.MDY.add(m[3]!);
  }
  return evidence;
}
/**
 * 年在后、两个数都 ≤ 12 的日期谁排前；null = 保持原来（按界面语言）。
 * 先看这份文字自己的证据（别处有「25/12/2024」就知道日在前），再看币种、货币符号、增值税字样这些线索。
 */
export function orderPref(sep: string, _locale: string): 'DMY' | 'MDY' | null {
  if (!receiptRules()) return null;
  const ev = docEvidence();
  const d = ev.DMY.has(sep);
  const m = ev.MDY.has(sep);
  if (d && !m) return 'DMY';
  if (m && !d) return 'MDY';
  if (D.DMY_TABLE_CURRENCY.includes(ctx.currency)) return 'DMY';
  if (D.DMY_TEXT_CURRENCY.test(ctx.text)) return 'DMY';
  if (D.VAT_WORD.test(ctx.text) && !ctx.text.includes('$')) return 'DMY';
  if (D.GST_WORD.test(ctx.text) && !D.CANADA_TAX_WORD.test(ctx.text)) return 'DMY';
  if (sep === '-' || sep === '.') return 'DMY';
  if (D.MDY_IF_US_MARKER_CURRENCY.includes(ctx.currency) && D.US_MARKER.test(ctx.text))
    return 'MDY';
  if (D.DMY_FIRST_CURRENCY.includes(ctx.currency)) return 'DMY';
  return null;
}

// ======== 词表调整：合计、税额、店名 ========
export function adjustTerms(
  concept: ConceptId | null,
  keywords: readonly string[],
  exclude: readonly string[],
): { kw: readonly string[]; ex: readonly string[] } {
  if (!receiptRules()) return { kw: keywords, ex: exclude };
  // 发票上收票方（bill to、client…）不是店名。
  if (concept === 'merchant' && ctx.invoice)
    return {
      kw: keywords,
      ex: exclude.concat(D.BUYER_EXCLUDE),
    };
  if (concept !== 'amount' && concept !== 'tax') return { kw: keywords, ex: exclude };
  let kw = [...keywords];
  let ex = [...exclude];
  if (concept === 'amount') {
    kw = kw.concat(D.EXTRA_AMOUNT_KEYWORDS);
    ex = ex.concat(D.EXTRA_AMOUNT_EXCLUDE, D.AMOUNT_EXCLUDE_QTY_TAX);
  } else {
    kw = kw.concat(D.EXTRA_TAX_KEYWORDS);
  }
  return { kw, ex };
}

// ---- 西方语言的合计、税额词：整词（整句）匹配，不用字符相似度（相似度会让 mwst、imposta 这类词误中英文标签）----
const wordsOf = (s: string): string =>
  ' ' +
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim() +
  ' ';
const phrases = (a: readonly string[]) => a.map(wordsOf);
const W_AMT_KW = phrases(D.WEST_AMOUNT_KEYWORDS);
const W_AMT_EX = phrases(D.WEST_AMOUNT_EXCLUDE);
const W_TAX_KW = phrases(D.WEST_TAX_KEYWORDS);
const W_TAX_EX = phrases(D.WEST_TAX_EXCLUDE);
const wHit = (label: string, list: readonly string[]) => {
  const w = wordsOf(label);
  return list.some((p) => w.includes(p));
};

const X03 = phrases(D.NOT_ISSUE_DATE_LABEL);
const EXACT = new Set(D.AMOUNT_EXCLUDE_EXACT.map(norm));
function compactTax(label: string): boolean {
  let c = label.toLowerCase().replace(/[^a-z]/g, '');
  if (c === 'va' && label.includes('%')) return true;
  for (const p of D.COMPACT_TAX_PREFIX) if (c.startsWith(p)) c = c.slice(p.length);
  return D.COMPACT_TAX.has(c) || (c === 'va' && label.includes('%'));
}
const TOTAL_ONLY = (e: string) => e === 'total' || e === '合计';

export function labelScoreX(
  concept: ConceptId | null,
  label: string,
  kw: readonly string[],
  ex: readonly string[],
): number {
  if (!receiptRules()) return labelScore(label, kw, ex);
  if (!label) return 0;
  // 开始、结束、期间、送达这类日期的标签不当开票日的标签（整词，标签分归零，值还在候选里）。
  if (concept === 'issueDate' && wHit(label, X03)) return 0;
  if (concept === 'amount') {
    if (wHit(label, W_AMT_EX)) return 0;
    if (wHit(label, W_AMT_KW)) return Math.max(0.9, labelScore(label, kw, ex));
  } else if (concept === 'tax') {
    if (wHit(label, W_TAX_EX)) return 0;
    if (wHit(label, W_TAX_KW)) return Math.max(0.9, labelScore(label, kw, ex));
  }
  if (concept === 'amount') {
    // 「含税合计」不是税前合计。
    if (D.TOTAL_WORD.test(label) && D.TAX_INCLUDED.test(label)) return 1;
    const n = norm(label);
    if (EXACT.has(n)) return 0;
    if (n.includes('合計')) ex = ex.filter((e) => e !== '小計');
  } else if (concept === 'tax') {
    if (compactTax(label)) return 1;
    if (D.TAX_LABEL_WORD.test(label)) ex = ex.filter((e) => !TOTAL_ONLY(e));
  }
  return labelScore(label, kw, ex);
}

export function isExcludedX(
  concept: ConceptId | null,
  label: string,
  ex: readonly string[],
): boolean {
  if (!receiptRules()) return isExcludedLabel(label, ex);
  if (!label) return false;
  if (concept === 'amount' && wHit(label, W_AMT_EX)) return true;
  if (concept === 'tax' && wHit(label, W_TAX_EX)) return true;
  if (concept === 'amount') {
    if (D.TOTAL_WORD.test(label) && D.TAX_INCLUDED.test(label)) return false;
    const n = norm(label);
    if (EXACT.has(n)) return true;
    if (n.includes('合計')) ex = ex.filter((e) => e !== '小計');
  } else if (concept === 'tax') {
    if (compactTax(label)) return false;
    if (D.TAX_LABEL_WORD.test(label)) ex = ex.filter((e) => !TOTAL_ONLY(e));
  }
  return isExcludedLabel(label, ex);
}

// ======== 数字切分：标签后面的整数、一位小数，和「A + B = C」一排三个数 ========
interface Tok {
  start: number;
  end: number;
  raw: string;
  /** 数字本身（不含货币符号、空格）。 */
  num: string;
}
const TOKEN = /[$€£¥￥*]?\s?\d[\d.,]*/g;
function tokensOf(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0].replace(/[.,]+$/, '');
    const start = m.index;
    const end = start + raw.length;
    const before = text[start - 1] ?? '';
    const after = text[end] ?? '';
    if (/[\p{L}\d]/u.test(before) && !/[$€£¥￥*]/.test(raw[0] ?? '')) continue;
    if (/\p{L}/u.test(after)) continue;
    out.push({ start, end, raw, num: raw.replace(/^[$€£¥￥*]\s?/, '') });
  }
  return out;
}
const cleanLab = (s: string) =>
  s.replace(/^[\s|·•*=\-–—#:：$€£¥￥]+|[\s:：\-–—|·•*=#.$€£¥￥]+$/g, '').trim();
const BAD_AFTER =
  /^\s*(?:%|kg|g\b|ml|l\b|x\b|×|件|个|份|张|pcs|km|h\b|min|:\d|点|個|items?\b|qty\b)/i;
const TWO_DEC = /\d[.,]\d{2}(?!\d)/;

interface PageLike {
  rows: { text: string; relY: number }[];
}
type Scorer = (label: string) => number;

function mk(
  kind: 'money',
  value: string,
  raw: string,
  label: string,
  page: number,
  row: number,
  relY: number,
): Occurrence {
  return { kind, value, raw, label, page, row, relY };
}

/**
 * 标签后面紧跟的整数、一位小数（「Total 20」「合计 1234」）。要求标签分 > 0.6，
 * 并且标签不是编号（no、id、card、#）、数字不超过 7 位，免得把单号、电话当金额。
 */
export function extraWholeNumbers(
  pages: PageLike[],
  score: Scorer,
  isEx: (l: string) => boolean,
): Occurrence[] {
  const out: Occurrence[] = [];
  const all3 = ctx.text.match(/\d[.,]\d{3}(?!\d)/g)?.length ?? 0;
  pages.forEach((pg, pi) =>
    pg.rows.forEach((r, ri) => {
      if (TWO_DEC.test(r.text)) return;
      const toks = tokensOf(r.text);
      toks.forEach((t, i) => {
        const label = cleanLab(r.text.slice(i === 0 ? 0 : toks[i - 1]!.end, t.start));
        if (!label || isEx(label) || score(label) <= 0.6) return;
        if (BAD_AFTER.test(r.text.slice(t.end))) return;
        // 编号：标签以 no / id / card / # 结尾，或数字太长。
        if (
          /(?:\b(?:no|number|id|card|reg|tel|phone|tin)\.?|[#№])$/i.test(label) ||
          t.num.replace(/\D/g, '').length > 7
        )
          return;
        let v: number | null = null;
        const n = t.num;
        if (/^\d{1,9}$/.test(n)) v = Number(n);
        else if (/^\d{1,9}[.,]\d$/.test(n)) v = Number(n.replace(',', '.'));
        else if (/^\d{1,6}[.,]\d{2}0$/.test(n) && all3 >= 2) v = Number(n.replace(',', '.'));
        if (v === null || !Number.isFinite(v)) return;
        out.push(mk('money', String(v), t.raw, label, pi, ri, r.relY));
      });
    }),
  );
  return out;
}

const RATE = [
  /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g,
  /\bvat\s*@?\s*(\d{1,2}(?:[.,]\d{1,2})?)/gi,
  /@\s*(\d{1,2}(?:[.,]\d{1,2})?)/g,
  /(\d{1,2})\s*vat/gi,
];
function ratesOf(text: string): number[] {
  const out: number[] = [];
  for (const re of RATE)
    for (const m of text.matchAll(re)) out.push(Number(m[1]!.replace(',', '.')));
  return out.filter((p) => p > 0 && p < 100);
}
const closeTo = (x: number, y: number) => Math.abs(x - y) <= 0.011 + 0.004 * Math.abs(x);

/** 一排「标签 + 三个数」，其中 A + B = C：C 当合计候选，B 当税额候选（有税率时要对得上）。 */
export function extraSumRow(
  concept: ConceptId | null,
  pages: PageLike[],
  score: Scorer,
  isEx: (l: string) => boolean,
): Occurrence[] {
  const out: Occurrence[] = [];
  pages.forEach((pg, pi) =>
    pg.rows.forEach((r, ri) => {
      const toks = tokensOf(r.text).filter((t) =>
        /^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^\d+[.,]\d{2}$/.test(t.num),
      );
      if (toks.length < 3) return;
      const v = toks.map((t) => Number(normalizeNumber(t.num)));
      const k = v.length - 1;
      let hit: [number, number] | null = null;
      for (let i = 0; i < k && !hit; i++)
        for (let j = i + 1; j < k; j++)
          if (Math.abs(v[i]! + v[j]! - v[k]!) <= 0.011) {
            hit = [i, j];
            break;
          }
      if (!hit) return;
      const rowLabel = cleanLab(r.text.slice(0, toks[0]!.start));
      if (concept === 'amount') {
        if (!rowLabel || isEx(rowLabel) || score(rowLabel) <= 0) return;
        out.push(
          mk('money', normalizeNumber(toks[k]!.num), toks[k]!.raw, rowLabel, pi, ri, r.relY),
        );
      } else if (concept === 'tax') {
        const [i, j] = hit;
        const rates = ratesOf(r.text);
        if (rates.length && !rates.some((p) => closeTo(v[j]!, (v[i]! * p) / 100))) return;
        const lab = rowLabel && !isEx(rowLabel) && score(rowLabel) > 0 ? rowLabel : null;
        const totalish = !rowLabel || /total|合计|合計|sub|%|vat|tax|gst/i.test(rowLabel);
        if (!lab && !totalish) return;
        out.push(
          mk('money', normalizeNumber(toks[j]!.num), toks[j]!.raw, lab ?? 'tax', pi, ri, r.relY),
        );
      }
    }),
  );
  return out;
}

/** 文档里所有金额（税率核对、加法核对用）。 */
export const amountSet = (occ: Occurrence[]) =>
  [...new Set(occ.filter((o) => o.kind === 'money').map((o) => Number(o.value)))].filter(
    (x) => x > 0,
  );

interface C {
  value: string;
  occ: Occurrence[];
  score: number;
  base: number;
}

/** 税率核对：税额候选 ≈ 某个金额 × 票上写的税率（含税价按 p/(100+p)），加 2 分。 */
export function taxRateCheck(
  cands: C[],
  rowText: (o: Occurrence) => string,
  amounts: number[],
): void {
  for (const c of cands) {
    const x = Number(c.value);
    const rates = new Set<number>();
    for (const o of c.occ) {
      for (const p of ratesOf(rowText(o))) rates.add(p);
      for (const p of ratesOf(o.label)) rates.add(p);
    }
    let ok = false;
    for (const p of rates) {
      for (const y of amounts)
        if (y !== x && (closeTo(x, (y * p) / 100) || closeTo(x, (y * p) / (100 + p)))) ok = true;
    }
    if (ok) {
      c.score += 2;
      c.base += 2;
    }
  }
}

/** 金额不多（不超过 12 个）才用「税额 + 某数 = 全文最大金额」给门槛加分，金额一多巧合太多。 */
const TAX_ADD_MAX_AMOUNTS = 12;

/** 税额候选的加法关系：加得上别的金额的加 1 分，本身等于一个更小的候选加某个金额的（更像合计）减 1 分。 */
export function taxAddCheck(cands: C[], amounts: number[]): void {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;
  const good = new Map<C, boolean>();
  const maxAll = Math.max(0, ...amounts);
  const goodBase = new Map<C, boolean>();
  for (const c of cands) {
    const t = Number(c.value);
    good.set(
      c,
      amounts.some((a) => a !== t && amounts.some((b) => b !== t && b !== a && near(a + t, b))),
    );
    goodBase.set(
      c,
      amounts.length <= TAX_ADD_MAX_AMOUNTS &&
        amounts.some(
          (a) =>
            a !== t && amounts.some((b) => b !== t && b !== a && near(a + t, b) && near(b, maxAll)),
        ),
    );
  }
  for (const c of cands) {
    const t = Number(c.value);
    if (good.get(c)) {
      c.score += 1;
      // 加法关系成立（且金额不多、和是全文最大）的税额候选，门槛也按加了这一分的算。
      if (goodBase.get(c)) c.base += 1;
    }
    const smaller = cands.filter((o) => o !== c && Number(o.value) < t);
    if (smaller.some((s) => amounts.some((a) => a !== t && near(a + Number(s.value), t))))
      c.score -= 1;
  }
}

/** 同分的金额候选重排：能由别的两个候选相加得到的排前面，再按大的、靠下的。cands 已按分排好；返回新次序。 */
export function reorderTiedAmounts<T extends C>(cands: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < cands.length) {
    let j = i + 1;
    while (j < cands.length && Math.abs(cands[j]!.score - cands[i]!.score) < 0.05) j++;
    const group = cands.slice(i, j);
    if (group.length > 1) {
      const lower = cands.slice(i);
      const sumOf = (c: T) => {
        const x = Number(c.value);
        const others = lower.filter((o) => o !== c).map((o) => Number(o.value));
        for (let a = 0; a < others.length; a++)
          for (let b = a + 1; b < others.length; b++)
            if (Math.abs(others[a]! + others[b]! - x) <= 0.011) return true;
        return false;
      };
      const rowOf = (c: T) => Math.max(...c.occ.map((o) => o.page * 10000 + o.row));
      group.sort((a, b) => {
        const sa = sumOf(a) ? 1 : 0;
        const sb = sumOf(b) ? 1 : 0;
        if (sa !== sb) return sb - sa;
        const va = Number(a.value);
        const vb = Number(b.value);
        if (va !== vb) return vb - va;
        return rowOf(b) - rowOf(a);
      });
    }
    out.push(...group);
    i = j;
  }
  return out;
}

// ======== 空格千位分隔的数（3 620,84）的加法核对（全文）========
let addsFor = '';
let addsVals: number[] = [];
/** x = a + b 或 x + a = b，a、b 是全文里别的金额（空格千位也算）。 */
export function docAdds(x: number): boolean {
  if (addsFor !== ctx.text) {
    addsFor = ctx.text;
    addsVals = [
      ...new Set(
        [...ctx.text.matchAll(/\d{1,3}(?: \d{3})*[.,]\d{2}(?!\d)/g)].map((m) =>
          Number(normalizeNumber(m[0].replace(/ /g, ''))),
        ),
      ),
    ]
      .filter((v) => v > 0)
      .slice(0, 150);
  }
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;
  const v = addsVals.filter((y) => !near(y, x));
  for (const a of v)
    for (const b of v) {
      if (a === b) continue;
      if (near(a + b, x) || near(x + a, b)) return true;
    }
  return false;
}

// ======== 发票上开票方的标签：整词短标签，按权重给分（不用字符相似度）========
const SELLER_LABELS = D.SELLER_KEYWORDS.map(wordsOf);
export function sellerLabelScore(label: string): number {
  const w = wordsOf(label);
  const words = w.trim().split(' ');
  if (words.length > 5) return 0;
  for (const p of SELLER_LABELS) {
    const at = w.indexOf(p);
    if (at < 0) continue;
    const before = w.slice(0, at).trim();
    if (before === '' || before.split(' ').every((x) => D.SELLER_PREFIX.includes(x)))
      return D.SELLER_WEIGHT;
  }
  return 0;
}
