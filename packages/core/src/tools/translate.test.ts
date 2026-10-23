import { describe, expect, it } from 'vitest';

import { registry } from '../test-helpers';
import { workflowProblems } from '../workflow/check';
import {
  TRANSLATE_LANGUAGES,
  fixCjkRadicals,
  groupBySource,
  joinTranslation,
  normalizeDetected,
  splitForTranslation,
  translateTool,
} from './translate';

const flat = (pieces: string[][][]) => pieces.flat(2);

describe('splitForTranslation', () => {
  it('joins the lines of a wrapped sentence and keeps paragraphs apart', () => {
    const text =
      'Dear Tenant,\n\nYour lease for the apartment at 12 Elm Street will\nexpire on April 15, 2026. Please let us know\nwhether you plan to renew it.\n\nThank you.';
    expect(splitForTranslation(text)).toEqual([
      [['Dear Tenant,']],
      [
        [
          'Your lease for the apartment at 12 Elm Street will expire on April 15, 2026. Please let us know whether you plan to renew it.',
        ],
      ],
      [['Thank you.']],
    ]);
  });

  it('keeps short lines, sentence ends and list items on their own lines', () => {
    const text =
      'Required documents\nPlease bring the following items to the office before the end of the month:\n1. Passport\n2. Two photos taken within the last six months\n- Bank statement';
    expect(splitForTranslation(text)[0]!.map((l) => l.join(''))).toEqual([
      'Required documents',
      'Please bring the following items to the office before the end of the month:',
      '1. Passport',
      '2. Two photos taken within the last six months',
      '- Bank statement',
    ]);
  });

  it('joins Chinese and Japanese lines without spaces and mends hyphenated words', () => {
    expect(
      flat(splitForTranslation('您的租约将于二〇二六年四月十五日到期，请于月底\n前告知是否续签。')),
    ).toEqual(['您的租约将于二〇二六年四月十五日到期，请于月底前告知是否续签。']);
    expect(
      flat(
        splitForTranslation('This agree-\nment is signed by both parties on the date below here.'),
      ),
    ).toEqual(['This agreement is signed by both parties on the date below here.']);
  });

  it('cuts a very long paragraph at sentence ends', () => {
    const sentence = 'This is one sentence of a long contract clause that keeps going. ';
    const pieces = splitForTranslation(sentence.repeat(60))[0]![0]!;
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= 1500 && p.endsWith('.'))).toBe(true);
    expect(pieces.join(' ')).toBe(sentence.repeat(60).trim());
  });
});

describe('joinTranslation', () => {
  it('puts lines and paragraphs back, gluing pieces by the target script', () => {
    const pieces = [[['尊敬的租户：']], [['第一句。', '第二句。'], ['谢谢']]];
    expect(joinTranslation(pieces, 'zh-Hans')).toBe('尊敬的租户：\n\n第一句。第二句。\n谢谢');
    expect(joinTranslation([[['One.', 'Two.']]], 'en')).toBe('One. Two.');
  });

  it('drops the space ML Kit leaves after Chinese punctuation', () => {
    expect(joinTranslation([[['房东周一检查公寓。 请把钥匙交给管理员。']]], 'zh-Hans')).toBe(
      '房东周一检查公寓。请把钥匙交给管理员。',
    );
    expect(joinTranslation([[['Hi. There.']]], 'en')).toBe('Hi. There.');
  });
});

describe('fixCjkRadicals', () => {
  it('turns Kangxi radicals from PDF text into ordinary characters, keeping full-width punctuation', () => {
    // 苹方生成的 PDF：⼗⼀⽉⼀⽇、⾄、⼋ 都是康熙部首。
    expect(fixCjkRadicals('从⼗⼀⽉⼀⽇起，周⼀⾄周五上午⼋点：')).toBe(
      '从十一月一日起，周一至周五上午八点：',
    );
  });

  it('splits PDF text with radicals like ordinary text', () => {
    expect(flat(splitForTranslation('⼯作⽇'))).toEqual(['工作日']);
  });
});

describe('normalizeDetected', () => {
  it('maps system language codes to translation codes', () => {
    expect(normalizeDetected('zh')).toBe('zh-Hans');
    expect(normalizeDetected('zh-Hant')).toBe('zh-Hant');
    expect(normalizeDetected('zh-TW')).toBe('zh-Hant');
    expect(normalizeDetected('zh-Latn')).toBeNull();
    expect(normalizeDetected('pt-BR')).toBe('pt');
    expect(normalizeDetected('und')).toBeNull();
    expect(normalizeDetected(null)).toBeNull();
  });
});

describe('groupBySource', () => {
  const pieces = ['Hello there, how are you?', '你好', '2026-04-15', 'Guten Tag', 'OK'];

  it('uses the detected language of each piece and skips the target language', () => {
    const groups = groupBySource(pieces, ['en', 'zh', null, 'de', null], 'auto', 'zh-Hans');
    expect(Object.fromEntries(groups)).toEqual({ en: [0, 4], de: [3] });
  });

  it('uses the given language for every piece with words', () => {
    const groups = groupBySource(pieces, null, 'ja', 'en');
    expect(Object.fromEntries(groups)).toEqual({ ja: [0, 1, 3, 4] });
    expect(groupBySource(pieces, null, 'en', 'en').size).toBe(0);
  });
});

describe('translate tool', () => {
  it('has single-function quick actions that pass the static checks', () => {
    for (const locale of ['zh', 'en'] as const) {
      const workflows = translateTool.createWorkflows!(locale);
      expect(workflows.map((w) => w.id)).toEqual([
        'translate-typed',
        'translate-photos',
        'translate-pdf',
      ]);
      for (const wf of workflows) {
        expect(workflowProblems(wf, registry)).toEqual([]);
        // 目标语言每次运行时问（D-072）。
        expect(wf.steps.at(-1)).toMatchObject({ action: 'translate.text', ask: ['to'] });
      }
    }
    expect(TRANSLATE_LANGUAGES).toHaveLength(20);
  });
});
