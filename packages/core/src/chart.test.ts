import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import {
  axisTickText,
  chartSeries,
  chartYDomain,
  linePath,
  piePaths,
  pieSlices,
  type ChartPoint,
} from './chart';
import type { DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import type { Collection, NewComponent } from './schema';
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
      { aggregate: 'sum', field: 'amount', group: { unit: 'day' } },
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
      { aggregate: 'count', group: { unit: 'week', last: 2 } },
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
      { aggregate: 'sum', field: 'amount', group: { unit: 'month', last: 3 } },
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
      { aggregate: 'count', group: { unit: 'day', by: 'createdAt', last: 2 } },
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
      { aggregate: 'sum', field: 'amount', group: { by: 'category' } },
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
      { aggregate: 'avg', field: 'amount', group: { unit: 'month', last: 2 } },
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
  const check = (source: Record<string, unknown>, show: Record<string, unknown> = {}) =>
    prepareOps(
      createDefaultWorkspace('zh'),
      [
        { op: 'addData', table: expenses },
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'c',
            look: 'chart',
            show: { kind: 'bar', title: '每月', ...show },
            source: { table: 'expenses', aggregate: 'count', group: { unit: 'month' }, ...source },
          } as NewComponent,
        },
      ],
      ctx,
    ).ok;
  it('accepts sensible charts and refuses the rest', () => {
    expect(check({})).toBe(true);
    expect(check({ group: { by: 'category' } }, { kind: 'pie' })).toBe(true);
    expect(
      check(
        { aggregate: 'sum', field: 'amount', group: { unit: 'day', by: 'date' } },
        { kind: 'line' },
      ),
    ).toBe(true);
    expect(check({}, { kind: 'pie' })).toBe(false);
    expect(check({ group: { by: 'amount' } })).toBe(false);
    expect(check({ aggregate: 'sum' })).toBe(false);
    expect(check({ group: { unit: 'month', by: 'amount' } })).toBe(false);
    expect(check({ table: 'missing' })).toBe(false);
  });

  it('compare (D-439): a time group, bar or line, and no inPeriod filter', () => {
    expect(check({ compare: 'previous' })).toBe(true);
    expect(check({ compare: 'previous' }, { kind: 'line' })).toBe(true);
    expect(check({ compare: 'previous', group: { by: 'category' } })).toBe(false);
    expect(check({ compare: 'previous', group: { by: 'category' } }, { kind: 'pie' })).toBe(false);
    expect(
      check({
        compare: 'previous',
        filter: [{ field: 'date', op: 'inPeriod', value: 'thisYear' }],
      }),
    ).toBe(false);
    // 别的筛选可以。
    expect(
      check({ compare: 'previous', filter: [{ field: 'category', op: 'is', value: 'food' }] }),
    ).toBe(true);
  });
});

describe('chartSeries with the previous period (D-439)', () => {
  const spec = {
    aggregate: 'sum',
    field: 'amount',
    group: { unit: 'month', last: 3 },
  } as const;
  const more = [
    ...records,
    rec('p1', { amount: 1000, date: '2026-05-31' }), // 上上期，哪一期都不算
    rec('p2', { amount: 40, date: '2026-06-01' }), // 上一期第一天
    rec('p3', { amount: 3, date: '2026-07-15' }),
    rec('p4', { amount: 8, date: '2026-07-31' }),
  ];

  it('is the n periods right before the latest n, point for point', () => {
    const current = chartSeries(more, expenses, spec, now, '-');
    const previous = chartSeries(more, expenses, spec, now, '-', undefined, undefined, true);
    expect(values(current)).toEqual([
      ['2026-08', 100],
      ['2026-09', 0],
      ['2026-10', 22],
    ]);
    expect(values(previous)).toEqual([
      ['2026-05', 1000],
      ['2026-06', 40],
      ['2026-07', 11],
    ]);
  });

  it('the day before the latest periods belongs to the previous ones, the first day to the latest', () => {
    const edge = [
      rec('x', { amount: 5, date: '2026-07-31' }),
      rec('y', { amount: 6, date: '2026-08-01' }),
    ];
    expect(values(chartSeries(edge, expenses, spec, now, '-'))[0]).toEqual(['2026-08', 6]);
    expect(
      values(chartSeries(edge, expenses, spec, now, '-', undefined, undefined, true))[2],
    ).toEqual(['2026-07', 5]);
  });

  it('works by week and by day, and has the same length as the latest', () => {
    for (const unit of ['day', 'week'] as const) {
      const s = { aggregate: 'count', group: { unit, last: 4 } } as const;
      const a = chartSeries(records, expenses, s, now, '-');
      const b = chartSeries(records, expenses, s, now, '-', undefined, undefined, true);
      expect(b).toHaveLength(a.length);
      expect(b[b.length - 1]!.key! < a[0]!.key!).toBe(true);
    }
  });
});

