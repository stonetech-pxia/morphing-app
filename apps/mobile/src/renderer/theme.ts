import {
  isDark,
  mix,
  resolveColors,
  type ComponentStyle,
  type ResolvedColors,
  type Theme,
} from '@morph/core';
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

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
      // 下面三种用 boxShadow（新架构自带）：旧的 shadow* 属性做不出硬阴影、多层阴影和内阴影。
      if (theme.cardStyle === 'brutal') {
        return {
          ...base,
          borderWidth: 2,
          borderColor: colors.text,
          boxShadow: `4px 4px 0px ${colors.text}`,
        };
      }
      if (theme.cardStyle === 'soft') {
        // 新拟物：左上亮、右下暗，卡片和背景同色时最像。
        const light = colors.dark ? rgba('#FFFFFF', 0.06) : mix(colors.background, '#FFFFFF', 0.8);
        const dark = rgba(colors.dark ? '#000000' : colors.shadow, colors.dark ? 0.6 : 0.16);
        return { ...base, boxShadow: `-5px -5px 12px ${light}, 6px 6px 14px ${dark}` };
      }
      if (theme.cardStyle === 'puffy') {
        // 黏土：外面一层柔和阴影，里面上亮下暗的内阴影让卡片像鼓起来。
        return {
          ...base,
          boxShadow: [
            `0px 12px 24px ${rgba(colors.shadow, colors.dark ? 0.45 : 0.16)}`,
            `inset 0px 6px 10px ${rgba('#FFFFFF', colors.dark ? 0.08 : 0.7)}`,
            `inset 0px -6px 12px ${rgba('#000000', colors.dark ? 0.3 : 0.08)}`,
          ].join(', '),
        };
      }
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

/** 卡片类组件的 tone 是底色；图标块使用同一色系的强调色。 */
export function cardColors(palette: Palette, tone: ComponentStyle['tone']) {
  switch (tone) {
    case 'primary':
      return { background: palette.primaryTint, accent: palette.primary, on: palette.onPrimary };
    case 'secondary':
      return { background: palette.secondaryTint, accent: palette.secondary, on: '#FFFFFF' };
    case 'tertiary':
      return { background: palette.tertiaryTint, accent: palette.tertiary, on: '#FFFFFF' };
    case 'muted':
      return { background: palette.background, accent: palette.caption, on: palette.surface };
    default:
      return { background: palette.surface, accent: palette.primary, on: palette.onPrimary };
  }
}
