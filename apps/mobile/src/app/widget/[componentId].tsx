import {
  allComponents,
  componentTarget,
  createPrefill,
  isKnownComponent,
  isRecordToolUse,
  recordToolOf,
  type OpenTarget,
} from '@morph/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useNavigate } from '@/shell/navigation';
import { useCalendar, useWorkspace } from '@/workspace/context';

/**
 * 点了桌面小组件（D-321）：打开组件所在的页面；按钮打开它指向的地方，打开表单的「添加」按钮打开新记录的表单
 * （预设值先填好，Q6）。这一页本身不显示，
 * 先退回去，再像点了页面上的入口一样打开。组件已经不在了就停在首页。
 */
export default function WidgetRoute() {
  const { componentId } = useLocalSearchParams<{ componentId: string }>();
  const config = useWorkspace((s) => s.config)!;
  const router = useRouter();
  const navigate = useNavigate();
  const cal = useCalendar();
  useEffect(() => {
    let target: OpenTarget | null = null;
    let form: { collectionId: string; prefill: string } | null = null;
    for (const page of config.containers.pages) {
      const c = allComponents(page).find((x) => x.id === componentId);
      if (!c) continue;
      const button = isKnownComponent(c) && c.look === 'button' ? c : null;
      const use = button?.tools?.[0];
      const tool = use && isRecordToolUse(use) ? recordToolOf(use) : null;
      if (tool?.do === 'create' && tool.ask !== undefined)
        form = {
          collectionId: tool.table,
          prefill: JSON.stringify(createPrefill(tool, { config, now: new Date(), cal })),
        };
      target = (button ? componentTarget(button) : null) ?? `page:${page.id}`;
      break;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
    if (form) {
      const params = form;
      setTimeout(() => router.push({ pathname: '/record/[collectionId]', params }), 0);
    } else if (target) {
      const to = target;
      setTimeout(() => navigate(to), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId]);
  return null;
}
