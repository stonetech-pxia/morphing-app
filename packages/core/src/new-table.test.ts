import { describe, expect, it } from 'vitest';

import { addDraftField, fieldTypeFor, removeDraftField, renameDraftField } from './new-table';
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
