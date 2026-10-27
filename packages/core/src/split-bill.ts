import { formatNumber } from './data';
import { t } from './messages';
import type { Locale } from './schema';

// AA 分摊（D-259）：几个人各付了多少钱，算出谁该给谁多少。完全在本机算，不用 AI。
// 一律按分（整数）计算，避免小数误差；除不尽的几分钱按填写顺序由前几个人各多付 1 分。

export interface BillPerson {
  name: string;
  /** 付了多少钱（元、欧元……），不能是负数。 */
  paid: number;
}

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

export interface Settlement {
  /** 几个人。 */
  count: number;
  totalCents: number;
  /** 每人应付（分），除不尽时往下取整。 */
  shareCents: number;
  /** 除不尽时多付 1 分的人（按填写顺序）。 */
  extra: string[];
  transfers: Transfer[];
}

export function settleBill(people: readonly BillPerson[]): Settlement {
  const paid = people.map((p) => Math.round(p.paid * 100));
  const totalCents = paid.reduce((a, b) => a + b, 0);
  const n = people.length;
  const shareCents = Math.floor(totalCents / n);
  const remainder = totalCents - shareCents * n;
  const extra = people.slice(0, remainder).map((p) => p.name);
  // 正数：多付了，应该收回；负数：少付了，应该给出。
  const balance = people.map((p, i) => ({
    name: p.name,
    cents: paid[i]! - shareCents - (i < remainder ? 1 : 0),
  }));
  const transfers: Transfer[] = [];
  const pay = (from: (typeof balance)[number], to: (typeof balance)[number], cents: number) => {
    transfers.push({ from: from.name, to: to.name, cents });
    from.cents += cents;
    to.cents -= cents;
  };
  // 先配金额正好相等的一对，一笔就两清；剩下的每次让欠得最多的给多付得最多的，最多 n - 1 笔。
  for (const d of balance) {
    if (d.cents >= 0) continue;
    const c = balance.find((x) => x.cents === -d.cents);
    if (c) pay(d, c, c.cents);
  }
  for (;;) {
    const debtor = balance.reduce((a, b) => (b.cents < a.cents ? b : a));
    const creditor = balance.reduce((a, b) => (b.cents > a.cents ? b : a));
    if (debtor.cents >= 0 || creditor.cents <= 0) break;
    pay(debtor, creditor, Math.min(-debtor.cents, creditor.cents));
  }
  return { count: n, totalCents, shareCents, extra, transfers };
}

/** 结果页显示的文字：合计和每人应付、余数由谁多付、一行一笔转账。 */
export function settlementText(s: Settlement, locale: Locale): string {
  const money = (cents: number) => formatNumber(cents / 100, 2, locale);
  const names = (list: readonly string[]) => list.join(t(locale, 'separatorList'));
  const lines = [
    t(locale, 'splitSummary', {
      total: money(s.totalCents),
      n: s.count,
      share: money(s.shareCents),
    }),
  ];
  if (s.extra.length > 0) {
    lines.push(
      t(locale, s.extra.length === 1 ? 'splitRemainderOne' : 'splitRemainder', {
        extra: money(s.extra.length),
        names: names(s.extra),
        cent: money(1),
      }),
    );
  }
  if (s.transfers.length === 0) lines.push(t(locale, 'splitNothingToPay'));
  for (const tr of s.transfers) {
    lines.push(t(locale, 'splitTransfer', { from: tr.from, to: tr.to, amount: money(tr.cents) }));
  }
  return lines.join('\n');
}
