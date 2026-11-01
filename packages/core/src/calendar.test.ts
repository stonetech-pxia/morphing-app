import { describe, expect, it } from 'vitest';

import { splitOps } from './ai/kinds';
import { calendarOf, DEFAULT_CALENDAR, type Calendar } from './calendar';
import { prepareOps } from './change';
import { chartSeries } from './chart';
import { filterRecords, periodRange, prepareRecordValues, type DataRecord } from './data';
import { describeChange } from './describe';
import { migrateWorkspace } from './migrate';
import type { Collection } from './schema';
import { registry, v33Fixture, workspace } from './test-helpers';

// 2026-10-22 是星期四。
const thursday = new Date(2026, 9, 22, 9, 0);
const sunday: Calendar = { ...DEFAULT_CALENDAR, weekStart: 'sunday' };
const twoAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 2 };

describe('new periods (D-285)', () => {
  it('last 14 / 90 / 365 days end today', () => {
    expect(periodRange('last14days', thursday)).toEqual(['2026-10-09', '2026-10-22']);
    expect(periodRange('last90days', thursday)).toEqual(['2026-07-25', '2026-10-22']);
    expect(periodRange('last365days', thursday)).toEqual(['2025-10-23', '2026-10-22']);
  });

  it('half months are the 1st–15th and the 16th–end of the month', () => {
    expect(periodRange('thisHalfMonth', thursday)).toEqual(['2026-10-16', '2026-10-31']);
    expect(periodRange('thisHalfMonth', new Date(2026, 1, 15, 23))).toEqual([
      '2026-02-01',
      '2026-02-15',
    ]);
    expect(periodRange('thisHalfMonth', new Date(2028, 1, 20))).toEqual([
      '2028-02-16',
      '2028-02-29',
    ]);
  });

  it('two-week periods count from the anchor date, before or after it', () => {
    const cal: Calendar = { ...DEFAULT_CALENDAR, twoWeekStart: '2026-10-12' };
    expect(periodRange('thisTwoWeeks', thursday, cal)).toEqual(['2026-10-12', '2026-10-25']);
    expect(periodRange('thisTwoWeeks', new Date(2026, 9, 26), cal)).toEqual([
      '2026-10-26',
      '2026-11-08',
    ]);
    expect(periodRange('thisTwoWeeks', new Date(2026, 9, 11), cal)).toEqual([
      '2026-09-28',
      '2026-10-11',
    ]);
  });

  it('without an anchor, two-week periods start on a week start', () => {
    const [start] = periodRange('thisTwoWeeks', thursday);
    expect(new Date(`${start}T12:00:00`).getDay()).toBe(1);
    const [sundayStart, end] = periodRange('thisTwoWeeks', thursday, sunday);
    expect(new Date(`${sundayStart}T12:00:00`).getDay()).toBe(0);
    expect(sundayStart <= '2026-10-22' && end >= '2026-10-22').toBe(true);
  });
});

