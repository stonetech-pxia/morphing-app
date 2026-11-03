import { describe, expect, it } from 'vitest';

import { ThemeSchema } from './schema-base';
import {
  CLAY,
  DEFAULT_THEME,
  backdropStops,
  chromeStops,
  contrast,
  contrastProblems,
  resolveSurfaceColors,
  mix,
  resolveColors,
} from './theme';

describe('resolveColors', () => {
  it('keeps the Clay palette, including its warm shadow, when nothing is overridden', () => {
    expect(resolveColors(DEFAULT_THEME, false).shadow).toBe(CLAY.light.shadow);
    expect(resolveColors(DEFAULT_THEME, true).background).toBe(CLAY.dark.background);
  });

  it('uses darkColors in dark mode and falls back to colors for the rest', () => {
    const theme = {
      ...DEFAULT_THEME,
      mode: 'system' as const,
      colors: { background: '#FFF8E7', secondary: '#16A34A' },
      darkColors: { background: '#111111', surface: '#1C1C1C', text: '#F5F5F5' },
    };
    const light = resolveColors(theme, false);
    const dark = resolveColors(theme, true);
    expect(light.background).toBe('#FFF8E7');
    expect(dark.background).toBe('#111111');
    expect(dark.surface).toBe('#1C1C1C');
    expect(dark.secondary).toBe('#16A34A');
  });

  it('old themes with only colors look the same in dark mode as before', () => {
    const theme = { ...DEFAULT_THEME, colors: { background: '#FFFFFF' } };
    expect(resolveColors(theme, true).background).toBe('#FFFFFF');
  });

  it('lets the theme set the tertiary color', () => {
    const c = resolveColors({ ...DEFAULT_THEME, colors: { tertiary: '#3B82F6' } }, false);
    expect(c.tertiary).toBe('#3B82F6');
    expect(c.tertiaryTint).not.toBe(resolveColors(DEFAULT_THEME, false).tertiaryTint);
  });

  it('takes the shadow from the text color once the palette is customised', () => {
    const theme = { ...DEFAULT_THEME, colors: { background: '#F2F2F7', text: '#111827' } };
    expect(resolveColors(theme, false).shadow).toBe('#111827');
    expect(resolveColors(theme, true).shadow).toBe(CLAY.dark.shadow);
  });
});

describe('backdropStops', () => {
  it('plain backgrounds only use the background color', () => {
    const c = resolveColors(DEFAULT_THEME, false);
    expect(backdropStops(DEFAULT_THEME, c)).toEqual([c.background]);
  });

  it('gradient and aurora are derived from the palette, so dark mode follows along', () => {
    const theme = { ...DEFAULT_THEME, mode: 'system' as const, backdrop: 'aurora' as const };
    const light = resolveColors(theme, false);
    const dark = resolveColors(theme, true);
    expect(backdropStops(theme, light)[0]).toBe(mix(light.background, light.primary, 0.45));
    expect(backdropStops(theme, dark)[0]).toBe(mix(dark.background, dark.primary, 0.5));
    const gradient = { ...DEFAULT_THEME, backdrop: 'gradient' as const };
    expect(backdropStops(gradient, light)).toHaveLength(3);
  });

  it('chrome shades get lighter at the top and darker in the middle', () => {
    const [top, mid, low] = chromeStops('#C0C7D1', false);
    expect(top).not.toBe(mid);
    expect(low).toBe(mix('#C0C7D1', '#000000', 0.14));
  });
});

