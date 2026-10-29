import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { prepareOps } from './change';
import type { DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import type { Collection, NewComponent } from './schema';
import {
  avgInterval,
  daysSince,
  distinctDays,
  sequenceValue,
  streakOf,
  type StreakRule,
} from './sequence';
import { registry } from './test-helpers';

// 按顺序的聚合（D-284）和一天 / 一周从何时开始（D-286）。夏令时的用例按巴黎时间算。
process.env.TZ = 'Europe/Paris';

const log: Collection = {
  id: 'log',
  name: 'Log',
  fields: [
    {
      id: 'habit',
      name: 'Habit',
      type: 'choice',
      options: [
        { id: 'run', label: 'Run' },
        { id: 'read', label: 'Read' },
      ],
    },
    {
      id: 'status',
      name: 'Status',
      type: 'choice',
      options: [
        { id: 'done', label: 'Done' },
        { id: 'skip', label: 'Skip' },
      ],
    },
    { id: 'date', name: 'Date', type: 'date', default: 'today' },
  ],
};

let seq = 0;
const on = (date: string, status = 'done'): DataRecord => ({
  id: `r${++seq}`,
  collectionId: 'log',
  values: { date, status },
  createdAt: 0,
  updatedAt: 0,
});
const at = (createdAt: Date): DataRecord => ({
  id: `r${++seq}`,
  collectionId: 'log',
  values: {},
  createdAt: createdAt.getTime(),
  updatedAt: createdAt.getTime(),
});

const daily: StreakRule = { unit: 'day', perUnit: 1 };
const ctx = (now: Date, dateField = 'date', cal: Calendar = DEFAULT_CALENDAR) => ({
  dateField,
  now,
  cal,
});
const thursday = new Date(2026, 9, 22, 9, 0); // 2026-10-22 周四

describe('streakOf (D-284)', () => {
  it('empty table: no streak', () => {
    expect(streakOf([], log, daily, ctx(thursday))).toEqual({ current: 0, best: 0 });
  });

  it('counts back from today; today not logged yet does not break it', () => {
    const records = ['2026-10-19', '2026-10-20', '2026-10-21'].map((d) => on(d));
    expect(streakOf(records, log, daily, ctx(thursday))).toEqual({ current: 3, best: 3 });
    expect(streakOf([...records, on('2026-10-22')], log, daily, ctx(thursday))).toEqual({
      current: 4,
      best: 4,
    });
    // 到第二天还没记才断。
    expect(streakOf(records, log, daily, ctx(new Date(2026, 9, 23, 9)))).toEqual({
      current: 0,
      best: 3,
    });
  });

  it('keeps the best streak after a break; several entries on one day count once', () => {
    const records = [
      ...['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => on(d)),
      on('2026-10-20'),
      on('2026-10-21'),
      on('2026-10-21'),
    ];
    expect(streakOf(records, log, daily, ctx(thursday))).toEqual({ current: 2, best: 4 });
  });

  it('runs across a month and a year end', () => {
    const month = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => on(d));
    expect(streakOf(month, log, daily, ctx(new Date(2026, 9, 2, 20)))).toEqual({
      current: 4,
      best: 4,
    });
    const year = ['2026-12-30', '2026-12-31', '2027-01-01'].map((d) => on(d));
    expect(streakOf(year, log, daily, ctx(new Date(2027, 0, 2, 8)))).toEqual({
      current: 3,
      best: 3,
    });
  });

  it('a skipped day neither breaks nor adds', () => {
    const records = [on('2026-10-19'), on('2026-10-20', 'skip'), on('2026-10-21')];
    const rule: StreakRule = { ...daily, skip: { fieldId: 'status', optionId: 'skip' } };
    expect(streakOf(records, log, rule, ctx(thursday))).toEqual({ current: 2, best: 2 });
    // 不设跳过时，「跳过」那条也算记了一笔。
    expect(streakOf(records, log, daily, ctx(thursday))).toEqual({ current: 3, best: 3 });
    // 今天标了跳过：不断，也不加。
    expect(streakOf([...records, on('2026-10-22', 'skip')], log, rule, ctx(thursday))).toEqual({
      current: 2,
      best: 2,
    });
  });

  it('weekly goal: at least 3 entries a week; this week is not over yet', () => {
    const rule: StreakRule = { unit: 'week', perUnit: 3 };
    const records = [
      // 09-28 那周 3 次、10-05 那周 3 次、10-12 那周 2 次（没达到，断），本周（10-19 起）1 次。
      ...['2026-09-28', '2026-09-30', '2026-10-02'].map((d) => on(d)),
      ...['2026-10-05', '2026-10-06', '2026-10-08'].map((d) => on(d)),
      ...['2026-10-13', '2026-10-15'].map((d) => on(d)),
      on('2026-10-20'),
    ];
    // 本周只有 1 次，还没过完：当前 0（上一周没达到），最佳 2。
    expect(streakOf(records, log, rule, ctx(thursday))).toEqual({ current: 0, best: 2 });
    const more = [...records, on('2026-10-13'), on('2026-10-21'), on('2026-10-22')];
    expect(streakOf(more, log, rule, ctx(thursday))).toEqual({ current: 4, best: 4 });
  });

  it('weeks can start on Sunday', () => {
    const rule: StreakRule = { unit: 'week', perUnit: 1 };
    const sunday: Calendar = { ...DEFAULT_CALENDAR, weekStart: 'sunday' };
    const records = [on('2026-10-04'), on('2026-10-17'), on('2026-10-18')];
    // 周一开始：10-04 在 09-28 那周，10-17 和 10-18 都在 10-12 那周，本周（10-19）还没记。
    expect(streakOf(records, log, rule, ctx(thursday))).toEqual({ current: 1, best: 1 });
    // 周日开始：10-04 那周、10-11 那周（10-17）、10-18 那周（就是本周）：连续 3 周。
    expect(streakOf(records, log, rule, ctx(thursday, 'date', sunday))).toEqual({
      current: 3,
      best: 3,
    });
  });

  it('monthly streaks', () => {
    const rule: StreakRule = { unit: 'month', perUnit: 2 };
    const records = ['2026-08-01', '2026-08-31', '2026-09-10', '2026-09-11', '2026-10-01'].map(
      (d) => on(d),
    );
    expect(streakOf(records, log, rule, ctx(thursday))).toEqual({ current: 2, best: 2 });
  });

  it('a day can start at 2 am: an entry made at 1:30 belongs to the day before', () => {
    const twoAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 2 };
    const records = [
      at(new Date(2026, 9, 20, 23, 0)),
      at(new Date(2026, 9, 22, 1, 30)), // 算 10-21
    ];
    // 现在是 10-22 早上 1:45：还是 10-21。
    const lateNight = new Date(2026, 9, 22, 1, 45);
    expect(streakOf(records, log, daily, ctx(lateNight, 'createdAt', twoAm))).toEqual({
      current: 2,
      best: 2,
    });
    // 一天从 0 点开始时，1:30 那条算 10-22，中间 10-21 断了。
    expect(streakOf(records, log, daily, ctx(lateNight, 'createdAt'))).toEqual({
      current: 1,
      best: 1,
    });
  });

  it('daylight saving time changes do not add or lose a day', () => {
    // 巴黎 2026-03-29 凌晨 2 点跳到 3 点，2026-10-25 凌晨 3 点退回 2 点。
    const spring = ['2026-03-28', '2026-03-29', '2026-03-30'].map((d) => new Date(`${d}T21:00:00`));
    expect(
      streakOf(spring.map(at), log, daily, ctx(new Date(2026, 2, 30, 22), 'createdAt')),
    ).toEqual({ current: 3, best: 3 });
    const autumn = [
      new Date(2026, 9, 24, 23, 30),
      new Date(2026, 9, 25, 2, 30), // 一天从 3 点开始时算 10-24
      new Date(2026, 9, 26, 3, 30),
    ];
    const threeAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 3 };
    expect(
      streakOf(autumn.map(at), log, daily, ctx(new Date(2026, 9, 26, 9), 'createdAt', threeAm)),
    ).toEqual({ current: 1, best: 1 });
    expect(
      streakOf(autumn.map(at), log, daily, ctx(new Date(2026, 9, 26, 9), 'createdAt')),
    ).toEqual({ current: 3, best: 3 });
  });

  it('ignores entries without a date and entries in the future', () => {
    const records = [on('2026-10-21'), on('2026-10-30'), { ...on('x'), values: {} }];
    expect(streakOf(records, log, daily, ctx(thursday))).toEqual({ current: 1, best: 1 });
  });
});

