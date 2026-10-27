import type { Locale } from '@morph/core';

import { create } from 'zustand';

import type { WorkspaceRepo } from '../storage/types';

// 界面语言（D-254）：默认跟随系统，也可以在「设置 → 语言」里选一种。
// 选择存在本机的 app_meta 里：不进工作空间配置、不生成版本、不发给 AI。
// 权限弹窗、分享扩展等系统里的文字仍跟随系统语言。

export type LocaleChoice = 'system' | Locale;

export const LOCALE_CHOICES: readonly LocaleChoice[] = ['system', 'en', 'zh', 'fr'];

/** 语言名用各自的语言写，不翻译。 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  fr: 'Français',
};

const META_KEY = 'locale';

export function resolveLocale(choice: LocaleChoice, device: Locale): Locale {
  return choice === 'system' ? device : choice;
}

interface LocaleState {
  choice: LocaleChoice;
  /** 系统语言（启动时读一次）。 */
  device: Locale;
  /** 界面实际用的语言。 */
  locale: Locale;
  repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'> | null;
  /** 还没读本机记录之前先用系统语言（启动失败的提示也要有语言）。 */
  reset(device: Locale): void;
  load(repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'>, device: Locale): Promise<void>;
  setChoice(choice: LocaleChoice): Promise<void>;
}

export const useLocaleChoice = create<LocaleState>()((set, get) => ({
  choice: 'system',
  device: 'en',
  locale: 'en',
  repo: null,
  reset(device) {
    set({ choice: 'system', device, locale: device, repo: null });
  },
  async load(repo, device) {
    const saved = await repo.getMeta(META_KEY);
    const choice = LOCALE_CHOICES.includes(saved as LocaleChoice)
      ? (saved as LocaleChoice)
      : 'system';
    set({ repo, device, choice, locale: resolveLocale(choice, device) });
  },
  async setChoice(choice) {
    set({ choice, locale: resolveLocale(choice, get().device) });
    await get().repo?.setMeta(META_KEY, choice);
  },
}));
