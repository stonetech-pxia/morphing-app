import { describe, expect, it } from 'vitest';

import {
  addDraftField,
  draftEngine,
  fieldTypeFor,
  removeDraftField,
  renameDraftField,
} from './new-table';
import { applyOps } from './ops';
import { createDefaultWorkspace } from './defaults';
import type { TextPage } from './prefill/rows';
import type { Collection } from './schema';
import { draftTable, draftTableOps, FILE_RECORD_PRESETS, HIDDEN_RECORD_PRESETS } from './templates';
import { registry } from './test-helpers';

const pages: TextPage[] = [
  {
    width: 800,
    height: 1100,
    lines: [
      { text: 'Annual premium: $612.40', x: 40, y: 100, width: 300, height: 16 },
      { text: 'Start of cover: 3 March 2025', x: 40, y: 150, width: 300, height: 16 },
      { text: 'Insurer: Bluecrest', x: 40, y: 200, width: 300, height: 16 },
    ],
  },
];
const blank = (): Collection => draftTable('blank', createDefaultWorkspace('en'), 'en');

describe('draftEngine（手机上发现的问题）', () => {
  const doc: TextPage[] = [
    {
      width: 800,
      height: 1100,
      lines: [
        { text: 'Numéro de contrat : CT-77120', x: 40, y: 100, width: 300, height: 16 },
        { text: 'Prime annuelle : 214,00 €', x: 40, y: 150, width: 300, height: 16 },
      ],
    },
  ];
  it('字段名和文件上的标签一样时，它旁边的值是第一个候选，编号也算', async () => {
    const t = addDraftField(
      addDraftField(blank(), 'Numéro de contrat', doc, 'fr'),
      'Prime annuelle',
      doc,
      'fr',
    );
    const got = await draftEngine({ fields: t.fields, pages: doc, locale: 'fr' });
    const number = t.fields.find((f) => f.name === 'Numéro de contrat')!;
    const premium = t.fields.find((f) => f.name === 'Prime annuelle')!;
    expect(got[number.id]![0]!.value).toBe('CT-77120');
    expect(got[premium.id]![0]!.value).toBe('214.00');
  });
  it('金额字段一定有货币：看文件上的符号，没有就按界面语言', () => {
    const t = addDraftField(blank(), 'Prime annuelle', doc, 'en');
    expect(t.fields.find((f) => f.name === 'Prime annuelle')).toMatchObject({
      type: 'money',
      currency: 'EUR',
    });
    const plain: TextPage[] = [
      {
        width: 800,
        height: 100,
        lines: [{ text: 'Total: 214.00', x: 0, y: 0, width: 200, height: 16 }],
      },
    ];
    expect(fieldTypeFor('Total', plain, 'zh')).toMatchObject({ type: 'money', currency: 'CNY' });
  });
});

describe('draft fields', () => {
  it('类型从旁边的值判断，看不出来是文字', () => {
    expect(fieldTypeFor('Annual premium', pages, 'en').type).toBe('money');
    expect(fieldTypeFor('Start of cover', pages, 'en').type).toBe('date');
    expect(fieldTypeFor('Insurer', pages, 'en').type).toBe('text');
    expect(fieldTypeFor('Nothing', pages, 'en').type).toBe('text');
  });
  it('加在附件前面，重复和空名不加', () => {
    let t = addDraftField(blank(), 'Insurer', pages, 'en');
    expect(t.fields.map((f) => f.name)).toEqual(['Title', 'Insurer', 'Attachments']);
    expect(addDraftField(t, ' insurer ', pages, 'en')).toBe(t);
    expect(addDraftField(t, '  ', pages, 'en')).toBe(t);
    t = renameDraftField(t, 'title', 'Name');
    expect(t.fields[0]!.name).toBe('Name');
    expect(renameDraftField(t, 'title', 'Insurer')).toBe(t);
  });
  it('附件字段去不掉', () => {
    const t = removeDraftField(removeDraftField(blank(), 'title'), 'attachments');
    expect(t.fields.map((f) => f.id)).toEqual(['attachments']);
  });
});

describe.each([...FILE_RECORD_PRESETS, ...HIDDEN_RECORD_PRESETS])('preset %s', (preset) => {
  it.each(['en', 'zh', 'fr'] as const)('%s：完整和去掉字段后都能建（底线 18）', (locale) => {
    const config = createDefaultWorkspace(locale);
    const table = draftTable(preset, config, locale);
    const whole = applyOps(config, draftTableOps(table, preset, config, locale), {
      registry,
      locale,
    });
    expect(whole.ok).toBe(true);
    const removed = table.fields.find((f) => f.type !== 'file')!;
    const smaller = removeDraftField(table, removed.id);
    const part = applyOps(config, draftTableOps(smaller, preset, config, locale), {
      registry,
      locale,
    });
    expect(part.ok).toBe(true);
    expect(table.fields.some((f) => f.type === 'file')).toBe(true);
  });
});

describe('隐藏的预设', () => {
  it('不在用户平时看到的预设里', () => {
    for (const p of HIDDEN_RECORD_PRESETS)
      expect(FILE_RECORD_PRESETS as readonly string[]).not.toContain(p);
  });
});
