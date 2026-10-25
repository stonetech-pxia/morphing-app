import type { Locale } from './schema';

type Translated<T> = { en: T; zh: T; fr?: T };

/** 下载目录或过渡期文案缺少法语时，统一回退到英文。 */
export function localize<T>(text: Translated<T>, locale: Locale): T;
export function localize<T>(text: Translated<T> | undefined, locale: Locale): T | undefined;
export function localize<T>(text: Translated<T> | undefined, locale: Locale): T | undefined {
  return text?.[locale] ?? text?.en;
}
