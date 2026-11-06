import type { Locale } from '@morph/core';
import { create } from 'zustand';

import { getDeviceLocale } from './i18n';

// 界面语言（设置 → 语言）：跟随系统，或固定英文、简体中文、法语。设备级的偏好，存在本机的 app_meta 里，
// 不属于工作空间配置，不进版本历史。改了以后外壳按新语言重建工作空间（见 _layout）。

export type LanguagePreference = 'system' | Locale;

export const LANGUAGE_META_KEY = 'language';
export const LANGUAGE_CHOICES: readonly LanguagePreference[] = ['system', 'zh', 'en', 'fr'];

export const parseLanguage = (value: string | null): LanguagePreference =>
  LANGUAGE_CHOICES.includes(value as LanguagePreference) ? (value as LanguagePreference) : 'system';

export const resolveLocale = (preference: LanguagePreference): Locale =>
  preference === 'system' ? getDeviceLocale() : preference;

export const useLanguage = create<{
  preference: LanguagePreference;
  set(preference: LanguagePreference): void;
}>()((set) => ({
  preference: 'system',
  set: (preference) => set({ preference }),
}));
