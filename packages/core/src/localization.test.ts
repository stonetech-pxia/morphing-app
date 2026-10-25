import { describe, expect, it } from 'vitest';
import { localize } from './localization';
import { t } from './messages';

describe('localization compatibility', () => {
  it('uses English for a downloaded catalog entry without French', () => {
    expect(localize({ en: 'Downloaded tool', zh: '下载工具' }, 'fr')).toBe('Downloaded tool');
    expect(localize(undefined, 'fr')).toBeUndefined();
  });
  it('keeps empty optional copy and localizes lists without changing their shape', () => {
    expect(localize({ en: 'Hint', zh: '提示', fr: '' }, 'fr')).toBe('');
    expect(localize({ en: ['Run'], zh: ['运行'], fr: ['Exécuter'] }, 'fr')).toEqual(['Exécuter']);
  });
  it('interpolates user text literally, including dollar signs and braces', () => {
    expect(t('en', 'runError_unexpected', { detail: '$& {name}' })).toContain('$& {name}');
  });
});
