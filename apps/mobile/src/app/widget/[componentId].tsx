import { allComponents, componentTarget, type OpenTarget } from '@morph/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useNavigate } from '@/shell/navigation';
import { useWorkspace } from '@/workspace/context';

/**
 * 点了桌面小组件（D-321）：打开组件所在的页面；按钮打开它指向的地方。这一页本身不显示，
 * 先退回去，再像点了页面上的入口一样打开。组件已经不在了就停在首页。
 */
export default function WidgetRoute() {
  const { componentId } = useLocalSearchParams<{ componentId: string }>();
  const config = useWorkspace((s) => s.config)!;
  const router = useRouter();
  const navigate = useNavigate();
  useEffect(() => {
    let target: OpenTarget | null = null;
    for (const page of config.pages) {
      const c = allComponents(page).find((x) => x.id === componentId);
      if (!c) continue;
      target = (c.type === 'button' ? componentTarget(c) : null) ?? `page:${page.id}`;
      break;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
    if (target) {
      const to = target;
      setTimeout(() => navigate(to), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId]);
  return null;
}
