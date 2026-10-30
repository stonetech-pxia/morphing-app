import MorphWidgets from '../../modules/morph-widgets';
import type { WidgetPlatform } from './types';

/** 本地模块 MorphWidgets（D-321）；Expo Go、Web 和测试里没有，返回 null（不写画面、不显示放到桌面的步骤）。 */
export const nativeWidgets: WidgetPlatform | null = MorphWidgets
  ? {
      setSnapshot: (json) => MorphWidgets!.setSnapshot(json),
      takeQueue: () => MorphWidgets!.takeQueue(),
      canPin: () => MorphWidgets!.canPin(),
      pin: (itemId, label) => MorphWidgets!.pin(itemId, label),
      onQueue: (listener) => {
        const sub = MorphWidgets!.addListener('onQueue', listener);
        return () => sub.remove();
      },
    }
  : null;
