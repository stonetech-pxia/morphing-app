import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR, dateOfDayNumber, type Calendar } from './calendar';
import { prepareOps } from './change';
import { filterRecords, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import { dayNumber } from './formula';
import {
  currentMonth,
  heatLevel,
  monthDays,
  monthQueryRange,
  monthTitle,
  monthWeeks,
  shiftMonth,
  weekdayLabels,
} from './month-view';
import { elapsedOf, formatElapsed, progressOf, recordProgress, ringPath } from './display-format';
import {
  changeLabel,
  compareChange,
  previousFilter,
  previousLabel,
  previousPeriodRange,
} from './compare';
import type { Collection, NewComponent } from './schema';
import { registry } from './test-helpers';

// 阶段 C2（方案 P7）：月历外观、字段显示格式 elapsed / progress、统计的目标和「和上一段比」。
process.env.TZ = 'Europe/Paris';

const mood: Collection = {
  id: 'mood',
  name: 'Mood',
  fields: [
    {
      id: 'feel',
      name: 'Feel',
      type: 'choice',
      options: [
        { id: 'good', label: 'Good' },
        { id: 'ok', label: 'OK' },
        { id: 'bad', label: 'Bad' },
      ],
    },
    { id: 'date', name: 'Date', type: 'date', default: 'today' },
    { id: 'at', name: 'At', type: 'datetime' },
    { id: 'end', name: 'End', type: 'datetime' },
    { id: 'cups', name: 'Cups', type: 'number' },
    { id: 'goal', name: 'Goal', type: 'number' },
    { id: 'note', name: 'Note', type: 'text' },
  ],
};

let seq = 0;
const rec = (values: Record<string, unknown>, createdAt = Date.now()): DataRecord => ({
  id: `r${++seq}`,
  collectionId: 'mood',
  values,
  createdAt,
  updatedAt: createdAt,
});

const sunday: Calendar = { ...DEFAULT_CALENDAR, weekStart: 'sunday' };
const twoAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 2 };
const day = (s: string) => dayNumber(s)!;

