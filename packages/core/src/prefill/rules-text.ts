import * as D from './rules-data';

// 店名规则的逻辑（词表在 rules-data.ts，D-403）：标题行、弱标签、清理前缀、公司后缀、「Powered by」、Seller/Client 表头。不用后行断言。

const ESC = /[.*+?^${}()|[\]\\]/g;
const esc = (s: string) => s.replace(ESC, '\\$&');
const lc = (s: string) => s.normalize('NFKC').toLowerCase();

// ---- 标题行（「收据」「Tax invoice」这类单据名，不是店名）----
const LATIN = [...D.TITLE_WORDS_LATIN].sort((a, b) => b.length - a.length).map((w) => esc(lc(w)));
const TITLE_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(?:${LATIN.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
export function isTitleRow(text: string): boolean {
  let t = lc(text);
  for (const w of D.TITLE_WORDS_CJK) t = t.split(w).join(' ');
  t = t.replace(TITLE_RE, '$1 ');
  const left = (t.match(/\p{L}/gu) ?? []).length;
  const had = left < (lc(text).match(/\p{L}/gu) ?? []).length;
  return had && left < 3;
}

// ---- 「Store」「Branch」开头的弱标签（不是「店名：」）----
export const weakStore = (label: string) =>
  /^(store|branch|outlet|shop)\b/i.test(label.trim()) && !/^store\s*name\b/i.test(label.trim());

// ---- 清理店名：去掉「Welcome to」「Sold by:」这类前缀和首尾符号 ----
export function cleanMerchant(v: string): string {
  let s = v.trim();
  const low = () => s.toLowerCase();
  for (const p of D.MERCHANT_PREFIX)
    if (low().startsWith(p) && s.length > p.length) {
      s = s.slice(p.length);
      break;
    }
  for (const p of D.MERCHANT_LABEL)
    if (low().startsWith(p) && s.length > p.length) {
      s = s.slice(p.length).replace(/^[\s:：]+/, '');
      break;
    }
  s = s.replace(/^\d{3,}\s*[-–]\s*/, '');
  s = s.replace(/^[\s*#=_~"'•·]+|[\s*#=_~"'•·]+$/g, '');
  return s;
}

// ---- 带公司后缀（LLC、GmbH、株式会社…）的行 ----
const SUF_LATIN = new RegExp(
  `(^|[^\\p{L}\\p{N}])(?:${[...D.COMPANY_SUFFIX_LATIN]
    .sort((a, b) => b.length - a.length)
    .map((w) => esc(w))
    .join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
);
export const companyRow = (text: string) =>
  SUF_LATIN.test(text) || D.COMPANY_SUFFIX_CJK.some((w) => text.includes(w));

// ---- 「Powered by」不是店名 ----
export const POWERED = /^[\s\W]*(powered?\s+by|brought\s+to\s+you\s+by)/i;

// ---- 发票表头「Seller: Client:」下面一排的第一格是卖方 ----
interface PageRows {
  rows: { text: string; relY: number; cells?: string[] }[];
}
export function sellerClientName(pages: PageRows[]): { text: string; relY: number } | null {
  for (const pg of pages)
    for (let i = 0; i + 1 < pg.rows.length; i++) {
      if (!/^\s*seller\s*:?\s*client\s*:?\s*$/i.test(pg.rows[i]!.text)) continue;
      const next = pg.rows[i + 1]!;
      const cell = next.cells?.[0]?.trim();
      if (cell) return { text: cell, relY: Math.round(next.relY * 1000) / 1000 };
    }
  return null;
}
