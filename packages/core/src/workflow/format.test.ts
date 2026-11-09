import { describe, expect, it } from 'vitest';

import { registry } from '../test-helpers';
import { describeParams, stepLabel } from './format';

const now = new Date(2026, 10, 9, 12);
const action = (id: string) => registry.actions.get(id)!;

describe('describeParams', () => {
  // 2026-11-09 用户测试：首页卡片写成「If it cannot get that small Ask me」，像半句话。
  it('a choice reads as "label: option" in every language', () => {
    const params = { maxMB: 2, whenTooBig: 'ask' };
    expect(describeParams(action('pdf.compress'), params, 'en', now, ['whenTooBig'])).toBe(
      'If it cannot get that small: Ask me',
    );
    expect(describeParams(action('pdf.compress'), params, 'zh', now, ['whenTooBig'])).toBe(
      '压不到时：问我',
    );
    expect(describeParams(action('pdf.compress'), params, 'fr', now, ['whenTooBig'])).toBe(
      'Si la taille ne peut pas être atteinte : Me demander',
    );
  });

  it('numbers keep reading as one phrase', () => {
    expect(describeParams(action('pdf.compress'), { maxMB: 2 }, 'en', now, ['maxMB'])).toBe(
      'At most 2 MB',
    );
  });
});

describe('stepLabel', () => {
  // 2026-11-09 用户测试：「扫描成 PDF」第一步叫「Choose photos」，打开的却是相机。
  it('choosing photos is named after where they come from', () => {
    const photos = action('in.photos');
    expect(stepLabel(photos, { source: 'library', min: 1, max: 20 }, 'en')).toBe('Choose photos');
    expect(stepLabel(photos, { source: 'files', min: 1, max: 20 }, 'en')).toBe('Choose photos');
    expect(stepLabel(photos, { source: 'camera', min: 1, max: 20 }, 'en')).toBe('Take photos');
    expect(stepLabel(photos, { source: 'scanner', min: 1, max: 20 }, 'en')).toBe('Scan documents');
    expect(stepLabel(photos, { source: 'scanner', min: 1, max: 20 }, 'zh')).toBe('扫描文档');
    expect(stepLabel(photos, { source: 'camera', min: 1, max: 20 }, 'fr')).toBe(
      'Prendre des photos',
    );
  });

  it('other actions keep their own name; an unknown action shows nothing', () => {
    expect(stepLabel(action('pdf.compress'), { maxMB: 2 }, 'en')).toBe('Make PDF smaller');
    expect(stepLabel(undefined, {}, 'en')).toBeUndefined();
  });
});
