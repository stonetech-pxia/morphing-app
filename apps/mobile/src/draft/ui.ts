import { create } from 'zustand';

// 草稿模式的界面状态（D-190），外壳和推入的页面共用：聊天框开着没有、最新一步的回复收起没有。

interface DraftUiState {
  chatOpen: boolean;
  /** 收起了回复的那一步（changeRequestId）；最新一步不是它时显示最新一步的回复。null = 再打开。 */
  seenStep: number | null;
  setChatOpen(open: boolean): void;
  markSeen(changeRequestId: number | null): void;
}

export const useDraftUi = create<DraftUiState>()((set) => ({
  chatOpen: false,
  seenStep: null,
  setChatOpen: (chatOpen) => set({ chatOpen }),
  markSeen: (seenStep) => set({ seenStep }),
}));
