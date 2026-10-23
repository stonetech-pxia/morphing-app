import type { Theme } from './schema';

// 默认风格「Clay」（来自 Docudis 的设计 token：沙色背景、奶油卡片、陶土橙主色、鼠尾草绿次色），
// 以及根据主题计算最终配色的纯函数。App 渲染和校验器（对比度检查）共用这里的结果。

export const CLAY = {
  primary: '#C8623A',
  light: {
    background: '#F5EFE8',
    surface: '#FFFCF8',
    text: '#2A2420',
    muted: '#6B5F55',
    caption: '#8A7B6F',
    border: '#E8DFD4',
    secondary: '#6B7F62',
    tertiary: '#B8926A',
    danger: '#B03A2E',
    shadow: '#785A3C',
  },
  // Docudis 只有浅色；深色是按同一色相推出的暖棕色版本。
  dark: {
    background: '#1C1815',
    surface: '#28221E',
    text: '#F3ECE4',
    muted: '#C2B5A9',
    caption: '#9C8F84',
    border: '#3B332D',
    secondary: '#8FA585',
    tertiary: '#C9A57F',
    danger: '#E0786B',
    shadow: '#000000',
  },
} as const;

export const DEFAULT_THEME: Theme = {
  primaryColor: CLAY.primary,
  mode: 'light',
  colors: {},
  font: 'clay',
  fontScale: 1,
  radius: 22,
  density: 'comfortable',
  cardStyle: 'shadow',
  navStyle: 'iconLabel',
};

