import { describe, expect, it } from 'vitest';

import { formatValue, prepareRecordValues, readValue, recordsToCsv, type DataRecord } from './data';
import {
  FIELDS,
  FieldSchema,
  fieldDefinition,
  type Collection,
  type Component,
  type Condition,
  type Field,
  type Locale,
  type WorkspaceConfig,
} from './schema';
import { expandCollection } from './related';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 每种登记的字段都要满足的事（新增字段类型时这里自动检查它，见 docs/FIELDS.md）。

const LOCALES: Locale[] = ['en', 'zh', 'fr'];
const NOW = new Date(2026, 9, 27, 10);

/** 一张表放上每种字段的 example（引用字段指向它自己，公式用 weight）。 */
const table: Collection = {
  id: 'expenses',
  name: 'Expenses',
  fields: FIELDS.map((d) => d.example as Field),
};

function config(locale: Locale, components: Component[] = [], fields = table.fields) {
  const base = workspace(locale);
  return {
    ...base,
    collections: [{ ...table, fields }],
    pages: [
      { ...base.pages[0]!, components: [...base.pages[0]!.components, ...components] },
      ...base.pages.slice(1),
    ],
  } as WorkspaceConfig;
}

const issues = (c: WorkspaceConfig) => {
  const result = validateWorkspace(c, registry);
  return result.ok ? [] : result.issues.map((i) => i.message);
};

const list = (extra: Record<string, unknown>): Component =>
  ({
    id: 'list',
    type: 'recordList',
    props: { collectionId: 'expenses', display: 'list', titleField: 'title', limit: 5, ...extra },
  }) as Component;

it('every field type has a different example id', () => {
  const ids = FIELDS.map((d) => d.example.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it.each(LOCALES)('a table with every field example is valid in %s', (locale) => {
  expect(issues(config(locale))).toEqual([]);
});

describe.each(FIELDS.map((d) => [d.type, d] as const))('field %s', (_type, def) => {
  const field = def.example as Field;
  // 查找、汇总、上一条按它们显示的那种字段筛选、排序、统计、进公式（D-287–D-289）。
  const shown = fieldDefinition(
    expandCollection([table], table).fields.find((f) => f.id === field.id)!.type,
  );

  it('has a structure, names and an AI doc', () => {
    expect(FieldSchema.safeParse(field).success).toBe(true);
    expect(def.label.every((s) => s.trim() !== '')).toBe(true);
    expect(def.ai.doc.trim()).not.toBe('');
    if (def.ai.docAfter) expect(FIELDS.map((d) => d.type)).toContain(def.ai.docAfter);
  });

  it('writes, reads back, displays and exports its example value', () => {
    if (!def.write) {
      expect(def.exampleValue).toBeUndefined();
      return;
    }
    expect(def.exampleValue).toBeDefined();
    const alone = { ...table, fields: [field] };
    const prepared = prepareRecordValues(alone, { [field.id]: def.exampleValue }, {}, NOW);
    expect(prepared.ok).toBe(true);
    const stored = prepared.ok ? prepared.values[field.id] : undefined;
    expect(readValue(field, stored)).toEqual(stored);
    const record: DataRecord = {
      id: 'r1',
      collectionId: 'expenses',
      values: { [field.id]: stored },
      createdAt: 0,
      updatedAt: 0,
    };
    for (const locale of LOCALES) {
      expect(formatValue(field, stored, locale, () => 'Linked')).not.toBe('');
      expect(recordsToCsv(table, [record], locale, () => 'Linked')).toContain('\r\n');
    }
    // 读不懂的值只是不显示。
    for (const raw of [undefined, null, {}, [], 'no such value', -1, Number.NaN]) {
      expect(() => formatValue(field, raw, 'en')).not.toThrow();
    }
  });

  it('can be filtered as its definition says', () => {
    const at = (cond: Omit<Condition, 'field'>) =>
      issues(config('en', [list({ filter: [{ field: field.id, ...cond } as Condition] })]));
    expect(at({ op: 'isEmpty' })).toEqual([]);
    expect(at({ op: 'contains', value: 'a' }).length === 0).toBe(
      shown.filter.contains === true && !shown.filter.emptyOnly,
    );
    expect(at({ op: 'inPeriod', value: 'thisMonth' }).length === 0).toBe(
      shown.filter.period === true && !shown.filter.emptyOnly,
    );
    const compareValue =
      shown.filter.compare === 'date'
        ? '2026-10-01'
        : shown.filter.compare === 'time'
          ? '09:00'
          : 1;
    expect(at({ op: 'gt', value: compareValue }).length === 0).toBe(
      shown.filter.compare !== undefined && !shown.filter.emptyOnly,
    );
    expect(at({ op: 'due', value: 'today' }).length === 0).toBe(def.filter.schedule === true);
    // 日程的值是一份规则（D-292），不能拿来比 is。
    if (def.exampleValue !== undefined && !def.filter.schedule) {
      // 附件的值是一组文件 ID，筛选时比的是其中一个。
      const value = Array.isArray(def.exampleValue) ? def.exampleValue[0] : def.exampleValue;
      expect(at({ op: 'is', value }).length === 0).toBe(!shown.filter.emptyOnly);
    }
  });

  it('is usable in forms, sorting, stats and formulas as its definition says', () => {
    const form: Component = {
      id: 'form',
      type: 'recordForm',
      props: { collectionId: 'expenses', fieldIds: [field.id], submitLabel: 'Add', mode: 'inline' },
    } as Component;
    expect(issues(config('en', [form])).length === 0).toBe(def.inForm !== false);
    expect(
      issues(config('en', [list({ sort: { field: field.id, direction: 'asc' } })])).length === 0,
    ).toBe(shown.sort !== false);
    const stat = {
      id: 'stat',
      type: 'stat',
      props: { collectionId: 'expenses', aggregate: 'sum', fieldId: field.id, label: 'Sum' },
    } as Component;
    expect(issues(config('en', [stat])).length === 0).toBe(shown.numeric === true);
    const formula: Field = {
      id: 'zz',
      name: 'Uses it',
      type: 'formula',
      expression:
        shown.formula === 'date'
          ? `days({${field.id}}, today)`
          : shown.formula === 'time' || shown.formula === 'datetime'
            ? `hours({${field.id}}, {${field.id}})`
            : `{${field.id}} + 1`,
    };
    expect(issues(config('en', [], [...table.fields, formula])).length === 0).toBe(
      shown.formula !== undefined,
    );
  });
});
