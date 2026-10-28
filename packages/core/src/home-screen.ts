import { workflowKinds, QUICK_ACTION_CATEGORIES } from './quick-actions';
import { MAX_HOME_SCREEN, type IconValue, type WorkspaceConfig } from './schema';

// 手机桌面（D-271）：用户标了「放到桌面」的快捷操作出现在长按 Morph 图标的菜单里（iOS Home Screen Quick Actions、
// Android App Shortcuts）。菜单由配置算出来，每次配置变了（AI 修改、撤销、恢复、删除、改名）整份换掉。
// 点一下打开 Morph 直接开始那个快捷操作，和点运行卡片一样（D-108）。

export interface HomeScreenItem {
  workflowId: string;
  title: string;
  /** 快捷操作自己的图标；没有时用它的分类图标。 */
  icon: IconValue;
}

/** 桌面菜单里的快捷操作，按配置里的顺序；校验器保证不超过 MAX_HOME_SCREEN 个，这里再截一次。 */
export function homeScreenItems(config: WorkspaceConfig): HomeScreenItem[] {
  return config.workflows
    .filter((w) => w.homeScreen)
    .slice(0, MAX_HOME_SCREEN)
    .map((w) => ({
      workflowId: w.id,
      title: w.name,
      icon: w.icon ?? QUICK_ACTION_CATEGORIES[workflowKinds(w)[0] ?? 'other'].icon,
    }));
}

/** 这次修改新放到桌面的快捷操作（应用后带用户去看怎么用，Android 上点了按钮才固定到桌面）。 */
export function addedToHomeScreen(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const was = new Set(before.workflows.filter((w) => w.homeScreen).map((w) => w.id));
  return after.workflows.filter((w) => w.homeScreen && !was.has(w.id)).map((w) => w.id);
}

/** 桌面菜单满了：再放一个之前要先拿掉一个。 */
export const homeScreenFull = (config: WorkspaceConfig): boolean =>
  config.workflows.filter((w) => w.homeScreen).length >= MAX_HOME_SCREEN;
