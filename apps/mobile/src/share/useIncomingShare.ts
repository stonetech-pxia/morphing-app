import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { ShareIntentModule } from 'expo-share-intent';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { FilePlatform } from '../runtime/platform';
import { nativeCopies, normalizeShare, useIncoming } from './incoming';

// 接收别的 App 分享进来的文件（D-095）：iOS 是分享扩展 + App Group + 深链，Android 是 ACTION_SEND /
// ACTION_SEND_MULTIPLE。原生部分来自 expo-share-intent；Expo Go 和测试里没有这个模块，什么也不做。

/** 分享扩展存数据用的键：`<scheme>ShareKey`。 */
const SHARE_KEY = 'morphShareKey';

export const isShareLink = (url: string) => url.includes('dataUrl=');

/** 放在根布局里：收到文件就打开收件页面。不会自动运行任何工作流。 */
export function useIncomingShare(files: Pick<FilePlatform, 'removeShared'>) {
  const url = useLinkingURL();
  const router = useRouter();
  const receive = useIncoming((s) => s.receive);

  useEffect(() => {
    const native = ShareIntentModule;
    if (!native) return;
    const subscription = native.addListener('onChange', (event) => {
      const shared = normalizeShare(event.value);
      void native.clearShareIntent(SHARE_KEY);
      // 上一批没处理完的文件不再需要，只留这一批。Android 的副本按原文件名存，同名的已经是这一批的了。
      const copies = nativeCopies(event.value);
      const previous = (useIncoming.getState().share?.copies ?? []).filter(
        (uri) => !copies.includes(uri),
      );
      void files
        .removeShared(
          shared.map((f) => f.uri),
          previous,
        )
        .catch(() => undefined);
      receive(shared, copies);
      router.navigate('/share');
    });
    return () => subscription.remove();
  }, [files, receive, router]);

  useEffect(() => {
    const native = ShareIntentModule;
    if (!native) return;
    if (Platform.OS === 'ios') {
      if (url && isShareLink(url)) native.getShareIntent(url);
    } else if (Platform.OS === 'android') {
      // 冷启动时的分享在这里取；App 开着时原生模块收到新的 Intent 直接发 onChange。
      native.getShareIntent('');
    }
  }, [url]);
}
