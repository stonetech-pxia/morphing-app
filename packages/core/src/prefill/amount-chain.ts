import type { Locale } from '../schema';
import { ruleCandidates } from './candidates';

// 算术找总额（创始人 2026-11-01 的想法，测量见 per-field/REPORT.md 的考卷一节）：不看字段名，只看数。
// 1. 付款 − 找零 = x，x 就是总额（这两排要有付款、找零字样）。
// 2. 否则：小计 = 上面连续几排明细的和；总额 = 小计 ± 下面的某个数（优惠、税）。
// 3. 否则：小计本身。

const NOT_MONEY =
  /\b(tel|fax|phone|gst\s*(reg|id|no)|reg\.?\s*no|invoice\s*no|bill\s*no|no\s*:|qty|date|time)\b|电话|编号|单号|日期|\d{1,2}[:/]\d{2}/i;
const PAY_ROW = /cash|tender|paid|payment|visa|master|card|现金|实收|收款|esp[èe]ces|pay[ée]/i;
const CHANGE_ROW = /change|找零|monnaie|rendu|kembali/i;
const DISCOUNT_ROW = /优惠|折扣|discount|remise|promo|voucher|less/i;
/** 数太多（长发票、对账单）时不算：三重循环在手机上要几百毫秒，这种单据也不是这个算法针对的。 */
const MAX_AMOUNTS = 120;

interface Amount {
  v: number;
  row: number;
  last: boolean;
}

function amountsOf(rows: readonly string[], noDecimals: boolean, locale: Locale): Amount[] {
  const out: Amount[] = [];
  rows.forEach((r, row) => {
    let vs: number[] = [];
    if (noDecimals) {
      for (const m of r.matchAll(/\d{1,3}(?:[.,]\d{3})+(?:[.,]00)?|\d{4,}/g))
        vs.push(Number(m[0].replace(/[.,]00$/, '').replace(/\D/g, '')));
    } else {
      // 每排只取带两位小数的数（小票上的金额），避免数量、编号。
      for (const m of r.matchAll(/-?\d{1,3}(?:[ ,.]\d{3})*[.,]\d{2}(?!\d)/g)) {
        const c = ruleCandidates(m[0], locale).find((x) => x.kind === 'amount');
        if (c) vs.push(Number(c.value));
      }
    }
    vs = vs.filter((v) => v > 0);
    vs.forEach((v, k) => out.push({ v, row, last: k === vs.length - 1 }));
  });
  return out;
}

export interface AmountChain {
  value: number;
  how: 'payMinusChange' | 'subtotalAdjust' | 'subtotal';
}

/** 差多少算相等：没有小数的币种差 1，其他差一分。 */
export const amountNear = (a: number, b: number, noDecimals: boolean) =>
  Math.abs(a - b) <= (noDecimals ? 1 : 0.011);

/** 算出来的总额；算不出来是 null。noDecimals：印尼盾这类没有小数的币种。 */
export function amountChain(
  rows: readonly string[],
  noDecimals: boolean,
  locale: Locale,
): AmountChain | null {
  const near = (a: number, b: number) => amountNear(a, b, noDecimals);
  const all = amountsOf(rows, noDecimals, locale).filter(
    (a) => !NOT_MONEY.test(rows[a.row]!) || /total|合计|montant/i.test(rows[a.row]!),
  );
  if (all.length > MAX_AMOUNTS) return null;

  for (const x of all) {
    for (const pay of all) {
      if (pay === x || pay.row <= x.row || !PAY_ROW.test(rows[pay.row]!)) continue;
      for (const ch of all) {
        if (
          ch !== pay &&
          ch !== x &&
          ch.row > x.row &&
          CHANGE_ROW.test(rows[ch.row]!) &&
          near(pay.v - ch.v, x.v) &&
          ch.v < x.v
        )
          return { value: x.v, how: 'payMinusChange' };
      }
    }
  }

  const subs: Amount[] = [];
  for (const x of all) {
    const above = all.filter((a) => a.last && a.row < x.row);
    outer: for (let i = 0; i < above.length; i++) {
      let s = 0;
      for (let j = i; j < above.length; j++) {
        s += above[j]!.v;
        if (j > i && near(s, x.v)) {
          subs.push(x);
          break outer;
        }
      }
    }
    // 只有一项明细时，小计 = 上面某一排的数。
    if (
      !subs.includes(x) &&
      above.some((a) => near(a.v, x.v)) &&
      /sub|小计|sous|total/i.test(rows[x.row]!)
    )
      subs.push(x);
  }
  let adjusted: number | null = null;
  for (const sub of subs) {
    for (const x of all) {
      if (x.row <= sub.row) continue;
      for (const adj of all) {
        if (adj === x || adj === sub || adj.v >= sub.v) continue;
        if (near(sub.v + adj.v, x.v)) adjusted = x.v;
        // 小计 − 优惠 = 总额，和「含税总额 − 不含税 = 税额」算术一样：减的那排写着优惠才取小的，否则取大的。
        else if (near(sub.v - adj.v, x.v))
          adjusted = DISCOUNT_ROW.test(rows[adj.row]!) ? x.v : Math.max(sub.v, x.v);
      }
    }
  }
  if (adjusted !== null) return { value: adjusted, how: 'subtotalAdjust' };
  return subs.length > 0 ? { value: subs.at(-1)!.v, how: 'subtotal' } : null;
}
