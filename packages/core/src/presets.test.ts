import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { THEME_PRESETS, THEME_PRESET_IDS, presetOfTheme } from './presets';
import { ThemeSchema } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { contrastProblems, resolveColors } from './theme';
import { validateWorkspace } from './validate';

describe('theme presets', () => {
  it.each(THEME_PRESET_IDS)('%s is a valid, readable theme', (id) => {
    const { theme } = THEME_PRESETS[id];
    expect(ThemeSchema.safeParse(theme).success).toBe(true);
    expect(contrastProblems(theme)).toEqual([]);
  });

  it.each(THEME_PRESET_IDS)('%s applies as a whole and passes validation', (id) => {
    const after = apply(workspace(), [{ op: 'applyThemePreset', preset: id }]);
    expect(after.theme).toEqual(THEME_PRESETS[id].theme);
    expect(validateWorkspace(after, registry).ok).toBe(true);
  });

  it('presets that follow the system have their own dark colors', () => {
    for (const id of THEME_PRESET_IDS) {
      const { theme } = THEME_PRESETS[id];
      if (theme.mode !== 'system') continue;
      expect(resolveColors(theme, true).background).not.toBe(
        resolveColors(theme, false).background,
      );
    }
  });

  it('can be tweaked afterwards and described', () => {
    const result = prepareOps(
      workspace(),
      [
        { op: 'applyThemePreset', preset: 'neon' },
        { op: 'setTheme', primaryColor: '#F472B6' },
      ],
      { registry, locale: 'zh', now: new Date(2026, 9, 22) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.theme).toEqual({ ...THEME_PRESETS.neon.theme, primaryColor: '#F472B6' });
    expect(result.lines).toEqual([
      '样式换成「赛博霓虹」风格（颜色、字体、圆角、卡片和背景）',
      '主题色改为 #F472B6',
    ]);
  });
});

describe('presetOfTheme', () => {
  it.each(THEME_PRESET_IDS)('recognises %s after it is applied', (id) => {
    expect(presetOfTheme(apply(workspace(), [{ op: 'applyThemePreset', preset: id }]).theme)).toBe(
      id,
    );
  });

  it('a tweaked preset or the default theme matches none', () => {
    const tweaked = apply(workspace(), [
      { op: 'applyThemePreset', preset: 'neon' },
      { op: 'setTheme', radius: 4 },
    ]);
    expect(presetOfTheme(tweaked.theme)).toBeNull();
    expect(presetOfTheme(workspace().theme)).toBeNull();
  });
});
