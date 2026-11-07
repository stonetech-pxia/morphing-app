import { appTarget } from '@morph/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useNavigate } from '@/shell/navigation';

/**
 * morph://app/<id>（D-485）：直接打开一个 App。iOS 用户可以在「快捷指令」里做一个打开这个地址的桌面图标；
 * 小组件、通知也可以用。这一页本身不显示，先退回去，再像点了主页上的入口一样进那个 App；
 * App 已经不在了就停在首页。
 */
export default function OpenAppRoute() {
  const { appId } = useLocalSearchParams<{ appId: string }>();
  const router = useRouter();
  const navigate = useNavigate();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
    setTimeout(() => navigate(appTarget(appId)), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);
  return null;
}
