import { describe, expect, it } from 'vitest';

import { CLAY, DEFAULT_THEME, contrastProblems, resolveColors } from './theme';

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

describe('contrastProblems', () => {
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
