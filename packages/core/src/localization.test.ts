import { templateOps } from './templates';
import { applyOps } from './ops';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';
import { speechLangFor } from './tools/audio';
import { OCR_LANGUAGES } from './packs';
import { SPEECH_LANGUAGES } from './speech';
import { TRANSLATE_LANGUAGES } from './tools/translate';
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

describe('French behavior', () => {
  it('uses French singular forms for zero and one, and English singular only for one', () => {
    expect(t('fr', 'shareSummary', { n: 0 })).toBe('0 fichier');
    expect(t('fr', 'shareSummary', { n: 1 })).toBe('1 fichier');
    expect(t('fr', 'shareSummary', { n: 2 })).toBe('2 fichiers');
    expect(t('en', 'shareSummary', { n: 0 })).toBe('0 files');
    expect(t('en', 'shareSummary', { n: 1 })).toBe('1 file');
    expect(t('fr', 'sharedFilesReceived', { n: 1 })).toBe('1 fichier reçu');
  });
  it('picks singular forms by the count variable each message uses', () => {
    expect(t('en', 'runError_tooFew', { min: 1 })).toBe('Choose at least 1 file.');
    expect(t('en', 'runError_tooFew', { min: 2 })).toBe('Choose at least 2 files.');
    expect(t('fr', 'recordCount', { count: 1 })).toBe('1 entrée');
    expect(t('fr', 'recordCount', { count: 0 })).toBe('0 entrée');
    expect(t('fr', 'recordCount', { count: 3 })).toBe('3 entrées');
    expect(t('en', 'shareUsed', { n: 1 })).toBe('Used 1 time');
    expect(t('en', 'RedactScreen_boxes_4d76c', { v0: 1 })).toBe('1 box');
  });
  it('does not group digits in French numbers', () => {
    expect(t('fr', 'shareSummary', { n: 12345 })).toBe('12345 fichiers');
  });
  // Hermes（App 的 JS 引擎）没有 Intl.PluralRules：t() 不能依赖它。
  it('works without Intl.PluralRules', () => {
    const intl = Intl as { PluralRules?: unknown };
    const saved = intl.PluralRules;
    delete intl.PluralRules;
    try {
      expect(t('en', 'shareSummary', { n: 1 })).toBe('1 file');
      expect(t('fr', 'shareSummary', { n: 2 })).toBe('2 fichiers');
      expect(t('zh', 'shareSummary', { n: 1 })).toBe('1 个文件');
    } finally {
      intl.PluralRules = saved;
    }
  });
});

describe('French tool configuration', () => {
  it('installs each tool with valid French pages and workflow names', () => {
    for (const tool of registry.tools.values()) {
      const result = applyOps(
        workspace('fr'),
        [{ op: 'setPackage', package: tool.id, do: 'add' }],
        {
          registry,
          locale: 'fr',
        },
      );
      expect(result.ok, tool.id).toBe(true);
      if (result.ok)
        expect(validateWorkspace(result.config, registry), tool.id).toMatchObject({ ok: true });
    }
  });
  it('offers French for speech, OCR and translation', () => {
    expect(speechLangFor('fr')).toBe('fr');
    expect(SPEECH_LANGUAGES).toContain('fr');
    expect(OCR_LANGUAGES).toContain('fra');
    expect(TRANSLATE_LANGUAGES).toContain('fr');
  });
});

it('uses EUR in the built-in French budget template', () => {
  const base = workspace('fr');
  const result = applyOps(base, templateOps('budget', base, 'fr'), { registry, locale: 'fr' });
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(
      result.config.data.tables.some((c) =>
        c.fields.some((f) => f.type === 'money' && f.currency === 'EUR'),
      ),
    ).toBe(true);
});
