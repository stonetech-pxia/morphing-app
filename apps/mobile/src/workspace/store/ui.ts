import type { Kernel } from './kernel';
import type { WorkspaceState } from './types';

// 界面状态：版本提示条（banner）、记录提示（toast）、当前导航项、文件和记录的刷新信号。

export function createUI({
  set,
  get,
}: Kernel): Pick<
  WorkspaceState,
  'dismissBanner' | 'selectTab' | 'bumpRecords' | 'showToast' | 'dismissToast' | 'bumpAssets'
> {
  return {
    dismissBanner: () => set({ banner: null }),

    selectTab: (target) => set({ tab: target, editing: null }),

    bumpRecords: () => set((s) => ({ recordsVersion: s.recordsVersion + 1 })),

    showToast: (toast) => set({ toast }),

    dismissToast: () => set({ toast: null }),

    bumpAssets: () => set({ assetsVersion: get().assetsVersion + 1 }),
  };
}
