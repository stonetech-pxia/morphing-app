import { localeTag } from './localization';
import type { Locale } from './schema-primitives';

// 字段值的基本写法和显示格式。字段定义（fields/）和记录的纯函数（data.ts）都用；
// 单独放一个文件，避免字段定义和 data.ts 互相引用。对外从 data.ts 导出。

/** 附件字段（D-187、D-263）的值是一组文件 ID；别的字段是文字、数字或勾选。 */
export type FieldValue = string | number | boolean | readonly string[];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const pad = (n: number) => String(n).padStart(2, '0');

/** 设备本地日期 YYYY-MM-DD。 */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidDate(s: string): boolean {
  if (!DATE_PATTERN.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** 时间 HH:mm（00:00–23:59）。 */
export const isValidTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 填写的时间（「8:05」「08:05」「8：05」，可以带秒）→ HH:mm；认不出时为 undefined。 */
export function normalizeTime(input: string): string | undefined {
  const m = /^(\d{1,2})[:：](\d{2})(?:[:：]\d{2})?$/.exec(input.trim());
  const time = m ? `${pad(Number(m[1]))}:${m[2]}` : '';
  return isValidTime(time) ? time : undefined;
}

/** 设备本地日期时间 YYYY-MM-DDTHH:mm（D-279，不带时区）。 */
export const localDateTime = (d: Date) =>
  `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const isValidDateTime = (s: string) =>
  s.length === 16 && s[10] === 'T' && isValidDate(s.slice(0, 10)) && isValidTime(s.slice(11));

/** 时长（分钟数）→ h:mm（「1:30」「41:05」），不足一分钟的四舍五入（D-279）。 */
export function formatDuration(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  return `${minutes < 0 && total > 0 ? '-' : ''}${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** 附件的值：文件 ID（和配置里的 ID 一样的写法）。 */
export const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** 一个附件字段最多放几个文件（D-263）。 */
export const MAX_ATTACHMENTS = 20;

/** 附件字段的值（或表单里的值）→ 文件 ID 列表：旧数据里的单个 ID 当成一组，别的值当成空。 */
export function attachmentIds(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  HKD: 'HK$',
  TWD: 'NT$',
  KRW: '₩',
};

function groupThousands(n: number, decimals: number): string {
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.') as [string, string | undefined];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatMoney(n: number, currency: string, locale: Locale = 'en'): string {
  if (locale === 'fr')
    return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency }).format(n);
  const symbol = CURRENCY_SYMBOLS[currency];
  const amount = groupThousands(n, 2);
  return symbol
    ? `${n < 0 ? '-' : ''}${symbol}${amount.replace('-', '')}`
    : `${currency} ${amount}`;
}

export function formatNumber(n: number, decimals?: number, locale: Locale = 'en'): string {
  if (locale === 'fr')
    return new Intl.NumberFormat(localeTag(locale), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals ?? 4,
    }).format(n);
  if (decimals !== undefined) return groupThousands(n, decimals);
  return groupThousands(n, Number.isInteger(n) ? 0 : Math.min(4, String(n).split('.')[1]!.length));
}

/**
 * 引用字段（D-250）指向的那条记录的标题；那条记录已经删掉（或那张表的记录还没读出来）时为 null。
 * 由 App 按已经读到的记录提供（makeLinkResolver）；没有时引用字段显示为空。
 */
export type LinkResolver = (collectionId: string, recordId: string) => string | null;

export function formatTimestamp(ms: number, locale: Locale = 'en'): string {
  const d = new Date(ms);
  if (locale === 'fr')
    return new Intl.DateTimeFormat(localeTag(locale), {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
