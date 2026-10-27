import {
  SYSTEM_TARGET_ICONS,
  navTargetLabel,
  pageIdOf,
  workflowTargetId,
  type IconValue,
  type Locale,
  type NavTarget,
  type OpenTarget,
  type WorkspaceConfig,
} from '@morph/core';
import { useRouter } from 'expo-router';

import { useWorkspace } from '../workspace/context';

/**
 * 打开一个导航目标：
 * - AI 修改是单独的页面；
 * - 导航栏里的页面和系统入口（工具、历史、设置）在外壳里切换显示；
 * - 不在导航栏里的页面推入一个带返回按钮的新页面；
 * - 快捷操作 workflow:<id> 只打开摆出来（D-256）。
 */
export function useNavigate(): (target: OpenTarget) => void {
  const router = useRouter();
  const nav = useWorkspace((s) => s.config!.shell.nav);
  const selectTab = useWorkspace((s) => s.selectTab);
  return (target) => {
    // 按钮、快捷入口打开的快捷操作（D-256）：只摆出来，用户点「开始」才运行（和提醒一样，P-043）。
    const workflowId = workflowTargetId(target);
    if (workflowId !== null) {
      router.push({ pathname: '/reminder/[workflowId]', params: { workflowId, from: 'entry' } });
      return;
    }
    const navTarget = target as NavTarget;
    if (navTarget === 'quickActions' && !nav.includes(navTarget)) {
      router.push('/quick-actions');
      return;
    }
    if (navTarget === 'ai') {
      router.push('/change');
      return;
    }
    const pageId = pageIdOf(navTarget);
    if (pageId !== null && !nav.includes(navTarget)) {
      router.push({ pathname: '/page/[pageId]', params: { pageId } });
      return;
    }
    selectTab(navTarget);
    // 从推入的页面打开外壳里的入口时，先回到外壳。
    if (router.canDismiss()) router.dismissAll();
  };
}

export function targetIcon(target: NavTarget, config: WorkspaceConfig): IconValue {
  const pageId = pageIdOf(target);
  if (pageId === null) return SYSTEM_TARGET_ICONS[target as keyof typeof SYSTEM_TARGET_ICONS];
  return config.pages.find((p) => p.id === pageId)?.icon ?? 'bookmark';
}

export function targetLabel(target: NavTarget, config: WorkspaceConfig, locale: Locale): string {
  return navTargetLabel(target, config, locale);
}
