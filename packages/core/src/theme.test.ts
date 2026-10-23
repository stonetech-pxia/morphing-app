import { describe, expect, it } from 'vitest';

import {
  CLAY,
  DEFAULT_THEME,
  backdropStops,
  chromeStops,
  contrastProblems,
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
});
