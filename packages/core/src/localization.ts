import type { Locale } from './schema';

type Translated<T> = { en: T; zh: T; fr?: T };

/** 下载目录或过渡期文案缺少法语时，统一回退到英文。 */
export function localize<T>(text: Translated<T>, locale: Locale): T;
export function localize<T>(text: Translated<T> | undefined, locale: Locale): T | undefined;
export function localize<T>(text: Translated<T> | undefined, locale: Locale): T | undefined {
  return text?.[locale] ?? text?.en;
}

export const localeTag = (locale: Locale) => ({ en: 'en-US', zh: 'zh-CN', fr: 'fr-FR' })[locale];

/** 文件大小按二进制换算；法语使用本地小数符和 octet 单位。 */
export function formatFileSize(
  bytes: number,
  locale: Locale = 'en',
  minimumKilobytes = false,
): string {
  const unit = bytes >= 1024 * 1024 ? 2 : bytes >= 1024 || minimumKilobytes ? 1 : 0;
  const digits = unit === 2 ? 1 : 0;
  const amount = new Intl.NumberFormat(localeTag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(bytes / 1024 ** unit);
  return `${amount} ${locale === 'fr' ? ['o', 'Ko', 'Mo'][unit] : ['B', 'KB', 'MB'][unit]}`;
}
