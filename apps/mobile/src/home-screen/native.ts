import MorphShortcuts from '../../modules/morph-shortcuts';
import type { HomeScreenPlatform } from './platform';

/** 本地模块 MorphShortcuts（D-269）；Expo Go、Web 和测试里没有，返回 null（不同步、不显示按钮）。 */
export const nativeHomeScreen: HomeScreenPlatform | null = MorphShortcuts
  ? {
      setItems: (items, disabledMessage) => MorphShortcuts!.setItems(items, disabledMessage),
      canPin: () => MorphShortcuts!.canPin(),
      pin: (item) => MorphShortcuts!.pin(item),
      takeLaunched: () => MorphShortcuts!.takeLaunched(),
      onOpen: (listener) => {
        const sub = MorphShortcuts!.addListener('onOpen', (e) => listener(e.id));
        return () => sub.remove();
      },
    }
  : null;