describe('daysSince, avgInterval, distinctDays (D-284)', () => {
  it('empty table', () => {
    expect(daysSince([], log, ctx(thursday))).toBeNull();
    expect(avgInterval([], log, ctx(thursday))).toBeNull();
    expect(distinctDays([], log, ctx(thursday))).toBe(0);
  });

  it('days since the latest entry up to today', () => {
    const records = [on('2026-10-01'), on('2026-10-19'), on('2026-11-30')];
    expect(daysSince(records, log, ctx(thursday))).toBe(3);
    expect(daysSince([...records, on('2026-10-22')], log, ctx(thursday))).toBe(0);
  });

  it('average gap between entry days (a period-tracker cycle)', () => {
    const records = [on('2026-07-01'), on('2026-07-29'), on('2026-08-27'), on('2026-08-27')];
    // 28 天和 29 天。
    expect(avgInterval(records, log, ctx(thursday))).toBe(28.5);
    expect(avgInterval([on('2026-07-01')], log, ctx(thursday))).toBeNull();
  });

  it('counts days with at least one entry, by the logical day', () => {
    const twoAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 2 };
    const records = [at(new Date(2026, 9, 20, 22)), at(new Date(2026, 9, 21, 1))];
    expect(distinctDays(records, log, ctx(thursday, 'createdAt'))).toBe(2);
    expect(distinctDays(records, log, ctx(thursday, 'createdAt', twoAm))).toBe(1);
  });
});