export interface ResolvedColors {
  dark: boolean;
  background: string;
  surface: string;
  text: string;
  muted: string;
  caption: string;
  border: string;
  primary: string;
  /** 主色上的文字颜色（黑或白，取对比度高的一个）。 */
  onPrimary: string;
  /** 用作文字（链接、选中的导航项）时的主色；在背景上不够清楚时会自动调深或调浅。 */
  primaryText: string;
  primaryTint: string;
  secondary: string;
  secondaryTint: string;
  onSecondaryTint: string;
  tertiary: string;
  tertiaryTint: string;
  onTertiaryTint: string;
  danger: string;
  shadow: string;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: number[]) =>
  `#${[r, g, b].map((v) => Math.round(v!).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** 按比例 t（0 = a，1 = b）混合两种颜色。 */
export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex(ca.map((v, i) => v + (cb[i]! - v) * t));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 对比度（1–21）。 */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** 让 color 在 background 上达到 min 对比度：逐步向 toward 混合。 */
function readable(color: string, background: string, toward: string, min: number): string {
  for (let t = 0; t <= 1; t += 0.1) {
    const c = t === 0 ? color : mix(color, toward, t);
    if (contrast(c, background) >= min) return c;
  }
  return toward;
}

export function isDark(theme: Theme, systemDark: boolean): boolean {
  return theme.mode === 'dark' || (theme.mode === 'system' && systemDark);
}

export function resolveColors(theme: Theme, dark: boolean): ResolvedColors {
  const base = dark ? CLAY.dark : CLAY.light;
  // 深色模式：darkColors 优先，没设置的颜色沿用 colors（旧主题只有 colors，行为不变）。
  const o = dark ? { ...theme.colors, ...theme.darkColors } : theme.colors;
  const background = o.background ?? base.background;
  const surface = o.surface ?? base.surface;
  const text = o.text ?? base.text;
  const secondary = o.secondary ?? base.secondary;
  const tertiary = o.tertiary ?? base.tertiary;
  const primary = theme.primaryColor;
  const tintAmount = dark ? 0.78 : 0.82;
  const custom = Boolean(o.text || o.surface || o.background);
  return {
    dark,
    background,
    surface,
    text,
    muted: o.text || o.surface ? mix(text, surface, 0.3) : base.muted,
    caption: o.text || o.surface ? mix(text, surface, 0.45) : base.caption,
    border: o.text || o.surface ? mix(surface, text, 0.12) : base.border,
    primary,
    onPrimary: contrast('#FFFFFF', primary) >= 3 ? '#FFFFFF' : '#1A1714',
    primaryText: readable(primary, surface, text, 3),
    primaryTint: mix(primary, surface, tintAmount),
    secondary,
    secondaryTint: mix(secondary, surface, tintAmount),
    onSecondaryTint: readable(secondary, mix(secondary, surface, tintAmount), text, 4.5),
    tertiary,
    tertiaryTint: mix(tertiary, surface, tintAmount),
    onTertiaryTint: readable(tertiary, mix(tertiary, surface, tintAmount), text, 4.5),
    danger: base.danger,
    // 浅色模式下 Clay 的暖棕阴影只适合 Clay 配色；换了配色时阴影用正文色，色相跟着主题走。
    shadow: custom && !dark ? text : base.shadow,
  };
}

/** 毛玻璃卡片里卡片色的比例，其余透出页面背景（对比度检查按这个比例估算卡片的实际颜色）。 */
export const GLASS_OPACITY = 0.4;

/** 极光背景里每团颜色中心的不透明度。 */
export const AURORA_ALPHA = { light: 0.45, dark: 0.5 } as const;

/**
 * 页面背景上出现的颜色（不透明值）。渲染器按它们画渐变，校验器检查文字压在上面是否清楚。
 * gradient：主色淡色 → 背景色 → 辅助色淡色；aurora：主色、辅助色、第三色三团光的中心色。
 */
export function backdropStops(theme: Theme, c: ResolvedColors): string[] {
  switch (theme.backdrop) {
    case 'gradient':
      return [
        mix(c.background, c.primary, 0.3),
        c.background,
        mix(c.background, c.secondary, 0.25),
      ];
    case 'aurora': {
      const alpha = c.dark ? AURORA_ALPHA.dark : AURORA_ALPHA.light;
      return [c.primary, c.secondary, c.tertiary].map((x) => mix(c.background, x, alpha));
    }
    default:
      return [c.background];
  }
}

/** 金属卡片的四个色标（上亮、中段由亮转暗、下面反光），从卡片底色算出。 */
export function chromeStops(base: string, dark: boolean): [string, string, string, string] {
  return [
    mix(base, '#FFFFFF', dark ? 0.2 : 0.65),
    base,
    mix(base, '#000000', dark ? 0.25 : 0.14),
    mix(base, '#FFFFFF', dark ? 0.1 : 0.35),
  ];
}

export const MIN_TEXT_CONTRAST = 4.5;

/** 正文可能直接压在上面的颜色：背景、卡片，以及渐变背景、毛玻璃和金属卡片实际呈现的颜色。 */
function textSurfaces(theme: Theme, c: ResolvedColors): [string, string][] {
  const surfaces: [string, string][] = [
    ['background', c.background],
    ['surface', c.surface],
  ];
  const stops = backdropStops(theme, c);
  if (theme.backdrop && theme.backdrop !== 'plain') {
    stops.forEach((color, i) => surfaces.push([`backdrop color ${i + 1}`, color]));
  }
  if (theme.cardStyle === 'glass') {
    stops.forEach((color, i) =>
      surfaces.push([
        `glass card over backdrop color ${i + 1}`,
        mix(color, c.surface, GLASS_OPACITY),
      ]),
    );
  }
  if (theme.cardStyle === 'chrome') {
    chromeStops(c.surface, c.dark).forEach((color, i) =>
      surfaces.push([`chrome card shade ${i + 1}`, color]),
    );
  }
  return surfaces;
}

/**
 * 可读性检查：正文在背景、卡片（含渐变背景、毛玻璃和金属卡片的实际颜色）上的对比度必须达到 WCAG AA。
 * 返回不满足的组合；主题可能显示为浅色或深色时两种都检查。
 */
export function contrastProblems(theme: Theme): string[] {
  const modes = theme.mode === 'system' ? [false, true] : [theme.mode === 'dark'];
  const problems: string[] = [];
  for (const dark of modes) {
    const c = resolveColors(theme, dark);
    for (const [name, bg] of textSurfaces(theme, c)) {
      const ratio = contrast(c.text, bg);
      if (ratio < MIN_TEXT_CONTRAST) {
        problems.push(
          `text ${c.text} on ${name} ${bg} has contrast ${ratio.toFixed(1)} (needs ${MIN_TEXT_CONTRAST}) in ${dark ? 'dark' : 'light'} mode`,
        );
      }
    }
  }
  return problems;
}