describe('month calendar (D-302)', () => {
  it('lays out whole weeks, Monday or Sunday first', () => {
    // 2026-10-01 是周四，10-31 是周六。
    const mon = monthWeeks('2026-10', DEFAULT_CALENDAR);
    expect(mon).toHaveLength(5);
    expect(dateOfDayNumber(mon[0]![0]!)).toBe('2026-09-28');
    expect(dateOfDayNumber(mon.at(-1)![6]!)).toBe('2026-11-01');
    const sun = monthWeeks('2026-10', sunday);
    expect(dateOfDayNumber(sun[0]![0]!)).toBe('2026-09-27');
    expect(dateOfDayNumber(sun.at(-1)![6]!)).toBe('2026-10-31');
    // 2026-02 从周日开始的话正好四周。
    expect(monthWeeks('2026-02', sunday)).toHaveLength(4);
    for (const w of [...mon, ...sun]) expect(w).toHaveLength(7);
  });

  it('moves between months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', -14)).toBe('2025-08');
  });

  it('the current month follows when the day starts', () => {
    const earlyNov = new Date(2026, 10, 1, 1, 30);
    expect(currentMonth(earlyNov, DEFAULT_CALENDAR)).toBe('2026-11');
    expect(currentMonth(earlyNov, twoAm)).toBe('2026-10');
  });

  it('reads one month and one more day (an early-morning entry belongs to the day before)', () => {
    const r = monthQueryRange('2026-10');
    expect(r).toMatchObject({ from: '2026-10-01', until: '2026-11-02' });
    expect(r.fromMs).toBe(new Date(2026, 9, 1).getTime());
    expect(r.untilMs).toBe(new Date(2026, 10, 2).getTime());
  });

  it('counts entries per day and takes the latest choice of the day', () => {
    const now = new Date(2026, 9, 29, 12);
    const records = [
      rec({ date: '2026-10-03', feel: 'bad' }, new Date(2026, 9, 3, 9).getTime()),
      rec({ date: '2026-10-03', feel: 'good' }, new Date(2026, 9, 3, 20).getTime()),
      rec({ date: '2026-10-05' }),
      rec({ date: '2026-09-30', feel: 'ok' }),
      rec({ date: '2026-11-01', feel: 'ok' }),
      rec({ feel: 'ok' }),
    ];
    const { days, max } = monthDays(
      records,
      mood,
      { dateField: 'date', colorField: 'feel' },
      '2026-10',
      now,
      DEFAULT_CALENDAR,
    );
    expect([...days.keys()].map(dateOfDayNumber).sort()).toEqual(['2026-10-03', '2026-10-05']);
    expect(days.get(day('2026-10-03'))).toMatchObject({ count: 2, optionId: 'good' });
    expect(days.get(day('2026-10-05'))).toMatchObject({ count: 1, optionId: null });
    expect(days.get(day('2026-10-03'))!.records[0]!.values.feel).toBe('good');
    expect(max).toBe(2);
  });

  it('a datetime before the day start counts on the day before, also at the month edge', () => {
    const now = new Date(2026, 10, 5);
    const records = [rec({ at: '2026-11-01T01:30', feel: 'ok' }), rec({ at: '2026-10-31T23:00' })];
    const oct = monthDays(records, mood, { dateField: 'at' }, '2026-10', now, twoAm);
    expect(oct.days.get(day('2026-10-31'))?.count).toBe(2);
    const plain = monthDays(records, mood, { dateField: 'at' }, '2026-10', now, DEFAULT_CALENDAR);
    expect(plain.days.get(day('2026-10-31'))?.count).toBe(1);
    // 同一天按日期时间排：较晚的那条在前。
    const sameDay = [
      rec({ at: '2026-10-10T21:00', feel: 'bad' }),
      rec({ at: '2026-10-10T08:00', feel: 'good' }),
    ];
    const { days } = monthDays(
      sameDay,
      mood,
      { dateField: 'at', colorField: 'feel' },
      '2026-10',
      now,
      DEFAULT_CALENDAR,
    );
    expect(days.get(day('2026-10-10'))?.optionId).toBe('bad');
  });

  it('created time works as the date', () => {
    const records = [rec({}, new Date(2026, 9, 7, 10).getTime())];
    const { days } = monthDays(
      records,
      mood,
      { dateField: 'createdAt' },
      '2026-10',
      new Date(2026, 9, 8),
      DEFAULT_CALENDAR,
    );
    expect(days.get(day('2026-10-07'))?.count).toBe(1);
  });

  it('thousands of entries stay fast', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      rec({ date: dateOfDayNumber(day('2026-01-01') + (i % 300)), feel: i % 2 ? 'good' : 'bad' }),
    );
    const start = performance.now();
    const { days } = monthDays(
      many,
      mood,
      { dateField: 'date', colorField: 'feel' },
      '2026-10',
      new Date(2026, 9, 29),
      DEFAULT_CALENDAR,
    );
    expect(performance.now() - start).toBeLessThan(200);
    expect(days.size).toBe(27); // 300 天到 10 月 27 日为止
  });

  it('shade levels 1–4 relative to the busiest day', () => {
    expect(heatLevel(0, 5)).toBe(0);
    expect(heatLevel(1, 1)).toBe(4);
    expect(heatLevel(1, 3)).toBe(2);
    expect(heatLevel(1, 20)).toBe(1);
    expect(heatLevel(20, 20)).toBe(4);
    expect(heatLevel(2, 2)).toBe(4);
    expect(heatLevel(1, 2)).toBe(2);
  });

  it('month and weekday names in three languages', () => {
    expect(monthTitle('2026-10', 'zh')).toBe('2026年10月');
    expect(monthTitle('2026-10', 'en')).toBe('October 2026');
    expect(monthTitle('2026-10', 'fr')).toBe('octobre 2026');
    expect(weekdayLabels(DEFAULT_CALENDAR, 'zh')[0]).toBe('一');
    expect(weekdayLabels(sunday, 'zh')[0]).toBe('日');
    expect(weekdayLabels(DEFAULT_CALENDAR, 'en')).toHaveLength(7);
    expect(weekdayLabels(sunday, 'en')[0]).toBe('S');
    expect(weekdayLabels(DEFAULT_CALENDAR, 'fr')[0]).toBe('L');
  });
});

