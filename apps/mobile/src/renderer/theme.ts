import {
  AURORA_ALPHA,
  GLASS_OPACITY,
  backdropStops,
  chromeStops,
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
  /** 毛玻璃卡片：卡片里要再铺一层 GlassFill。 */
  glass: boolean;
  /** 主题设了渐变 / 极光页面背景。 */
  hasBackdrop: boolean;
  /** 页面根容器的背景（底色 + 渐变）。 */
  backdrop: ViewStyle;
  /** 底部导航栏的底色（毛玻璃主题下半透明）。 */
  barBackground: string;
}

const DENSITY = {
  compact: { pad: 14, gap: 8 },
  comfortable: { pad: 20, gap: 14 },
  spacious: { pad: 24, gap: 20 },
} as const;

/** 页面背景的 CSS 渐变（RN 的 backgroundImage）；色标和校验器用的是同一组颜色。 */
function backdropImage(theme: Theme, c: ResolvedColors): string | undefined {
  const stops = backdropStops(theme, c);
  if (theme.backdrop === 'gradient') {
    return `linear-gradient(170deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 100%)`;
  }
  if (theme.backdrop === 'aurora') {
    // 三团光：主色在左上、辅助色在右侧、第三色在底部；边缘渐隐到同色的全透明，避免发灰。
    const alpha = c.dark ? AURORA_ALPHA.dark : AURORA_ALPHA.light;
    const blob = (color: string, at: string, size: number) =>
      `radial-gradient(circle at ${at}, ${rgba(color, alpha)} 0%, ${rgba(color, 0)} ${size}%)`;
    return [
      blob(c.primary, '12% 8%', 60),
      blob(c.secondary, '95% 35%', 55),
      blob(c.tertiary, '35% 100%', 65),
    ].join(', ');
  }
  return undefined;
}

export function makePalette(theme: Theme, systemDark: boolean): Palette {
  const colors = resolveColors(theme, isDark(theme, systemDark));
  const radius = theme.radius;
  const image = backdropImage(theme, colors);
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
    glass: theme.cardStyle === 'glass',
    hasBackdrop: image !== undefined,
    barBackground:
      theme.cardStyle === 'glass' ? rgba(colors.surface, GLASS_OPACITY) : colors.surface,
    backdrop: image
      ? { backgroundColor: colors.background, backgroundImage: image }
      : { backgroundColor: colors.background },
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
      if (theme.cardStyle === 'glass') {
        // 半透明底色 + 细亮边；模糊由卡片里的 GlassFill 提供（iOS 26 原生玻璃，否则 BlurView）。
        return {
          ...base,
          backgroundColor: rgba(background, GLASS_OPACITY),
          borderWidth: 1,
          borderColor: rgba('#FFFFFF', colors.dark ? 0.16 : 0.6),
          overflow: 'hidden',
        };
      }
      if (theme.cardStyle === 'glow') {
        return {
          ...base,
          borderWidth: 1,
          borderColor: rgba(colors.primary, 0.7),
          boxShadow: `0px 0px 18px ${rgba(colors.primary, colors.dark ? 0.6 : 0.35)}`,
        };
      }
      if (theme.cardStyle === 'chrome') {
        // 金属：上亮下暗、中段由亮转暗，顶边一条高光。
        const [top, mid, low, bottom] = chromeStops(background, colors.dark);
        return {
          ...base,
          backgroundImage: `linear-gradient(180deg, ${top} 0%, ${mid} 42%, ${low} 60%, ${bottom} 100%)`,
          borderWidth: 1,
          borderColor: mix(background, '#000000', colors.dark ? 0.45 : 0.3),
          boxShadow: [
            `inset 0px 1px 0px ${rgba('#FFFFFF', colors.dark ? 0.25 : 0.9)}`,
            `0px 4px 10px ${rgba(colors.dark ? '#000000' : colors.shadow, colors.dark ? 0.5 : 0.2)}`,
          ].join(', '),
        };
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

/**
 * 图标块的颜色（D-230）：主题设了 iconStyle 时所有图标块都跟着它，没设时用组件自己的默认。
 * solid = 实色底、白图标；tint = 浅色底、彩色图标（卡片本身有底色时用卡片色系的强调色）。
 */
export function iconColors(
  palette: Palette,
  fallback: 'solid' | 'tint',
  tone?: ComponentStyle['tone'],
) {
  const colors = cardColors(palette, tone);
  if ((palette.theme.iconStyle ?? fallback) === 'solid') {
    return { background: colors.accent, color: colors.on };
  }
  return !tone || tone === 'default'
    ? { background: palette.primaryTint, color: palette.primaryText }
    : { background: palette.surface, color: colors.accent };
}