describe('when a day and a week start (D-286)', () => {
  it('weeks start on Monday by default, or on Sunday', () => {
    expect(periodRange('thisWeek', thursday)).toEqual(['2026-10-19', '2026-10-25']);
    expect(periodRange('thisWeek', thursday, sunday)).toEqual(['2026-10-18', '2026-10-24']);
    // 周日当天：周一开始时是这周的最后一天，周日开始时是新一周的第一天。
    const sun = new Date(2026, 9, 25, 10);
    expect(periodRange('thisWeek', sun)).toEqual(['2026-10-19', '2026-10-25']);
    expect(periodRange('thisWeek', sun, sunday)).toEqual(['2026-10-25', '2026-10-31']);
  });

  it('before the day start hour it is still yesterday', () => {
    const lateNight = new Date(2026, 9, 23, 1, 30);
    expect(periodRange('today', lateNight)).toEqual(['2026-10-23', '2026-10-23']);
    expect(periodRange('today', lateNight, twoAm)).toEqual(['2026-10-22', '2026-10-22']);
    // 月初凌晨 1 点：还在上个月。
    expect(periodRange('thisMonth', new Date(2026, 10, 1, 1), twoAm)).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('a new entry made at 1:30 gets yesterday as its default date', () => {
    const c: Collection = {
      id: 'log',
      name: 'Log',
      fields: [{ id: 'date', name: 'Date', type: 'date', default: 'today' }],
    };
    const lateNight = new Date(2026, 9, 23, 1, 30);
    expect(prepareRecordValues(c, {}, null, lateNight)).toEqual({
      ok: true,
      values: { date: '2026-10-23' },
    });
    expect(prepareRecordValues(c, {}, null, lateNight, twoAm)).toEqual({
      ok: true,
      values: { date: '2026-10-22' },
    });
  });

  it('created-at filters use the logical day', () => {
    const c: Collection = {
      id: 'log',
      name: 'Log',
      fields: [{ id: 'n', name: 'N', type: 'number' }],
    };
    const rec = (d: Date): DataRecord => ({
      id: String(d.getTime()),
      collectionId: 'log',
      values: {},
      createdAt: d.getTime(),
      updatedAt: d.getTime(),
    });
    const records = [rec(new Date(2026, 9, 22, 1)), rec(new Date(2026, 9, 22, 8))];
    const today = [{ field: 'createdAt', op: 'inPeriod' as const, value: 'today' }];
    expect(filterRecords(records, c, today, thursday)).toHaveLength(2);
    expect(filterRecords(records, c, today, thursday, twoAm)).toHaveLength(1);
  });

  it('chart weeks follow the week start; distinct days per week', () => {
    const c: Collection = {
      id: 'log',
      name: 'Log',
      fields: [{ id: 'date', name: 'Date', type: 'date' }],
    };
    const rec = (date: string): DataRecord => ({
      id: date + Math.random(),
      collectionId: 'log',
      values: { date },
      createdAt: 0,
      updatedAt: 0,
    });
    const records = ['2026-10-18', '2026-10-19', '2026-10-19', '2026-10-21'].map(rec);
    const spec = { aggregate: 'distinctDays' as const, group: { unit: 'week' as const, last: 2 } };
    expect(chartSeries(records, c, spec, thursday, '-').map((p) => [p.key, p.value])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-19', 2],
    ]);
    expect(
      chartSeries(records, c, spec, thursday, '-', sunday).map((p) => [p.key, p.value]),
    ).toEqual([
      ['2026-10-11', 0],
      ['2026-10-18', 3],
    ]);
  });
});

describe('calendar settings in the config (D-286)', () => {
  const ctx = { registry, locale: 'zh' as const, now: thursday };

  it('defaults to midnight and Monday', () => {
    expect(calendarOf(workspace())).toEqual(DEFAULT_CALENDAR);
  });

  it('updateData {calendar} changes only the given settings; null goes back to the default', () => {
    const set = prepareOps(
      workspace(),
      [{ op: 'updateData', calendar: { dayStartHour: 2, weekStart: 'sunday' } }],
      ctx,
    );
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(calendarOf(set.after)).toEqual({ dayStartHour: 2, weekStart: 'sunday' });
    const reset = prepareOps(
      set.after,
      [{ op: 'updateData', calendar: { dayStartHour: null } }],
      ctx,
    );
    expect(reset.ok && calendarOf(reset.after)).toEqual({ dayStartHour: 0, weekStart: 'sunday' });
    expect(
      describeChange([{ op: 'updateData', calendar: { weekStart: 'sunday' } }], set.after, [], ctx),
    ).toEqual(['一周从周日开始']);
  });

  it('rejects a day start after 6 am and a bad anchor date', () => {
    expect(
      prepareOps(workspace(), [{ op: 'updateData', calendar: { dayStartHour: 7 } }], ctx).ok,
    ).toBe(false);
    expect(
      prepareOps(workspace(), [{ op: 'updateData', calendar: { twoWeekStart: '2026-02-30' } }], ctx)
        .ok,
    ).toBe(false);
  });

  it('is a function change (applied at once, can be undone)', () => {
    expect(
      splitOps([{ op: 'updateData', calendar: { weekStart: 'sunday' } }]).function,
    ).toHaveLength(1);
  });

  it('v19 → v20 only raises the version', () => {
    // 旧版本的形状（v33 存下来的默认配置），不是 v34 的。
    const previous = { ...v33Fixture('default-en'), schemaVersion: 19 };
    expect(migrateWorkspace(previous, undefined, 20)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 20 },
      fromVersion: 19,
    });
  });
});