describe('chart axis (D-438)', () => {
  it('the y range always includes 0 so bars are never cut off, with some room above the top', () => {
    const [lo, hi] = chartYDomain([40, 85, 27]);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(85);
    expect(hi).toBeLessThan(100);
  });

  it('negative values extend the range downwards; no data is 0 to 1', () => {
    const [lo, hi] = chartYDomain([-20, 50]);
    expect(lo).toBe(-20);
    expect(hi).toBeGreaterThan(50);
    expect(chartYDomain([])).toEqual([0, 1]);
    expect(chartYDomain([0, 0])).toEqual([0, 1]);
  });

  it('tick text is short: no currency, k and M, at most one decimal', () => {
    expect(axisTickText(0)).toBe('0');
    expect(axisTickText(2.5)).toBe('2.5');
    expect(axisTickText(40)).toBe('40');
    expect(axisTickText(999)).toBe('999');
    expect(axisTickText(1200)).toBe('1.2k');
    expect(axisTickText(15000)).toBe('15k');
    expect(axisTickText(2_500_000)).toBe('2.5M');
    expect(axisTickText(-1500)).toBe('-1.5k');
  });
});

describe('chartSeries over a page range (D-440)', () => {
  const spec = { aggregate: 'sum', field: 'amount', group: { unit: 'month', last: 3 } } as const;

  it('one point per day for a week, future days at 0, records outside left out', () => {
    // now 是 2026-10-22（周四）；本周是 10-19 到 10-25。
    const points = chartSeries(records, expenses, spec, now, '-', undefined, undefined, false, {
      start: '2026-10-19',
      end: '2026-10-25',
    });
    expect(values(points)).toEqual([
      ['10-19', 5],
      ['10-20', 0],
      ['10-21', 0],
      ['10-22', 10],
      ['10-23', 1],
      ['10-24', 0],
      ['10-25', 0],
    ]);
  });

  it('a whole year is split by month; group.unit and last are ignored', () => {
    const points = chartSeries(records, expenses, spec, now, '-', undefined, undefined, false, {
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(points).toHaveLength(12);
    expect(values(points)[7]).toEqual(['2026-08', 100]);
    expect(values(points)[9]).toEqual(['2026-10', 23]);
  });

  it('the first week of a month range can start before the range, without counting what is before it', () => {
    const points = chartSeries(
      [rec('x', { amount: 4, date: '2026-10-31' }), rec('y', { amount: 6, date: '2026-11-02' })],
      expenses,
      { aggregate: 'sum', field: 'amount', group: { unit: 'week' } },
      new Date(2026, 10, 4),
      '-',
      undefined,
      undefined,
      false,
      { start: '2026-11-01', end: '2026-12-31' },
    );
    // 范围超过一个月、不到半年：按周；第一周从 10-26 起，但 10-31 在范围外不算。
    expect(points[0]).toMatchObject({ key: '2026-10-26', value: 0 });
    expect(points[1]).toMatchObject({ key: '2026-11-02', value: 6 });
  });
});