describe('contrastProblems', () => {
  it('checks text on the aurora, under glass cards and on chrome cards', () => {
    // 深色模式下浅色文字压在亮黄色的极光上看不清。
    const aurora = {
      ...DEFAULT_THEME,
      mode: 'dark' as const,
      primaryColor: '#FFE066',
      backdrop: 'aurora' as const,
    };
    expect(contrastProblems(aurora).join('\n')).toMatch(/backdrop color 1/);
    expect(contrastProblems({ ...aurora, backdrop: 'plain' })).toEqual([]);
    // 中灰正文在白背景和黑卡片上都够清楚，但毛玻璃把两者混成灰色就不行了。
    const grey = {
      ...DEFAULT_THEME,
      primaryColor: '#FFFFFF',
      backdrop: 'gradient' as const,
      colors: { background: '#FFFFFF', surface: '#000000', text: '#767676', secondary: '#FFFFFF' },
    };
    expect(contrastProblems(grey)).toEqual([]);
    expect(contrastProblems({ ...grey, cardStyle: 'glass' }).join('\n')).toMatch(
      /glass card over backdrop color/,
    );
    // 金属卡片的暗部要看得清正文。
    const chrome = {
      ...DEFAULT_THEME,
      cardStyle: 'chrome' as const,
      colors: { surface: '#7A7F87', text: '#1A1A1A', background: '#FFFFFF' },
    };
    expect(contrastProblems(chrome).join('\n')).toMatch(/chrome card shade/);
    expect(
      contrastProblems({ ...chrome, colors: { ...chrome.colors, surface: '#D9DEE5' } }),
    ).toEqual([]);
  });

  it('checks the dark-mode colors when the theme follows the system', () => {
    const theme = {
      ...DEFAULT_THEME,
      mode: 'system' as const,
      darkColors: { background: '#111111', surface: '#1C1C1C', text: '#333333' },
    };
    expect(contrastProblems(theme).join('\n')).toMatch(/dark mode/);
    expect(contrastProblems({ ...theme, mode: 'light' })).toEqual([]);
  });

  // D-409：深色页面配浅色卡片。text 只管页面，surfaceText 管卡片。
  const forest = {
    ...DEFAULT_THEME,
    colors: {
      background: '#0B3D2E',
      surface: '#F5EFE0',
      text: '#F5EFE0',
      surfaceText: '#2A2420',
    },
  };

  it('accepts a dark page with light cards when the cards have their own text color', () => {
    expect(contrastProblems(forest)).toEqual([]);
    // 没有 surfaceText 时同样的配色过不了。
    const { surfaceText: _, ...one } = forest.colors;
    expect(contrastProblems({ ...forest, colors: one }).join('\n')).toMatch(/on surface/);
  });

  it('the theme schema takes surfaceText and leaves old themes as they were', () => {
    expect(ThemeSchema.parse(forest)).toEqual(forest);
    expect(ThemeSchema.parse(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
    expect(ThemeSchema.safeParse({ ...forest, colors: { surfaceText: 'dark' } }).success).toBe(
      false,
    );
  });

  it('rejects a surfaceText that is hard to read on the cards', () => {
    const faint = { ...forest, colors: { ...forest.colors, surfaceText: '#D8D0C0' } };
    expect(contrastProblems(faint).join('\n')).toMatch(/surfaceText #D8D0C0 on surface/);
  });

  it('still checks text on the page when surfaceText is set', () => {
    const dim = { ...forest, colors: { ...forest.colors, text: '#1F4F40' } };
    expect(contrastProblems(dim).join('\n')).toMatch(/text #1F4F40 on background/);
  });

  it('checks surfaceText on glass and chrome cards, not text', () => {
    const chrome = {
      ...forest,
      cardStyle: 'chrome' as const,
      colors: { ...forest.colors, surface: '#7A7F87', surfaceText: '#3A3A3A' },
    };
    expect(contrastProblems(chrome).join('\n')).toMatch(/surfaceText #3A3A3A on chrome card/);
    const glass = { ...forest, cardStyle: 'glass' as const, backdrop: 'gradient' as const };
    expect(contrastProblems(glass).join('\n')).toMatch(/surfaceText #2A2420 on glass card/);
  });

  it('checks darkColors.surfaceText in dark mode', () => {
    const theme = {
      ...forest,
      mode: 'dark' as const,
      darkColors: { surface: '#E8E0D0', surfaceText: '#C8C0B0' },
    };
    expect(contrastProblems(theme).join('\n')).toMatch(/surfaceText #C8C0B0 on surface/);
  });
});

describe('surfaceText (D-409)', () => {
  const forest = {
    ...DEFAULT_THEME,
    colors: {
      background: '#0B3D2E',
      surface: '#F5EFE0',
      text: '#F5EFE0',
      surfaceText: '#2A2420',
    },
  };

  it('without it (or equal to text) the colors stay exactly as they were', () => {
    expect(resolveSurfaceColors(DEFAULT_THEME, false)).toBeUndefined();
    expect(resolveSurfaceColors(DEFAULT_THEME, true)).toBeUndefined();
    const same = { ...DEFAULT_THEME, colors: { text: '#111111', surfaceText: '#111111' } };
    expect(resolveSurfaceColors(same, false)).toBeUndefined();
    const { surfaceText: _, ...rest } = same.colors;
    expect(resolveColors(same, false)).toEqual(resolveColors({ ...same, colors: rest }, false));
  });

  it('secondary text on cards comes from surfaceText and stays readable', () => {
    const card = resolveSurfaceColors(forest, false)!;
    expect(card.surface).toBe('#F5EFE0');
    expect(card.text).toBe('#2A2420');
    expect(contrast(card.muted, card.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(card.caption, card.surface)).toBeGreaterThanOrEqual(3);
    // 卡片里凹下去的底色（tone muted、月历当天）上也看得清。
    expect(contrast(card.text, card.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(card.primaryText, card.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(card.onSecondaryTint, card.secondaryTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(card.danger, card.surface)).toBeGreaterThanOrEqual(3);
  });

  it('secondary text on the page comes from text and the background', () => {
    const page = resolveColors(forest, false);
    expect(page.text).toBe('#F5EFE0');
    expect(contrast(page.muted, page.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(page.caption, page.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(page.primaryText, page.background)).toBeGreaterThanOrEqual(3);
    // 还没换成卡片配色的系统页面（导航栏、弹窗）：text 压在它们的底色上也要清楚。
    expect(contrast(page.text, page.surface)).toBeGreaterThanOrEqual(4.5);
    // 删除、移除的红字压在这层底色上也要清楚。
    expect(contrast(page.danger, page.surface)).toBeGreaterThanOrEqual(3);
    expect(page.danger).not.toBe(CLAY.light.danger);
  });

  it('keeps the real surface for the page when text also reads on it', () => {
    const light = {
      ...DEFAULT_THEME,
      colors: {
        background: '#FFFFFF',
        surface: '#F0F0F0',
        text: '#222222',
        surfaceText: '#000000',
      },
    };
    expect(resolveColors(light, false).surface).toBe('#F0F0F0');
  });

  it('dark mode inherits surfaceText from colors, and darkColors can override it', () => {
    const theme = { ...forest, darkColors: { surfaceText: '#101010' } };
    expect(resolveSurfaceColors(forest, true)!.text).toBe('#2A2420');
    expect(resolveSurfaceColors(theme, true)!.text).toBe('#101010');
  });
});
