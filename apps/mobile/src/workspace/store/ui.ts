import { appOfTarget, appViewOf, firstTarget } from '@morph/core';

import type { Kernel } from './kernel';
import type { WorkspaceState } from './types';

// 界面状态：版本提示条（banner）、记录提示（toast）、当前导航项、文件和记录的刷新信号。

export function createUI({
  set,
  get,
}: Kernel): Pick<
  WorkspaceState,
  | 'dismissBanner'
  | 'selectTab'
  | 'enterApp'
  | 'showInShell'
  | 'leaveApp'
  | 'bumpRecords'
  | 'showToast'
  | 'dismissToast'
  | 'holdBanner'
  | 'holdToast'
  | 'bumpAssets'
> {
  return {
    dismissBanner: () => set({ banner: null }),

    selectTab: (target) => set({ tab: target, editing: null }),

    enterApp(appId) {
      const config = get().config;
      if (!config) return;
      const view = appViewOf(config, appId);
      if (view.appId === null) return;
      set({ appId, tab: firstTarget(view), editing: null });
    },

    showInShell(config, target) {
      const owner = appOfTarget(config, target);
      if (owner === undefined) return false;
      const view = appViewOf(config, owner);
      if (!view.bar.includes(target)) return false;
      set({ appId: view.appId, tab: target, editing: null });
      return true;
    },

    leaveApp() {
      const config = get().config;
      set({
        appId: null,
        tab: config ? firstTarget(appViewOf(config, null)) : null,
        editing: null,
      });
    },

    bumpRecords: () => set((s) => ({ recordsVersion: s.recordsVersion + 1 })),

    showToast: (toast) => set({ toast }),

    dismissToast: () => set({ toast: null }),

    // 按住 / 松开时换一个新对象，提示条的定时器跟着停和重新开始。
    holdBanner(held) {
      const banner = get().banner;
      if (banner && !!banner.held !== held) set({ banner: { ...banner, held } });
    },

    holdToast(held) {
      const toast = get().toast;
      if (toast && !!toast.held !== held) set({ toast: { ...toast, held } });
    },

    bumpAssets: () => set({ assetsVersion: get().assetsVersion + 1 }),
  };
}
