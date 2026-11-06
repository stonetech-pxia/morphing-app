import {
  SYSTEM_TARGET_ICONS,
  builtinText,
  navTargetLabel,
  pageIdOf,
  toolTargetId,
  type IconValue,
  type Locale,
  type NavTarget,
  type OpenTarget,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { useRouter } from 'expo-router';

import { useWorkspace } from '../workspace/context';

/**
 * 打开一个导航目标：
 * - AI 修改是单独的页面；
 * - 导航栏里的页面和系统入口（工具、历史、设置）在外壳里切换显示；
 * - 不在导航栏里的页面、工具和改动记录推入一个带返回按钮的新页面；
 * - 快捷操作 tool:<id> 只打开摆出来（D-256）。
 */
export function useNavigate(): (target: OpenTarget) => void {
  const router = useRouter();
  const nav = useWorkspace((s) => s.config!.nav.bar);
  const selectTab = useWorkspace((s) => s.selectTab);
  return (target) => {
    // 按钮、快捷入口打开的快捷操作（D-256）：只摆出来，用户点「开始」才运行（和提醒一样，P-043）。
    const workflowId = toolTargetId(target);
    if (workflowId !== null) {
      router.push({ pathname: '/reminder/[workflowId]', params: { workflowId, from: 'entry' } });
      return;
    }
    const navTarget = target as NavTarget;
    if (navTarget === 'quickActions' && !nav.includes(navTarget)) {
      router.push('/quick-actions');
      return;
    }
    if ((navTarget === 'history' || navTarget === 'tools') && !nav.includes(navTarget)) {
      router.push(`/${navTarget}`);
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

export function targetIcon(target: NavTarget, config: WorkspaceConfig): IconValue | 'tink' {
  const pageId = pageIdOf(target);
  if (pageId === null) return SYSTEM_TARGET_ICONS[target as keyof typeof SYSTEM_TARGET_ICONS];
  return config.containers.pages.find((p) => p.id === pageId)?.icon ?? 'bookmark';
}

/** 导航栏的文字；内置的页面名字跟着界面语言显示（用户改过的不换）。 */
export function targetLabel(
  target: NavTarget,
  config: WorkspaceConfig,
  locale: Locale,
  registry: Registry,
): string {
  return builtinText(navTargetLabel(target, config, locale), locale, registry);
}

/** 模态页关闭的动画时长（iOS 约 350 毫秒）。 */
const MODAL_CLOSE_MS = 400;

/**
 * 从一个模态页（「快捷操作做好了」、快捷操作入口页）去运行页：先关掉这一页，关完再打开运行页。
 * 直接换成运行页时，两个模态同时在动画，运行页第一步弹出的照片 / 文件选择器被 iOS 悄悄丢掉，
 * 运行一直停在第 1 步（2026-11-06 模拟器上「现在就用一次」卡在「选照片」）。
 */
export function openRunAfterClosing(
  router: ReturnType<typeof useRouter>,
  workflowId: string,
): void {
  const run = { pathname: '/run/[workflowId]' as const, params: { workflowId } };
  // 从通知直接打开、下面没有页面时，没有可关的，直接换。
  if (!router.canGoBack()) {
    router.replace(run);
    return;
  }
  router.back();
  setTimeout(() => router.push(run), MODAL_CLOSE_MS);
}