describe('display formats elapsed and progress (D-303)', () => {
  const now = new Date(2026, 9, 29, 10, 15, 30);

  it('a start without an end is a running timer', () => {
    const r = rec({ at: '2026-10-29T08:00' });
    expect(elapsedOf(r, mood, 'at', 'end', now)).toEqual({ seconds: 8130, running: true });
    expect(formatElapsed({ seconds: 8130, running: true })).toBe('2:15:30');
    expect(formatElapsed({ seconds: 59, running: true })).toBe('0:00:59');
  });

  it('a finished one shows the duration like a duration field', () => {
    const r = rec({ at: '2026-10-28T22:00', end: '2026-10-29T06:30' });
    const e = elapsedOf(r, mood, 'at', 'end', now);
    expect(e).toEqual({ seconds: 30600, running: false });
    expect(formatElapsed(e!)).toBe('8:30');
  });

  it('no start, a start in the future, or the created time', () => {
    expect(elapsedOf(rec({}), mood, 'at', 'end', now)).toBeUndefined();
    expect(elapsedOf(rec({ at: '2026-10-29T11:00' }), mood, 'at', undefined, now)).toEqual({
      seconds: 0,
      running: true,
    });
    const created = rec({}, now.getTime() - 90_000);
    expect(elapsedOf(created, mood, 'createdAt', undefined, now)).toEqual({
      seconds: 90,
      running: true,
    });
    // 结束早于开始：0，不是负数。
    expect(
      elapsedOf(rec({ at: '2026-10-29T08:00', end: '2026-10-29T07:00' }), mood, 'at', 'end', now),
    ).toEqual({ seconds: 0, running: false });
  });

  it('progress against a fixed goal or another field', () => {
    expect(progressOf(3, 5)).toEqual({ value: 3, goal: 5, ratio: 0.6, done: false });
    expect(progressOf(7, 5)).toEqual({ value: 7, goal: 5, ratio: 1, done: true });
    expect(progressOf(null, 5)).toBeUndefined();
    expect(progressOf(2, 0)).toBeUndefined();
    expect(progressOf(-1, 4)?.ratio).toBe(0);
    const r = rec({ cups: 6, goal: 8 });
    expect(recordProgress(r, mood, 'cups', 'goal', now)).toMatchObject({ ratio: 0.75 });
    expect(recordProgress(r, mood, 'cups', 10, now)).toMatchObject({ ratio: 0.6 });
    expect(recordProgress(rec({ cups: 6 }), mood, 'cups', 'goal', now)).toBeUndefined();
  });

  it('ring geometry', () => {
    expect(ringPath(20, 20, 10, 0)).toBe('');
    expect(ringPath(20, 20, 10, 0.25)).toBe('M20 10 A10 10 0 0 1 30 20');
    expect(ringPath(20, 20, 10, 0.75)).toMatch(/^M20 10 A10 10 0 1 1 /);
    expect(ringPath(20, 20, 10, 1)).toBe('M20 10 A10 10 0 1 1 20 30 A10 10 0 1 1 20 10');
  });
});

