import type { Locale, OcrLanguage } from '@morph/core';
import { getLocales } from 'expo-localization';

// 识别语言选「自动」时用哪一种（D-278）：按手机语言列表的第一种（没有时按界面语言）。
// PP-OCRv6 一个模型就认中日英法德西葡意，选哪一种只决定识别后怎么整理（简体还是繁体、全角标点）；
// 韩文、俄文、越南文它认不了，手机是这几种语言时改用系统的识别（或文字识别包）。

const BY_LANGUAGE: Record<string, OcrLanguage> = {
  ko: 'kor',
  ru: 'rus',
  vi: 'vie',
  ja: 'jpn',
  fr: 'fra',
  de: 'deu',
  es: 'spa',
  pt: 'por',
  it: 'ita',
  en: 'eng',
};

/** languageTags：手机的语言列表（BCP 47，按偏好排）。 */
export function autoOcrLanguage(languageTags: readonly string[], locale: Locale): OcrLanguage {
  const tag = (languageTags[0] ?? locale).toLowerCase();
  const code = tag.split('-')[0]!;
  if (code === 'zh') return /hant|-tw|-hk|-mo/.test(tag) ? 'chi_tra' : 'chi_sim';
  return BY_LANGUAGE[code] ?? 'eng';
}

/** 参数里的语言；auto 换成按手机语言选的那一种。 */
export function resolveOcrLanguage(lang: unknown, locale: Locale): OcrLanguage {
  if (lang !== 'auto') return lang as OcrLanguage;
  const tags = getLocales()
    .map((l) => l.languageTag)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  return autoOcrLanguage(tags, locale);
}
