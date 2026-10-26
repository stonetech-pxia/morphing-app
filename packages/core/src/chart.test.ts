import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { chartSeries, linePath, piePaths, pieSlices, type ChartPoint } from './chart';
import type { DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import type { Collection, Component } from './schema';
import { registry } from './test-helpers';

const expenses: Collection = {
  id: 'expenses',
  name: '账目',
  fields: [
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
    {
      id: 'category',
      name: '分类',
      type: 'choice',
      options: [
        { id: 'food', label: '餐饮' },
        { id: 'transport', label: '交通' },
      ],
    },
    { id: 'date', name: '日期', type: 'date' },
  ],
};
const rec = (id: string, values: Record<string, unknown>, createdAt = 0): DataRecord => ({
  id,
  collectionId: 'expenses',
  values,
  createdAt,
  updatedAt: createdAt,
});
// 2026-10-22 是星期四。
const now = new Date(2026, 9, 22, 15);
const records = [
  rec('a', { amount: 10, category: 'food', date: '2026-10-22' }),
  rec('b', { amount: 5, category: 'food', date: '2026-10-19' }),
  rec('c', { amount: 7, category: 'transport', date: '2026-10-18' }),
  rec('d', { amount: 100, date: '2026-08-31' }),
  rec('e', { amount: 1, date: '2026-10-23' }),
];
const values = (points: ChartPoint[]) => points.map((p) => [p.label, p.value]);

describe('chartSeries (D-249)', () => {
  it('sums the last 7 days, one bar per day, empty days at 0 and future dates left out', () => {
    const points = chartSeries(
      records,
      expenses,
      { aggregate: 'sum', fieldId: 'amount', group: 'day' },
      now,
      '-',
    );
    expect(values(points)).toEqual([
      ['10-16', 0],
      ['10-17', 0],
      ['10-18', 7],
      ['10-19', 5],
      ['10-20', 0],
      ['10-21', 0],
      ['10-22', 10],
    ]);
  });

  it('weeks start on Monday; months go back across the year', () => {
    const weeks = chartSeries(
      records,
      expenses,
      { aggregate: 'count', group: 'week', periods: 2 },
      now,
      '-',
    );
    expect(values(weeks)).toEqual([
      ['10-12', 1],
      ['10-19', 2],
    ]);
    const months = chartSeries(
      records,
      expenses,
      { aggregate: 'sum', fieldId: 'amount', group: 'month', periods: 3 },
      now,
      '-',
    );
    expect(values(months)).toEqual([
      ['2026-08', 100],
      ['2026-09', 0],
      ['2026-10', 22],
    ]);
  });

  it('can use when the entry was created instead of a date field', () => {
    const created = [rec('x', {}, new Date(2026, 9, 21, 23).getTime())];
    const points = chartSeries(
      created,
      expenses,
      { aggregate: 'count', group: 'day', dateField: 'createdAt', periods: 2 },
      now,
      '-',
    );
    expect(values(points)).toEqual([
      ['10-21', 1],
      ['10-22', 0],
    ]);
  });

  it('groups by a choice field in option order, entries without a choice last', () => {
    const points = chartSeries(
      records,
      expenses,
      { aggregate: 'sum', fieldId: 'amount', group: 'choice', choiceField: 'category' },
      now,
      '未选',
    );
    expect(values(points)).toEqual([
      ['餐饮', 15],
      ['交通', 7],
      ['未选', 101],
    ]);
  });

  it('marks averages of empty periods so they show “—” rather than 0', () => {
    const points = chartSeries(
      [],
      expenses,
      { aggregate: 'avg', fieldId: 'amount', group: 'month', periods: 2 },
      now,
      '-',
    );
    expect(points.every((p) => p.empty && p.value === 0)).toBe(true);
  });
});

describe('pie and line geometry', () => {
  it('folds the smallest slices into “Other” after 7, never repainting the kept ones', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`,
      label: `L${i}`,
      value: i + 1,
      empty: false,
    }));
    const slices = pieSlices(
      [{ key: 'zero', label: 'Z', value: 0, empty: false }, ...many],
      '其他',
    );
    expect(slices).toHaveLength(8);
    expect(slices.slice(0, 7).map((s) => s.key)).toEqual([
      'k3',
      'k4',
      'k5',
      'k6',
      'k7',
      'k8',
      'k9',
    ]);
    expect(slices[7]).toEqual({ key: null, label: '其他', value: 1 + 2 + 3, empty: false });
  });

  it('draws slices clockwise from 12 o’clock, and a single slice as a full circle', () => {
    const [half, quarterA] = piePaths([2, 1, 1], 50, 50, 40);
    expect(half).toBe('M50 50 L50 10 A40 40 0 0 1 50 90 Z');
    expect(quarterA).toBe('M50 50 L50 90 A40 40 0 0 1 10 50 Z');
    expect(piePaths([0, 3], 50, 50, 40)[1]).toMatch(/^M10 50 A40 40 0 1 1 90 50/);
    expect(piePaths([0, 0], 50, 50, 40)).toEqual(['', '']);
  });

  it('puts the line inside the box with 0 at the bottom', () => {
    expect(linePath([0, 10], 100, 50, 0)).toBe('M0 50 L100 0');
  });
});

describe('chart validation', () => {
  const ctx = { registry, locale: 'zh' as const, now };
  const check = (props: Partial<Extract<Component, { type: 'chart' }>['props']>) =>
    prepareOps(
      createDefaultWorkspace('zh'),
      [
        { op: 'addCollection', collection: expenses },
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'c',
            type: 'chart',
            props: {
              collectionId: 'expenses',
              kind: 'bar',
              aggregate: 'count',
              group: 'month',
              title: '每月',
              ...props,
            },
          },
        },
      ],
      ctx,
    ).ok;
  it('accepts sensible charts and refuses the rest', () => {
    expect(check({})).toBe(true);
    expect(check({ kind: 'pie', group: 'choice', choiceField: 'category' })).toBe(true);
    expect(
      check({ kind: 'line', aggregate: 'sum', fieldId: 'amount', group: 'day', dateField: 'date' }),
    ).toBe(true);
    expect(check({ kind: 'pie' })).toBe(false);
    expect(check({ group: 'choice', choiceField: 'amount' })).toBe(false);
    expect(check({ aggregate: 'sum' })).toBe(false);
    expect(check({ dateField: 'amount' })).toBe(false);
    expect(check({ collectionId: 'missing' })).toBe(false);
  });
});