describe('stat compared with the previous period (D-305)', () => {
  const now = new Date(2026, 9, 29, 12); // 周四

  it('the same part of the previous period', () => {
    const cal = DEFAULT_CALENDAR;
    expect(previousPeriodRange('today', now, cal)).toEqual(['2026-10-28', '2026-10-28']);
    expect(previousPeriodRange('thisWeek', now, cal)).toEqual(['2026-10-19', '2026-10-22']);
    expect(previousPeriodRange('thisWeek', now, sunday)).toEqual(['2026-10-18', '2026-10-22']);
    expect(previousPeriodRange('thisMonth', now, cal)).toEqual(['2026-09-01', '2026-09-29']);
    expect(previousPeriodRange('thisYear', now, cal)).toEqual(['2025-01-01', '2025-10-29']);
    expect(previousPeriodRange('last7days', now, cal)).toEqual(['2026-10-16', '2026-10-22']);
    expect(previousPeriodRange('thisHalfMonth', now, cal)).toEqual(['2026-10-01', '2026-10-14']);
    expect(previousPeriodRange('thisHalfMonth', new Date(2026, 9, 3), cal)).toEqual([
      '2026-09-16',
      '2026-09-18',
    ]);
    expect(
      previousPeriodRange('thisTwoWeeks', now, { ...cal, twoWeekStart: '2026-10-19' }),
    ).toEqual(['2026-10-05', '2026-10-15']);
    // 3 月 31 日比 2 月：到 2 月底为止。
    expect(previousPeriodRange('thisMonth', new Date(2026, 2, 31), cal)).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    // 闰年 2 月 29 日比去年：到 2 月 28 日。
    expect(previousPeriodRange('thisYear', new Date(2028, 1, 29), cal)).toEqual([
      '2027-01-01',
      '2027-02-28',
    ]);
  });

  it('today starts at 2 am: 1:30 still compares yesterday with the day before', () => {
    expect(previousPeriodRange('today', new Date(2026, 9, 29, 1, 30), twoAm)).toEqual([
      '2026-10-27',
      '2026-10-27',
    ]);
  });

  it('swaps the period condition for the previous range and keeps the rest', () => {
    const filter = [
      { field: 'date', op: 'inPeriod' as const, value: 'thisMonth' },
      { field: 'feel', op: 'is' as const, value: 'good' },
    ];
    const prev = previousFilter(filter, now, DEFAULT_CALENDAR)!;
    expect(prev.period).toBe('thisMonth');
    const records = [
      rec({ date: '2026-09-29', feel: 'good' }),
      rec({ date: '2026-09-30', feel: 'good' }),
      rec({ date: '2026-09-01', feel: 'bad' }),
      rec({ date: '2026-09-01', feel: 'good' }),
      rec({ date: '2026-10-01', feel: 'good' }),
    ];
    expect(filterRecords(records, mood, prev.filter, now).map((r) => r.values.date)).toEqual([
      '2026-09-29',
      '2026-09-01',
    ]);
    expect(
      previousFilter([{ field: 'feel', op: 'is', value: 'good' }], now, DEFAULT_CALENDAR),
    ).toBeNull();
    expect(previousFilter(undefined, now, DEFAULT_CALENDAR)).toBeNull();
  });

  it('up, down, same; no percent from zero', () => {
    expect(compareChange(120, 100)).toEqual({ direction: 'up', percent: 20 });
    expect(compareChange(80, 100)).toEqual({ direction: 'down', percent: 20 });
    expect(compareChange(100, 100)).toEqual({ direction: 'same', percent: 0 });
    expect(compareChange(5, 0)).toEqual({ direction: 'up', percent: null });
    expect(compareChange(1, 3)).toEqual({ direction: 'down', percent: 67 });
    expect(compareChange(null, 3)).toBeNull();
    expect(compareChange(3, null)).toBeNull();
  });

  it('labels in three languages', () => {
    expect(previousLabel('thisMonth', '¥100.00', 'zh')).toBe('上月同期：¥100.00');
    expect(previousLabel('last30days', '12', 'en')).toBe('The 30 days before: 12');
    expect(previousLabel('today', '3', 'fr')).toBe('Hier : 3');
    expect(changeLabel(compareChange(120, 100), 'fr')).toBe('↑ 20 %');
    expect(changeLabel(compareChange(5, 0), 'zh')).toBe('↑ 增加');
    expect(changeLabel(compareChange(1, 1), 'en')).toBe('No change');
  });
});

