import {
  SYSTEM_TARGET_ICONS,
  navTargetLabel,
  pageIdOf,
  type IconValue,
  type Locale,
  type NavTarget,
  type WorkspaceConfig,
} from '@morph/core';
import { useRouter } from 'expo-router';

import { useWorkspace } from '../workspace/context';

/**
 * 打开一个导航目标：
 * - AI 修改是单独的页面；
 * - 导航栏里的页面和系统入口（工具、历史、设置）在外壳里切换显示；
 * - 不在导航栏里的页面推入一个带返回按钮的新页面。
 */
export function useNavigate(): (target: NavTarget) => void {
  const router = useRouter();
  const nav = useWorkspace((s) => s.config!.shell.nav);
  const selectTab = useWorkspace((s) => s.selectTab);
  return (target) => {
    if (target === 'quickActions' && !nav.includes(target)) {
      router.push('/quick-actions');
      return;
    }
    if (target === 'ai') {
      router.push('/change');
      return;
    }
    const pageId = pageIdOf(target);
    if (pageId !== null && !nav.includes(target)) {
      router.push({ pathname: '/page/[pageId]', params: { pageId } });
      return;
    }
    selectTab(target);
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
