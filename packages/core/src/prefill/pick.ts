import { splitLines, type ValueCandidate } from './candidates';

// 没有版式记忆时按标签挑（D-244 的扩展）：金额优先「实付 / 应付 / Total TTC / Amount paid」，
// 排除小计、优惠、找零、现金、税、HT；日期排除到期、配送、打印这类，几个日期分不清时优先「开票日期」类。
// 挑不出来就空着，绝不猜：没有标签的数不取，两个说法一样强、值又不同的也不取。

/** 候选前面的标签：同一行在它前面的文字；那里只有符号时用上一行（两栏被拆开、标签单独一行）。 */
export interface CandidateLabel {
  /** 统一后的标签文字（小写、去掉数字、货币符号和标点）。 */
  text: string;
  /** 0：同一行；1：上一行。 */
  offset: 0 | 1;
}

const STRIP = /[\d$€£¥￥元:：.,;·•*#()[\]{}<>|=_\-–—/\\'"«»“”]+/g;

export function normalizeLabel(text: string): string {
  return text.toLowerCase().replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
}

const hasWords = (s: string) => /[a-zà-ÿ一-鿿]{2,}|[一-鿿]/i.test(s);

export function labelOf(
  lines: readonly string[],
  candidate: ValueCandidate,
  all: readonly ValueCandidate[],
): CandidateLabel {
  const line = lines[candidate.line] ?? '';
  // 同一行里前面别的候选（「小计 98.75 实付 90.25」）之后的那一段才是它的标签。
  const before = all
    .filter((c) => c.line === candidate.line && c.end <= candidate.start)
    .reduce((from, c) => Math.max(from, c.end), 0);
  const same = normalizeLabel(line.slice(before, candidate.start));
  if (hasWords(same)) return { text: same, offset: 0 };
  for (let i = candidate.line - 1; i >= 0; i--) {
    const prev = lines[i]!;
    if (!prev.trim()) continue;
    const label = normalizeLabel(prev);
    const prevHasValue = all.some((c) => c.line === i && c.kind === candidate.kind);
    return !prevHasValue && hasWords(label)
      ? { text: label, offset: 1 }
      : { text: same, offset: 0 };
  }
  return { text: same, offset: 0 };
}

// ---- 金额 ----

const AMOUNT_EXCLUDE =
  /小计|优惠|折扣|减免|立减|找零|找赎|零钱|现金|积分|余额|押金|小费|税|单价|数量|原价|subtotal|sub total|discount|saving|saved|coupon|promo|\bchange\b|\bcash\b|tender|\btip\b|gratuity|deposit|points|previous|\btax\b|\bvat\b|unit price|\bqty\b|sous total|\bht\b|hors tax|remise|réduction|rabais|rendu|monnaie|espèces|\btva\b|acompte|pourboire|déjà|already paid|prix unitaire|économie/;
// 最终付的 / 要付的。
const AMOUNT_FINAL =
  /实付|应付|应收|付款金额|支付金额|价税合计|实际支付|本次支付|amount paid|total paid|grand total|balance due|amount due|total due|to pay|net à payer|net a payer|\bttc\b|à payer|a payer|à régler|a régler|total payé|montant payé|montant dû|montant total|total à/;
// 一般的合计。
const AMOUNT_TOTAL = /合计|总计|总额|总价|总金额|实收|金额|\btotal\b|\bmontant\b|\bsum\b|\bsomme\b/;
// 刷卡、扫码这类付款行：没有合计时才用。
const AMOUNT_PAYMENT =
  /visa|mastercard|master card|amex|\bcb\b|carte|\bcard\b|debit|crédit|credit|微信|支付宝|银联|刷卡|apple pay|google pay|payé par|paid by/;
// 有找零时，「实收 / 收款 / received」是收的现金，不是金额。
const CHANGE = /找零|找赎|\bchange\b|rendu|monnaie/;
const TENDER = /实收|收款|received|reçu/;

/** 金额候选按标签分级：3 最终付的，2 合计，1 付款行，0 没有标签，-1 排除。 */
export function amountTier(label: string, changeOnPage: boolean): number {
  if (!label) return 0;
  if (AMOUNT_EXCLUDE.test(label)) return -1;
  if (changeOnPage && TENDER.test(label)) return -1;
  if (AMOUNT_FINAL.test(label)) return 3;
  if (AMOUNT_TOTAL.test(label)) return 2;
  if (AMOUNT_PAYMENT.test(label)) return 1;
  return 0;
}

/** 从最高的一级里挑：这一级只有一个值（可以出现几次）才填；值不一样就空着。负数不取。 */
function pickByTier(scored: { c: ValueCandidate; tier: number }[]): ValueCandidate | null {
  const usable = scored.filter((s) => s.tier > 0 && Number(s.c.value) > 0);
  if (usable.length === 0) return null;
  const top = Math.max(...usable.map((s) => s.tier));
  const best = usable.filter((s) => s.tier === top);
  const values = new Set(best.map((s) => Number(s.c.value).toFixed(2)));
  if (values.size !== 1) return null;
  // 规则为主：同样的值有规则的候选就用规则的。
  return (best.find((s) => s.c.source === 'rule') ?? best[0]!).c;
}

const hasCents = (c: ValueCandidate) => /[.,]\d{2}\s*\D*$/.test(c.raw.trim());

export function pickAmount(
  text: string,
  candidates: readonly ValueCandidate[],
): ValueCandidate | null {
  const lines = splitLines(text);
  const changeOnPage = lines.some((l) => CHANGE.test(l.toLowerCase()));
  // 这一页的金额都带两位小数时，没有小数的（31362 €）多半是小数点没认出来：不取，宁可空着。
  const withCents = candidates.some((c) => c.kind === 'amount' && hasCents(c));
  const amounts = candidates.filter((c) => c.kind === 'amount' && (!withCents || hasCents(c)));
  return pickByTier(
    amounts.map((c) => ({ c, tier: amountTier(labelOf(lines, c, candidates).text, changeOnPage) })),
  );
}

const TAX = /税额|税金|增值税|\btax\b|\bvat\b|\btva\b|\btaxes\b/;
const TAX_NOT = /不含税|含税|价税合计|excl|incl|before tax|\bht\b|\bttc\b|hors tax|rate|taux/;
const TAX_TOTAL = /total|合计|总/;

/** 税额：标签像税、又不是「不含税 / 含税合计 / 税率」的；几种税率分开列时只取写了「合计」的那一个。 */
export function pickTax(
  text: string,
  candidates: readonly ValueCandidate[],
): ValueCandidate | null {
  const lines = splitLines(text);
  const taxes = candidates
    .filter((c) => c.kind === 'amount' && Number(c.value) > 0)
    .map((c) => ({ c, label: labelOf(lines, c, candidates).text }))
    .filter(({ label }) => TAX.test(label) && !TAX_NOT.test(label));
  const values = new Set(taxes.map(({ c }) => Number(c.value).toFixed(2)));
  if (values.size === 1) return taxes[0]!.c;
  const totals = taxes.filter(({ label }) => TAX_TOTAL.test(label));
  return new Set(totals.map(({ c }) => Number(c.value).toFixed(2))).size === 1
    ? totals[0]!.c
    : null;
}

// ---- 日期 ----

const DATE_EXCLUDE =
  /到期|截止|期限|有效期|出生|生日|配送|送达|发货|预计|打印|下次|period|周期|账期|\bdue\b|payable|pay by|expir|\bexp\b|valid|delivery|deliver|ship|arriv|birth|\bdob\b|print|next|échéance|avant le|livraison|expédition|naissance|validité|imprimé|période|prochain/;
const DATE_ISSUE =
  /开票日期|日期|交易|消费|下单|乘车|出发|\bdate\b|issued|invoice date|transaction|purchase|order date|travel|émis|émission|achat|facture du|\ble\b/;

/** 日期：去掉到期、配送、打印这类；剩下只有一个值就填；不止一个值时只看「开票日期」类标签下的，还是不止一个就空着。 */
export function pickDate(
  text: string,
  candidates: readonly ValueCandidate[],
): ValueCandidate | null {
  const lines = splitLines(text);
  const dates = candidates
    .filter((c) => c.kind === 'date')
    .map((c) => ({ c, label: labelOf(lines, c, candidates).text }))
    .filter(({ label }) => !DATE_EXCLUDE.test(label));
  const prefer = (list: typeof dates) =>
    list.find(({ c }) => c.source === 'rule')?.c ?? list[0]?.c ?? null;
  if (new Set(dates.map(({ c }) => c.value)).size === 1) return prefer(dates);
  const issued = dates.filter(({ label }) => DATE_ISSUE.test(label));
  return new Set(issued.map(({ c }) => c.value)).size === 1 ? prefer(issued) : null;
}
