import { describe, expect, it } from 'vitest';

import {
  aggregateRecords,
  filterRecords,
  formatValue,
  periodRange,
  prepareRecordValues,
  readValue,
  recordsToCsv,
  sortRecords,
  type DataRecord,
} from './data';
import type { Collection } from './schema';
import { fromV33, v33Fixture } from './test-helpers';

const now = new Date(2026, 9, 22, 9, 0); // 2026-10-22，周四

/** 记账模版的表（v33 代码存下来的模版配置，迁移到 v34）。 */
const expenses = (): Collection => fromV33(v33Fixture('template-budget')).data.tables[0]!;

let seq = 0;
const record = (values: Record<string, unknown>, createdAt = Date.now()): DataRecord => ({
  id: `r${++seq}`,
  collectionId: 'expenses',
  values,
  createdAt,
  updatedAt: createdAt,
});

describe('prepareRecordValues', () => {
  it('applies defaults to new records and coerces form input', () => {
    const result = prepareRecordValues(
      expenses(),
      { amount: '1,234.567', note: ' 午饭 ' },
      null,
      now,
    );
    expect(result).toEqual({
      ok: true,
      values: { amount: 1234.57, category: 'food', date: '2026-10-22', note: '午饭' },
    });
  });

  it('reports required, invalid and too-long values', () => {
    const result = prepareRecordValues(
      expenses(),
      { amount: '', category: 'nope', date: '2026-02-30', note: 'x'.repeat(201) },
      null,
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { fieldId: 'amount', code: 'required' },
      { fieldId: 'category', code: 'invalid' },
      { fieldId: 'date', code: 'invalid' },
      { fieldId: 'note', code: 'tooLong' },
    ]);
  });

  it('keeps values of removed fields and clears blank ones on update', () => {
    const previous = { amount: 10, note: 'old', 'field-9': 'from a removed field' };
    const result = prepareRecordValues(expenses(), { note: '' }, previous, now);
    expect(result).toEqual({ ok: true, values: { amount: 10, 'field-9': 'from a removed field' } });
  });

  it('accepts text that happens to look like an error code', () => {
    const result = prepareRecordValues(expenses(), { amount: 1, note: 'invalid' }, null, now);
    expect(result.ok && result.values.note).toBe('invalid');
  });
});

describe('reading is tolerant', () => {
  it('ignores values that no longer match the field definition', () => {
    const c = expenses();
    const amount = c.fields[0]!;
    const category = c.fields[1]!;
    expect(readValue(amount, '12')).toBeUndefined();
    expect(readValue(category, 'deleted-option')).toBeUndefined();
    expect(formatValue(category, 42, 'zh')).toBe('');
  });
});

describe('filter, sort, aggregate', () => {
  const c = expenses();
  const rows = [
    record({ amount: 30, category: 'food', date: '2026-10-21', note: '午饭' }, 1),
    record({ amount: 12.5, category: 'transport', date: '2026-10-02' }, 2),
    record({ amount: 99, category: 'food', date: '2026-09-30' }, 3),
    record({ amount: 'broken', category: 'food', date: '2026-10-05' }, 4),
  ];

  it('periods use local dates; weeks start on Monday', () => {
    expect(periodRange('thisWeek', now)).toEqual(['2026-10-19', '2026-10-25']);
    expect(periodRange('thisMonth', now)).toEqual(['2026-10-01', '2026-10-31']);
    expect(periodRange('last7days', now)).toEqual(['2026-10-16', '2026-10-22']);
  });

  it('filters with AND conditions', () => {
    const october = filterRecords(
      rows,
      c,
      [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
      now,
    );
    expect(october.map((r) => r.values.amount)).toEqual([30, 12.5, 'broken']);
    const food = filterRecords(
      rows,
      c,
      [
        { field: 'date', op: 'inPeriod', value: 'thisMonth' },
        { field: 'category', op: 'is', value: 'food' },
        { field: 'amount', op: 'gt', value: 20 },
      ],
      now,
    );
    expect(food.map((r) => r.id)).toEqual([rows[0]!.id]);
  });

  it('sums only valid numbers', () => {
    const october = filterRecords(
      rows,
      c,
      [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
      now,
    );
    expect(aggregateRecords(october, c, 'sum', 'amount')).toBe(42.5);
    expect(aggregateRecords(october, c, 'count', undefined)).toBe(3);
    expect(aggregateRecords([], c, 'avg', 'amount')).toBeNull();
  });

  it('sorts with empty values last and choices in option order', () => {
    expect(
      sortRecords(rows, c, { field: 'amount', direction: 'desc' }).map((r) => r.values.amount),
    ).toEqual([99, 30, 12.5, 'broken']);
    expect(sortRecords(rows, c, { field: 'category', direction: 'asc' })[3]!.values.category).toBe(
      'transport',
    );
    expect(sortRecords(rows, c, undefined)[0]!.createdAt).toBe(4);
  });
});

describe('formatting and CSV', () => {
  it('formats money, ratings and choices', () => {
    const c = expenses();
    expect(formatValue(c.fields[0]!, 1234.5, 'zh')).toBe('¥1,234.50');
    expect(formatValue(c.fields[1]!, 'transport', 'zh')).toBe('交通');
    expect(formatValue({ id: 'r', name: 'R', type: 'rating' }, 4, 'zh')).toBe('★★★★☆');
  });

  it('exports CSV with a BOM, escaped cells and readable values', () => {
    const csv = recordsToCsv(
      expenses(),
      [
        record(
          { amount: 5, category: 'food', date: '2026-10-22', note: 'a, "b"' },
          new Date(2026, 9, 22, 8, 5).getTime(),
        ),
      ],
      'zh',
    );
    expect(csv).toBe(
      '﻿金额,分类,日期,备注,创建时间\r\n5.00,餐饮,2026-10-22,"a, ""b""",2026-10-22 08:05\r\n',
    );
  });
});
