import { AppState } from 'react-native';

import MorphBackground from '../../modules/morph-background';
import type { BackgroundPlatform } from './platform';

// BackgroundPlatform 的实现：本地 Expo 模块 MorphBackground（D-160–D-163）。没有这个模块（Expo Go）时为 null。

export function expoBackground(): BackgroundPlatform | null {
  const native = MorphBackground;
  if (!native) return null;
  return {
    continuesInBackground: native.continuesInBackground,
    ensureNotificationPermission: () => native.ensureNotificationPermission().catch(() => false),
    begin: (title, text) => {
      try {
        return native.begin(title, text);
      } catch {
        return false;
      }
    },
    update: (text, fraction) => {
      try {
        native.update(text, fraction);
      } catch {
        // 通知改不了不影响任务。
      }
    },
    end: (done) => {
      try {
        native.end(done);
      } catch {
        // 同上。
      }
    },
    isForeground: () => AppState.currentState === 'active',
  };
}
