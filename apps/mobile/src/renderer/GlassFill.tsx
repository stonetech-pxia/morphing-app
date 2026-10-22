import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, StyleSheet } from 'react-native';

import type { Palette } from './theme';

// 毛玻璃卡片的玻璃层，铺在卡片内容下面（D-064）。iOS 26 起用系统的 Liquid Glass；
// 更早的 iOS 用 BlurView。Android 的 BlurView 需要把背后的内容包进 BlurTargetView 才会真模糊，
// 卡片在滚动内容里、背景在它后面，包不了，所以 Android 只显示半透明卡片（cardStyle 里的底色）。

let liquid: boolean | undefined;
function liquidGlass(): boolean {
  if (liquid === undefined) {
    try {
      liquid = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
    } catch {
      liquid = false;
    }
  }
  return liquid;
}

export function GlassFill({ palette, radius }: { palette: Palette; radius?: number }) {
  if (!palette.glass || Platform.OS === 'android') return null;
  const style = [StyleSheet.absoluteFill, { borderRadius: radius ?? palette.radius }];
  if (liquidGlass()) {
    return (
      <GlassView
        pointerEvents="none"
        style={style}
        glassEffectStyle="regular"
        colorScheme={palette.dark ? 'dark' : 'light'}
      />
    );
  }
  return (
    <BlurView
      pointerEvents="none"
      style={[style, { overflow: 'hidden' }]}
      intensity={40}
      tint={palette.dark ? 'dark' : 'light'}
    />
  );
}
