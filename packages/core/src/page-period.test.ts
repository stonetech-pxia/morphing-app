import { describe, expect, it } from 'vitest';

import type { DataRecord } from './data';
import {
  choiceRange,
  previousFullRange,
  previousToDateRange,
  rangeStarts,
  rangeUnit,
  recordsInRange,
  validChoice,
} from './page-period';
import type { Collection } from './schema';

// 2026-11-04 是星期三；默认一周从周一开始。
const now = new Date(2026, 10, 4, 12);
const range = (period: Parameters<typeof choiceRange>[0]) => choiceRange(period, now);

describe('page period ranges (D-440)', () => {
  it('this week is Monday to Sunday, this month and this year are whole, last N days end today', () => {
    expect(range({ period: 'thisWeek' })).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(range({ period: 'thisMonth' })).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(range({ period: 'thisYear' })).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(range({ period: 'last30days' })).toEqual({ start: '2026-10-06', end: '2026-11-04' });
    expect(range({ period: 'today' })).toEqual({ start: '2026-11-04', end: '2026-11-04' });
    expect(range({ start: '2026-10-01', end: '2026-10-09' })).toEqual({
      start: '2026-10-01',
      end: '2026-10-09',
    });
  });

  it('the previous period is the whole one right before, point for point', () => {
    const prev = (c: Parameters<typeof previousFullRange>[0]) => previousFullRange(c, now);
    expect(prev({ period: 'thisWeek' })).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(prev({ period: 'thisMonth' })).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(prev({ period: 'thisYear' })).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    expect(prev({ period: 'last30days' })).toEqual({ start: '2026-09-06', end: '2026-10-05' });
    expect(prev({ period: 'today' })).toEqual({ start: '2026-11-03', end: '2026-11-03' });
    // 自定义的：前面同样长的一段（10 天）。
    expect(prev({ start: '2026-11-01', end: '2026-11-10' })).toEqual({
      start: '2026-10-22',
      end: '2026-10-31',
    });
  });

  it('January looks back to December of the year before', () => {
    const jan = new Date(2026, 0, 15);
    expect(previousFullRange({ period: 'thisMonth' }, jan)).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('for numbers the previous period is the same stretch so far, like "compared with last month"', () => {
    expect(previousToDateRange({ period: 'thisMonth' }, now)).toEqual({
      start: '2026-10-01',
      end: '2026-10-04',
    });
    expect(previousToDateRange({ period: 'thisWeek' }, now)).toEqual({
      start: '2026-10-26',
      end: '2026-10-28',
    });
  });

  it('charts split by day up to a month, by week up to half a year, then by month', () => {
    expect(rangeUnit(range({ period: 'thisWeek' }))).toBe('day');
    expect(rangeUnit(range({ period: 'thisMonth' }))).toBe('day');
    expect(rangeUnit(range({ period: 'last90days' }))).toBe('week');
    expect(rangeUnit(range({ period: 'thisYear' }))).toBe('month');
    expect(rangeUnit({ start: '2026-01-01', end: '2026-07-04' })).toBe('month');
    expect(rangeUnit({ start: '2026-01-01', end: '2026-01-01' })).toBe('day');
  });

  it('lists where each stretch starts: weeks begin on the Monday before the range starts', () => {
    expect(rangeStarts(range({ period: 'thisWeek' }), 'day')).toHaveLength(7);
    expect(rangeStarts(range({ period: 'thisMonth' }), 'week')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    const months = rangeStarts(range({ period: 'thisYear' }), 'month');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01-01');
    expect(months[11]).toBe('2026-12-01');
  });

  it('keeps the records inside the range, both ends included, and none without a date', () => {
    const table = {
      id: 't',
      name: 'T',
      fields: [{ id: 'd', name: 'D', type: 'date' }],
    } as Collection;
    const rec = (id: string, d?: string): DataRecord =>
      ({
        id,
        collectionId: 't',
        values: d ? { d } : {},
        createdAt: 0,
        updatedAt: 0,
      }) as DataRecord;
    const all = [
      rec('a', '2026-10-31'),
      rec('b', '2026-11-01'),
      rec('c', '2026-11-30'),
      rec('d', '2026-12-01'),
      rec('e'),
    ];
    expect(
      recordsInRange(all, table, 'd', range({ period: 'thisMonth' }), now).map((r) => r.id),
    ).toEqual(['b', 'c']);
    expect(recordsInRange([], table, 'd', range({ period: 'thisMonth' }), now)).toEqual([]);
  });

  it('a custom range needs two dates, the start not after the end, at most five years', () => {
    expect(validChoice({ start: '2026-01-01', end: '2026-01-01' })).toBe(true);
    expect(validChoice({ start: '2026-02-01', end: '2026-01-01' })).toBe(false);
    expect(validChoice({ start: 'x', end: '2026-01-01' })).toBe(false);
    expect(validChoice({ start: '2020-01-01', end: '2026-01-01' })).toBe(false);
    expect(validChoice({ period: 'thisWeek' })).toBe(true);
  });
});
