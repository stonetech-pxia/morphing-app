import type { Op } from './ops';
import { workflowKinds, QUICK_ACTION_CATEGORIES } from './quick-actions';
import { MAX_HOME_SCREEN, quickActionsOf, type IconValue, type WorkspaceConfig } from './schema';

// 手机桌面（D-271）：nav.phoneHomeScreen 里的快捷操作出现在长按 Morph 图标的菜单里（iOS Home Screen Quick Actions、
// Android App Shortcuts）。菜单由配置算出来，每次配置变了（AI 修改、撤销、恢复、删除、改名）整份换掉。
// 点一下打开 Morph 直接开始那个快捷操作，和点运行卡片一样（D-108）。

export interface HomeScreenItem {
  workflowId: string;
  title: string;
  /** 快捷操作自己的图标；没有时用它的分类图标。 */
  icon: IconValue;
}

/** 桌面菜单里的快捷操作 ID，按 nav.phoneHomeScreen 的顺序；不在配置里的不算。 */
function homeScreenIds(config: WorkspaceConfig): string[] {
  const ids = new Set(quickActionsOf(config).map((w) => w.id));
  return (config.nav.phoneHomeScreen ?? []).filter((id) => ids.has(id));
}

/** 桌面菜单里的快捷操作，按 nav.phoneHomeScreen 的顺序；校验器保证不超过 MAX_HOME_SCREEN 个，这里再截一次。 */
export function homeScreenItems(config: WorkspaceConfig): HomeScreenItem[] {
  const workflows = quickActionsOf(config);
  return homeScreenIds(config)
    .slice(0, MAX_HOME_SCREEN)
    .map((id) => workflows.find((w) => w.id === id)!)
    .map((w) => ({
      workflowId: w.id,
      title: w.name,
      icon: w.icon ?? QUICK_ACTION_CATEGORIES[workflowKinds(w)[0] ?? 'other'].icon,
    }));
}

/** 这次修改新放到桌面的快捷操作（应用后带用户去看怎么用，Android 上点了按钮才固定到桌面）。 */
export function addedToHomeScreen(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const was = new Set(homeScreenIds(before));
  return homeScreenIds(after).filter((id) => !was.has(id));
}

/** 桌面菜单满了：再放一个之前要先拿掉一个。 */
export const homeScreenFull = (config: WorkspaceConfig): boolean =>
  homeScreenIds(config).length >= MAX_HOME_SCREEN;

/**
 * 放到桌面 / 从桌面拿掉一个快捷操作的修改（长按菜单里的开关）：v34 的操作写整个列表（nav.phoneHomeScreen），
 * 这里按现在的列表加上或去掉这一个。新放的排在最后。
 */
export function homeScreenOp(config: WorkspaceConfig, workflowId: string, on: boolean): Op {
  const ids = (config.nav.phoneHomeScreen ?? []).filter((id) => id !== workflowId);
  return { op: 'updateContainer', nav: { phoneHomeScreen: on ? [...ids, workflowId] : ids } };
}
