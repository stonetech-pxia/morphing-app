import { create } from 'zustand';

import type { WorkspaceRepo } from '../storage/types';
import type { PlacedWidget } from './types';

// 用户「放到桌面」的组件（D-325）：只记在本机的 app_meta 里，不进配置，AI 看不到、也改不了。
// 组件删掉以后照样记着，小组件上显示「已经移除了」，直到用户在 App 里移除或把小组件从桌面拿掉。

const META_KEY = 'widgets.placed';
/** 最多记几个（iOS「编辑小组件」的列表不宜太长）。 */
export const MAX_PLACED = 20;

interface PlacedState {
  /** null：还没读。 */
  placed: PlacedWidget[] | null;
  repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'> | null;
  load(repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'>): Promise<void>;
  /** 放到桌面：已经放过的挪到最后（成为没选组件的小组件显示的那个）。 */
  add(componentId: string, now: number): Promise<void>;
  remove(componentId: string): Promise<void>;
}

function parse(text: string | null): PlacedWidget[] {
  try {
    const list = JSON.parse(text ?? '[]') as unknown;
    return Array.isArray(list)
      ? list.filter(
          (p): p is PlacedWidget =>
            typeof p?.componentId === 'string' && typeof p?.placedAt === 'number',
        )
      : [];
  } catch {
    return [];
  }
}

export const useWidgetPlacement = create<PlacedState>()((set, get) => {
  const save = async (placed: PlacedWidget[]) => {
    set({ placed });
    await get().repo?.setMeta(META_KEY, JSON.stringify(placed));
  };
  return {
    placed: null,
    repo: null,
    async load(repo) {
      set({ repo, placed: parse(await repo.getMeta(META_KEY)) });
    },
    async add(componentId, now) {
      const rest = (get().placed ?? []).filter((p) => p.componentId !== componentId);
      await save([...rest, { componentId, placedAt: now }].slice(-MAX_PLACED));
    },
    async remove(componentId) {
      await save((get().placed ?? []).filter((p) => p.componentId !== componentId));
    },
  };
});
