import type { PlanAbout } from '@morph/core';
import { create } from 'zustand';

// 草稿模式的界面状态（D-190），外壳和推入的页面共用：聊天框开着没有、最新一步的回复收起没有。

interface DraftUiState {
  chatOpen: boolean;
  /** 从哪一页右上角的入口打开的聊天框（D-406）：这一次聊天里说的话默认改它。 */
  chatAbout: PlanAbout | null;
  /** 收起了回复的那一步（changeRequestId）；最新一步不是它时显示最新一步的回复。null = 再打开。 */
  seenStep: number | null;
  setChatOpen(open: boolean, about?: PlanAbout): void;
  markSeen(changeRequestId: number | null): void;
}

export const useDraftUi = create<DraftUiState>()((set) => ({
  chatOpen: false,
  chatAbout: null,
  seenStep: null,
  setChatOpen: (chatOpen, about) => set({ chatOpen, chatAbout: about ?? null }),
  markSeen: (seenStep) => set({ seenStep }),
}));
