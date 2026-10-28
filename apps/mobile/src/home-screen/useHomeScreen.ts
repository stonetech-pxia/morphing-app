import { homeScreenItems, type WorkspaceConfig } from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { t } from '../i18n';
import { iosSymbolName } from '../renderer/Icon';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { HomeScreenEntry, HomeScreenPlatform } from './platform';

// 手机桌面（D-269）：长按 Morph 图标的菜单完全由正式版本的配置算出来（草稿不算）。AI 修改、撤销、恢复、
// 删除和改名快捷操作之后整份换掉；Android 上不在菜单里的已固定图标停用。
// 点了菜单项或桌面图标：打开那个快捷操作的运行页面，和点运行卡片一样直接开始（D-108）。

/** 菜单里的项：快捷操作的 ID、名字和 iOS 的系统图标。 */
export function homeScreenEntries(config: WorkspaceConfig): HomeScreenEntry[] {
  return homeScreenItems(config).map((item) => {
    const symbol = iosSymbolName(item.icon);
    return { id: item.workflowId, title: item.title, ...(symbol ? { symbol } : {}) };
  });
}

/** 菜单的内容变了就整份换掉（只看放到桌面的快捷操作的 ID、名字、图标）。 */
export function useHomeScreenSync(platform: HomeScreenPlatform | null) {
  const { locale } = useWorkspaceContext();
  const key = useWorkspace((s) => (s.config ? JSON.stringify(homeScreenEntries(s.config)) : null));
  useEffect(() => {
    if (!platform || key === null) return;
    platform
      .setItems(JSON.parse(key) as HomeScreenEntry[], t(locale, 'homeScreenGone'))
      .catch(() => undefined);
  }, [platform, key, locale]);
}

/**
 * 从桌面打开（冷启动或 App 开着）：去那个快捷操作的运行页面。草稿开着时先离开草稿（草稿保留，D-190），
 * 运行页面用的是正式版本里的快捷操作。
 */
export function useHomeScreenOpen(platform: HomeScreenPlatform | null) {
  const router = useRouter();
  const { store } = useWorkspaceContext();
  useEffect(() => {
    if (!platform) return;
    const open = (workflowId: string) => {
      if (store.getState().draft?.open) store.getState().closeDraft();
      router.push({ pathname: '/run/[workflowId]', params: { workflowId } });
    };
    // 冷启动：导航器和首页刚挂上，下一轮再打开，运行页面叠在首页上（关掉回到首页）。
    const launched = platform.takeLaunched();
    const timer = launched ? setTimeout(() => open(launched), 0) : undefined;
    const unsubscribe = platform.onOpen(open);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);
}

/** 放在根布局里：同步菜单、处理从桌面打开。 */
export function HomeScreenBridge({ platform }: { platform: HomeScreenPlatform | null }) {
  useHomeScreenSync(platform);
  useHomeScreenOpen(platform);
  return null;
}
