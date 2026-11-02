import type { Field, Locale } from '../schema';
import { ruleCandidates } from './candidates';

// 规则之间共用的小工具：比较文字、币种有没有小数、一排能读出哪些日期。

export const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const NO_DECIMALS = new Set(['IDR', 'JPY', 'KRW', 'VND']);
/** 这种币种没有小数（字段的货币）。 */
export const hasNoDecimals = (f: Field) =>
  f.type === 'money' && f.currency !== undefined && NO_DECIMALS.has(f.currency);

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
/** 这个日期能从这一排读出来吗。 */
export const rowHasDate = (row: string, date: string) => dateReadings(row).includes(date);