describe('stat and chart with these aggregates (D-284)', () => {
  const changeCtx = { registry, locale: 'en' as const, now: thursday };
  const add = (component: NewComponent) =>
    prepareOps(
      createDefaultWorkspace('en'),
      [
        { op: 'addCollection', collection: log },
        { op: 'addComponent', pageId: 'home', component },
      ],
      changeCtx,
    );
  const stat = (props: Record<string, unknown>): NewComponent =>
    ({
      id: 's',
      type: 'stat',
      props: { collectionId: 'log', label: 'Streak', ...props },
    }) as NewComponent;
  const problems = (component: NewComponent) => {
    const result = add(component);
    return result.ok ? [] : result.issues;
  };

  it('a streak per habit, with a skip option', () => {
    expect(
      problems(
        stat({
          aggregate: 'streak',
          unit: 'week',
          perUnit: 3,
          groupBy: 'habit',
          skipField: 'status',
          skipOption: 'skip',
        }),
      ),
    ).toEqual([]);
    expect(problems(stat({ aggregate: 'daysSince', dateField: 'createdAt' }))).toEqual([]);
  });

  it('explains what is wrong', () => {
    expect(String(problems(stat({ aggregate: 'sum', unit: 'week' })))).toMatch(
      /only apply to aggregate "streak"/,
    );
    expect(
      String(problems(stat({ aggregate: 'streak', skipField: 'status', skipOption: 'nope' }))),
    ).toMatch(/skipOption must be an option id of status/);
    expect(String(problems(stat({ aggregate: 'streak', skipField: 'habit' })))).toMatch(
      /skipField and skipOption go together/,
    );
    expect(String(problems(stat({ aggregate: 'avgInterval', dateField: 'habit' })))).toMatch(
      /dateField/,
    );
  });

  it('a chart can count days with entries, but cannot draw a streak', () => {
    const chart = (aggregate: string): NewComponent =>
      ({
        id: 'c',
        type: 'chart',
        props: { collectionId: 'log', kind: 'bar', aggregate, group: 'week', title: 'Days' },
      }) as NewComponent;
    expect(problems(chart('distinctDays'))).toEqual([]);
    expect(String(problems(chart('streak')))).toMatch(/use a stat/);
  });

  it('stat values', () => {
    const records = ['2026-10-20', '2026-10-21'].map((d) => on(d));
    const spec = { aggregate: 'streak' as const, unit: 'day' as const };
    expect(sequenceValue(records, log, spec, ctx(thursday))).toEqual({ value: 2, best: 2 });
    expect(sequenceValue(records, log, { aggregate: 'daysSince' }, ctx(thursday))).toEqual({
      value: 1,
    });
  });
});
