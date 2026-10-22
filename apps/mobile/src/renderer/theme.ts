import { isDark, resolveColors, type ResolvedColors, type Theme } from '@morph/core';
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

// 主题 token → 渲染用的颜色、字体和尺寸。颜色的计算在 core（校验器也要用）；这里只加上平台相关的部分。
// 默认风格 Clay 来自 Docudis：Sora 标题、Karla 正文、22pt 圆角、暖色柔和阴影。

export type FontRole = 'display' | 'heading' | 'title' | 'body' | 'bodyMedium' | 'bodyBold';

/** Clay 字体按字重分别注册（expo-google-fonts 的静态字体），不能再叠加 fontWeight。 */
export const CLAY_FONTS: Record<FontRole, string> = {
  display: 'Sora_700Bold',
  heading: 'Sora_700Bold',
  title: 'Sora_600SemiBold',
  body: 'Karla_400Regular',
  bodyMedium: 'Karla_500Medium',
  bodyBold: 'Karla_700Bold',
};

const WEIGHTS: Record<FontRole, TextStyle['fontWeight']> = {
  display: '700',
  heading: '700',
  title: '600',
  body: '400',
  bodyMedium: '500',
  bodyBold: '700',
};

const SERIF = Platform.select({ ios: 'Georgia', default: 'serif' });
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export interface Palette extends ResolvedColors {
  /** 旧名字，等同于 surface / muted。 */
  card: string;
  subtext: string;
  theme: Theme;
  radius: number;
  /** 按钮、输入框等控件的圆角。 */
  controlRadius: number;
  /** 页面边距和组件间距。 */
  pad: number;
  gap: number;
  /** 某个角色的字体，size 会乘以主题的字号比例。 */
  font(role: FontRole, size: number): TextStyle;
  /** 卡片的底色、边框和阴影。 */
  cardStyle(background?: string): ViewStyle;
}

const DENSITY = {
  compact: { pad: 14, gap: 8 },
  comfortable: { pad: 20, gap: 14 },
  spacious: { pad: 24, gap: 20 },
} as const;

export function makePalette(theme: Theme, systemDark: boolean): Palette {
  const colors = resolveColors(theme, isDark(theme, systemDark));
  const radius = theme.radius;
  const family = (role: FontRole): TextStyle => {
    switch (theme.font) {
      case 'clay':
        return { fontFamily: CLAY_FONTS[role] };
      case 'serif':
        return { fontFamily: SERIF, fontWeight: WEIGHTS[role] };
      case 'mono':
        return { fontFamily: MONO, fontWeight: WEIGHTS[role] };
      case 'system':
        return { fontWeight: WEIGHTS[role] };
    }
  };
  return {
    ...colors,
    card: colors.surface,
    subtext: colors.muted,
    theme,
    radius,
    controlRadius: Math.round(Math.min(radius, 16) * 0.9 + (radius > 0 ? 2 : 0)),
    ...DENSITY[theme.density],
    font: (role, size) => ({ ...family(role), fontSize: Math.round(size * theme.fontScale) }),
    cardStyle: (background = colors.surface) => {
      const base: ViewStyle = { backgroundColor: background, borderRadius: radius };
      if (theme.cardStyle === 'outline')
        return { ...base, borderWidth: 1, borderColor: colors.border };
      if (theme.cardStyle === 'flat') return base;
      return {
        ...base,
        shadowColor: colors.shadow,
        shadowOpacity: colors.dark ? 0.35 : 0.1,
        shadowRadius: 15,
        shadowOffset: { width: 0, height: 10 },
        elevation: 3,
      };
    },
  };
}

export function usePalette(theme: Theme): Palette {
  return makePalette(theme, useColorScheme() === 'dark');
}