describe('component checks (D-302–D-305)', () => {
  const add = (component: NewComponent) =>
    prepareOps(
      createDefaultWorkspace('en'),
      [
        { op: 'addCollection', collection: mood },
        { op: 'addComponent', pageId: 'home', component },
      ],
      { registry, locale: 'en', now: new Date(2026, 9, 29) },
    );
  const problems = (component: NewComponent) => {
    const result = add(component);
    return result.ok ? [] : result.issues;
  };
  const list = (props: Record<string, unknown>): NewComponent =>
    ({
      id: 'l',
      type: 'recordList',
      props: { collectionId: 'mood', display: 'list', titleField: 'feel', limit: 30, ...props },
    }) as NewComponent;
  const stat = (props: Record<string, unknown>): NewComponent =>
    ({
      id: 's',
      type: 'stat',
      props: { collectionId: 'mood', aggregate: 'sum', fieldId: 'cups', label: 'Cups', ...props },
    }) as NewComponent;

  it('accepts the four example apps', () => {
    expect(problems(list({ display: 'calendar', dateField: 'date', colorField: 'feel' }))).toEqual(
      [],
    );
    expect(problems(list({ display: 'calendar' }))).toEqual([]);
    expect(
      problems(list({ trailingField: 'at', trailingFormat: { kind: 'elapsed', until: 'end' } })),
    ).toEqual([]);
    expect(
      problems(list({ trailingField: 'cups', trailingFormat: { kind: 'progress', goal: 'goal' } })),
    ).toEqual([]);
    expect(
      problems(stat({ goal: 8, filter: [{ field: 'date', op: 'inPeriod', value: 'today' }] })),
    ).toEqual([]);
    expect(
      problems(
        stat({
          compare: 'previous',
          filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
        }),
      ),
    ).toEqual([]);
  });

  it('explains what is wrong', () => {
    const text = (c: NewComponent) => problems(c).join(' | ');
    expect(text(list({ display: 'calendar', colorField: 'note' }))).toMatch(
      /colorField note must be a choice field/,
    );
    expect(text(list({ display: 'calendar', dateField: 'cups' }))).toMatch(
      /dateField cups must be a date or datetime/,
    );
    expect(text(list({ colorField: 'feel' }))).toMatch(/only apply to display "calendar"/);
    expect(text(list({ trailingFormat: { kind: 'elapsed' } }))).toMatch(/needs trailingField/);
    expect(text(list({ trailingField: 'cups', trailingFormat: { kind: 'elapsed' } }))).toMatch(
      /elapsed needs trailingField set to a datetime field/,
    );
    expect(
      text(list({ trailingField: 'at', trailingFormat: { kind: 'elapsed', until: 'note' } })),
    ).toMatch(/until must be a datetime field/);
    expect(
      text(list({ trailingField: 'note', trailingFormat: { kind: 'progress', goal: 5 } })),
    ).toMatch(/progress needs trailingField set to a number/);
    expect(
      text(list({ trailingField: 'cups', trailingFormat: { kind: 'progress', goal: 'note' } })),
    ).toMatch(/goal note must be a number/);
    expect(text(stat({ compare: 'previous' }))).toMatch(/compare needs a filter with one inPeriod/);
    expect(
      text(
        stat({
          aggregate: 'streak',
          fieldId: undefined,
          compare: 'previous',
          filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
        }),
      ),
    ).toMatch(/compare can't be used with streak/);
    expect(text(stat({ aggregate: 'daysSince', fieldId: undefined, goal: 3 }))).toMatch(
      /goal can't be used with daysSince/,
    );
  });
});
