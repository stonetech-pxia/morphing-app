import { localize, MESSAGES, t, type StringKey, Locale, Localized } from '@morph/core';

import { getLocales } from 'expo-localization';
export { t, type StringKey } from '@morph/core';

// 界面文案集中在这里（DECISIONS P-003：英文 + 简体中文，跟随系统语言）。
// 用户自己的内容（页面标题等）存放在工作空间配置里，不经过这里。

export function getDeviceLocale(): Locale {
  const [primary] = getLocales();
  return primary?.languageCode === 'zh' ? 'zh' : 'en';
}

const PERMISSION_NAMES: Record<string, Localized> = {
  photos: { en: 'Photos', zh: '相册' },
  camera: { en: 'Camera', zh: '相机' },
  microphone: { en: 'Microphone', zh: '麦克风' },
  speech: { en: 'Speech recognition', zh: '语音识别' },
};

/** 运行错误的提示（detail 里的权限名等内部词换成用户看得懂的说法）。 */
export function runErrorText(
  locale: Locale,
  code: string,
  detail: Record<string, string | number> = {},
): string {
  const what =
    typeof detail.what === 'string' ? localize(PERMISSION_NAMES[detail.what], locale) : undefined;
  const key = `runError_${code}` as StringKey;
  if (!(key in MESSAGES)) return t(locale, 'runError_unexpected', { detail: code });
  return t(locale, key, { ...detail, ...(what ? { what } : {}) });
}

/** 改动记录里的时间（D-112）：今天 / 昨天 13:51，更早的显示日期，不显示秒。 */
export function formatWhen(locale: Locale, at: Date, now: Date): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return t(locale, 'dateToday', { time });
  if (days === 1) return t(locale, 'dateYesterday', { time });
  const sameYear = at.getFullYear() === now.getFullYear();
  if (locale === 'zh')
    return `${sameYear ? '' : `${at.getFullYear()}年`}${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
  const date = at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}
