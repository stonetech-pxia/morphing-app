import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { prepareOps } from './change';
import {
  filterRecords,
  formatRef,
  prepareRecordValues,
  recordValue,
  sortRecords,
  type DataRecord,
} from './data';
import { createDefaultWorkspace } from './defaults';
import { dayNumber } from './formula';
import { readSchedule, scheduleStatus, scheduleText, type ScheduleRule } from './schedule';
import type { Collection, NewComponent } from './schema';
import { registry } from './test-helpers';

// 日程（D-292–D-296）。夏令时的用例按巴黎时间算。
process.env.TZ = 'Europe/Paris';

const d = (s: string) => dayNumber(s)!;
const date = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const sunday: Calendar = { ...DEFAULT_CALENDAR, weekStart: 'sunday' };

/** 规则在 today 那天的「下一次」（日期）、今天该不该做、过期几天。 */
function status(rule: ScheduleRule, done: string[], today: string, cal = DEFAULT_CALENDAR) {
  const s = scheduleStatus(rule, done.map(d), d(today), cal);
  return { next: date(s.next), due: s.dueToday, overdue: s.overdueDays };
}

describe('schedule rules without a last-done source', () => {
  // 2026-10-22 是星期四。
  it('every day is due today', () => {
    expect(status({ repeat: 'daily' }, [], '2026-10-22')).toEqual({
      next: '2026-10-22',
      due: true,
      overdue: 0,
    });
  });

  it('fixed weekdays find the next matching day', () => {
    const mwf: ScheduleRule = { repeat: 'weekdays', days: [1, 3, 5] };
    expect(status(mwf, [], '2026-10-22')).toEqual({ next: '2026-10-23', due: false, overdue: 0 });
    expect(status(mwf, [], '2026-10-23').due).toBe(true);
    // 周六 → 下周一。
    expect(status(mwf, [], '2026-10-24').next).toBe('2026-10-26');
    // 周日（7）。
    expect(status({ repeat: 'weekdays', days: [7] }, [], '2026-10-22').next).toBe('2026-10-25');
  });

  it('day 31 falls on the last day of shorter months, February and leap years included', () => {
    const on31: ScheduleRule = { repeat: 'monthDays', days: [31] };
    expect(status(on31, [], '2026-02-10').next).toBe('2026-02-28');
    expect(status(on31, [], '2028-02-10').next).toBe('2028-02-29');
    expect(status(on31, [], '2026-04-05').next).toBe('2026-04-30');
    expect(status(on31, [], '2026-05-01').next).toBe('2026-05-31');
    // 30 号在 2 月也落在月底。
    expect(status({ repeat: 'monthDays', days: [30] }, [], '2026-02-01').next).toBe('2026-02-28');
  });

  it('the last day of the month (-1) and several days of the month', () => {
    const last: ScheduleRule = { repeat: 'monthDays', days: [-1] };
    expect(status(last, [], '2026-04-30')).toEqual({ next: '2026-04-30', due: true, overdue: 0 });
    expect(status(last, [], '2026-12-31').due).toBe(true);
    expect(status(last, [], '2027-01-01').next).toBe('2027-01-31');
    const twice: ScheduleRule = { repeat: 'monthDays', days: [1, 15] };
    expect(status(twice, [], '2026-10-16').next).toBe('2026-11-01');
    expect(status(twice, [], '2026-12-20').next).toBe('2027-01-01');
  });

  it('a yearly day on 29 February falls on the 28th in other years', () => {
    const leap: ScheduleRule = { repeat: 'yearly', month: 2, day: 29 };
    expect(status(leap, [], '2026-03-01').next).toBe('2027-02-28');
    expect(status(leap, [], '2027-03-01').next).toBe('2028-02-29');
    const birthday: ScheduleRule = { repeat: 'yearly', month: 12, day: 25 };
    expect(status(birthday, [], '2026-12-25').due).toBe(true);
    expect(status(birthday, [], '2026-12-26').next).toBe('2027-12-25');
  });

  it('every N days and N times a period are due today when nothing was done yet', () => {
    expect(status({ repeat: 'interval', every: 7 }, [], '2026-10-22')).toEqual({
      next: '2026-10-22',
      due: true,
      overdue: 0,
    });
    expect(status({ repeat: 'times', per: 'week', count: 3 }, [], '2026-10-22').due).toBe(true);
  });
});

describe('schedule rules with the days it was done', () => {
  it('every N days counts from the last time', () => {
    const weekly: ScheduleRule = { repeat: 'interval', every: 7 };
    expect(status(weekly, ['2026-10-15'], '2026-10-22')).toEqual({
      next: '2026-10-22',
      due: true,
      overdue: 0,
    });
    expect(status(weekly, ['2026-10-10'], '2026-10-22')).toEqual({
      next: '2026-10-17',
      due: true,
      overdue: 5,
    });
    expect(status(weekly, ['2026-10-01', '2026-10-20'], '2026-10-22')).toEqual({
      next: '2026-10-27',
      due: false,
      overdue: 0,
    });
    // 跨月、跨年。
    expect(status({ repeat: 'interval', every: 60 }, ['2026-12-15'], '2026-12-20').next).toBe(
      '2027-02-13',
    );
    // 今天以后的不算（例如填错的日期）。
    expect(status(weekly, ['2026-10-15', '2026-11-30'], '2026-10-22').next).toBe('2026-10-22');
  });

  it('fixed days are overdue from the first one missed after the last time', () => {
    const daily: ScheduleRule = { repeat: 'daily' };
    expect(status(daily, ['2026-10-22'], '2026-10-22')).toEqual({
      next: '2026-10-23',
      due: false,
      overdue: 0,
    });
    expect(status(daily, ['2026-10-19'], '2026-10-22')).toEqual({
      next: '2026-10-20',
      due: true,
      overdue: 2,
    });
    const mwf: ScheduleRule = { repeat: 'weekdays', days: [1, 3, 5] };
    expect(status(mwf, ['2026-10-19'], '2026-10-22')).toEqual({
      next: '2026-10-21',
      due: true,
      overdue: 1,
    });
    // 订阅每月 31 号扣费，上次 1 月 31 日 → 2 月 28 日（跨月到月底）。
    expect(status({ repeat: 'monthDays', days: [31] }, ['2026-01-31'], '2026-02-01').next).toBe(
      '2026-02-28',
    );
  });

  it('3 times a week with 2 done this week is still due today', () => {
    const three: ScheduleRule = { repeat: 'times', per: 'week', count: 3 };
    // 2026-10-19 是周一。
    expect(status(three, ['2026-10-19', '2026-10-20'], '2026-10-22')).toEqual({
      next: '2026-10-22',
      due: true,
      overdue: 0,
    });
    // 今天做过了 → 明天。
    expect(status(three, ['2026-10-19', '2026-10-22'], '2026-10-22').next).toBe('2026-10-23');
    // 做够 3 次 → 下周一。
    expect(status(three, ['2026-10-19', '2026-10-20', '2026-10-21'], '2026-10-22')).toEqual({
      next: '2026-10-26',
      due: false,
      overdue: 0,
    });
    // 上周做的不算这周。
    expect(status(three, ['2026-10-14', '2026-10-15', '2026-10-16'], '2026-10-22').due).toBe(true);
    // 同一天做两次只算一天。
    expect(status(three, ['2026-10-19', '2026-10-19', '2026-10-19'], '2026-10-22').due).toBe(true);
  });

  it('a week starting on Sunday changes which days count as this week', () => {
    const three: ScheduleRule = { repeat: 'times', per: 'week', count: 3 };
    const done = ['2026-10-19', '2026-10-20', '2026-10-21'];
    // 2026-10-25 是周日：周一开始的一周已经做够，周日开始的一周刚开始。
    expect(status(three, done, '2026-10-25').next).toBe('2026-10-26');
    expect(status(three, done, '2026-10-25', sunday).due).toBe(true);
    // 周日开始的一周做够了 → 下一个周日。
    expect(status(three, done, '2026-10-22', sunday).next).toBe('2026-10-25');
  });

  it('two weeks, a month and a year as the period', () => {
    const month: ScheduleRule = { repeat: 'times', per: 'month', count: 2 };
    expect(status(month, ['2026-10-01', '2026-10-09'], '2026-10-22').next).toBe('2026-11-01');
    expect(status(month, ['2026-09-30'], '2026-10-01').due).toBe(true);
    const year: ScheduleRule = { repeat: 'times', per: 'year', count: 1 };
    expect(status(year, ['2026-03-01'], '2026-10-22').next).toBe('2027-01-01');
    const twoWeeks: ScheduleRule = { repeat: 'times', per: 'twoWeeks', count: 1 };
    const cal: Calendar = { ...DEFAULT_CALENDAR, twoWeekStart: '2026-10-12' };
    expect(status(twoWeeks, ['2026-10-13'], '2026-10-22', cal).next).toBe('2026-10-26');
    // 月底做最后一天：今天做过了，明天是下个月。
    expect(
      status({ repeat: 'times', per: 'month', count: 5 }, ['2026-10-31'], '2026-10-31').next,
    ).toBe('2026-11-01');
  });

  it('several times a day: due until done that many times', () => {
    const twice: ScheduleRule = { repeat: 'daily', perDay: 2 };
    expect(status(twice, ['2026-10-22'], '2026-10-22')).toEqual({
      next: '2026-10-22',
      due: true,
      overdue: 0,
    });
    expect(status(twice, ['2026-10-22', '2026-10-22'], '2026-10-22').next).toBe('2026-10-23');
  });
});

describe('reading and writing a schedule', () => {
  it('reads leniently: sorts and dedupes days, drops what does not fit', () => {
    expect(readSchedule({ repeat: 'weekdays', days: [5, 1, 3, 1] })).toEqual({
      repeat: 'weekdays',
      days: [1, 3, 5],
    });
    expect(readSchedule({ repeat: 'monthDays', days: [-1, 15, 1] })).toEqual({
      repeat: 'monthDays',
      days: [1, 15, -1],
    });
    expect(readSchedule({ repeat: 'interval', every: 61 })).toBeUndefined();
    expect(readSchedule({ repeat: 'interval', every: 0 })).toBeUndefined();
    expect(readSchedule({ repeat: 'weekdays', days: [] })).toBeUndefined();
    expect(readSchedule({ repeat: 'weekdays', days: [8] })).toBeUndefined();
    expect(readSchedule({ repeat: 'yearly', month: 2, day: 30 })).toBeUndefined();
    expect(readSchedule({ repeat: 'times', per: 'week', count: 8 })).toBeUndefined();
    expect(readSchedule({ repeat: 'hourly' })).toBeUndefined();
    expect(readSchedule('FREQ=DAILY')).toBeUndefined();
    // 不认识的属性丢掉，不是整条作废（恢复旧版本时）。
    expect(readSchedule({ repeat: 'daily', color: 'red' })).toEqual({ repeat: 'daily' });
    // perDay 1 是默认，不存。
    expect(readSchedule({ repeat: 'daily', perDay: 1 })).toEqual({ repeat: 'daily' });
  });

  it('shows the rule as a sentence in each language', () => {
    const cases: [ScheduleRule, string, string, string][] = [
      [{ repeat: 'daily' }, '每天', 'Every day', 'Tous les jours'],
      [
        { repeat: 'weekdays', days: [1, 3, 5] },
        '每周一、周三、周五',
        'Every Mon, Wed, Fri',
        'Chaque semaine : lun., mer., ven.',
      ],
      [
        { repeat: 'times', per: 'week', count: 3 },
        '每周 3 次',
        '3 times a week',
        '3 fois par semaine',
      ],
      [
        { repeat: 'times', per: 'month', count: 1 },
        '每月 1 次',
        'Once a month',
        'Une fois par mois',
      ],
      [
        { repeat: 'monthDays', days: [1, 15, -1] },
        '每月 1 号、15 号、最后一天',
        'Monthly: day 1, day 15, last day',
        'Chaque mois : le 1, le 15, le dernier jour',
      ],
      [{ repeat: 'interval', every: 7 }, '每 7 天', 'Every 7 days', 'Tous les 7 jours'],
      [{ repeat: 'interval', every: 1 }, '每 1 天', 'Every day', 'Tous les jours'],
      [
        { repeat: 'yearly', month: 3, day: 5 },
        '每年 3月5日',
        'Every year on March 5',
        'Chaque année le 5 mars',
      ],
      [
        { repeat: 'daily', perDay: 3 },
        '每天，一天 3 次',
        'Every day, 3 times a day',
        'Tous les jours, 3 fois par jour',
      ],
    ];
    for (const [rule, zh, en, fr] of cases) {
      expect([
        scheduleText(rule, 'zh'),
        scheduleText(rule, 'en'),
        scheduleText(rule, 'fr'),
      ]).toEqual([zh, en, fr]);
    }
  });
});

// ---- 记录上的日程：上次完成来自同一张表的日期字段 ----

const plants: Collection = {
  id: 'plants',
  name: 'Plants',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    {
      id: 'plan',
      name: 'Watering',
      type: 'schedule',
      default: { repeat: 'interval', every: 7 },
      lastDone: 'watered',
    },
    { id: 'watered', name: 'Watered', type: 'date' },
    { id: 'left', name: 'Days left', type: 'formula', expression: 'days(today, {plan})' },
  ],
};

let seq = 0;
const plant = (name: string, values: Record<string, unknown>): DataRecord => ({
  id: `p${++seq}`,
  collectionId: 'plants',
  values: { name, plan: { repeat: 'interval', every: 7 }, ...values },
  createdAt: seq,
  updatedAt: seq,
});

const now = new Date(2026, 9, 22, 9, 0); // 周四
const fern = plant('Fern', { watered: '2026-10-15' }); // 今天该浇
const cactus = plant('Cactus', { plan: { repeat: 'interval', every: 30 }, watered: '2026-10-20' });
const ivy = plant('Ivy', { watered: '2026-10-10' }); // 过期 5 天
const palm = plant('Palm', { plan: { repeat: 'interval', every: 3 }, watered: '2026-10-21' }); // 周六
const fresh = plant('Fresh', {}); // 没浇过 → 今天
const none = plant('None', { plan: undefined });
const all = [fern, cactus, ivy, palm, fresh, none];
const names = (rs: DataRecord[]) => rs.map((r) => r.values.name);

describe('schedules on records', () => {
  it('filters what is due today, overdue and due this week', () => {
    const due = (value: string, at = now, cal = DEFAULT_CALENDAR) =>
      names(filterRecords(all, plants, [{ field: 'plan', op: 'due', value }], at, cal));
    expect(due('today')).toEqual(['Fern', 'Ivy', 'Fresh']);
    expect(due('overdue')).toEqual(['Ivy']);
    expect(due('thisWeek')).toEqual(['Fern', 'Ivy', 'Palm', 'Fresh']);
    // 一周从周日开始：周四 → 这周到周六。
    expect(due('thisWeek', now, sunday)).toEqual(['Fern', 'Ivy', 'Palm', 'Fresh']);
    expect(due('thisWeek', new Date(2026, 9, 24, 9), sunday)).toEqual([
      'Fern',
      'Ivy',
      'Palm',
      'Fresh',
    ]);
    // 周日开始的一周，周日那天的「这周」到下周六，仙人掌 11-19 还不到。
    expect(due('thisWeek', new Date(2026, 9, 25, 9), sunday)).not.toContain('Cactus');
  });

  it('a day starting at 2 am: 1:30 is still the day before', () => {
    const twoAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 2 };
    const late = new Date(2026, 9, 23, 1, 30);
    const daily = { ...plants, fields: plants.fields.map((f) => f) };
    const fernTomorrow = plant('Late', { watered: '2026-10-16' }); // 10-23 到期
    expect(
      names(
        filterRecords(
          [fernTomorrow],
          daily,
          [{ field: 'plan', op: 'due', value: 'today' }],
          late,
          twoAm,
        ),
      ),
    ).toEqual([]);
    expect(
      names(
        filterRecords([fernTomorrow], daily, [{ field: 'plan', op: 'due', value: 'today' }], late),
      ),
    ).toEqual(['Late']);
  });

  it('a datetime last-done field done at 1:30 counts for the day before when a day starts at 2 am', () => {
    const twoAm: Calendar = { ...DEFAULT_CALENDAR, dayStartHour: 2 };
    const chores: Collection = {
      id: 'chores',
      name: 'Chores',
      fields: [
        { id: 'plan', name: 'Plan', type: 'schedule', lastDone: 'at' },
        { id: 'at', name: 'Done at', type: 'datetime' },
      ],
    };
    const r: DataRecord = {
      id: 'c1',
      collectionId: 'chores',
      values: { plan: { repeat: 'daily' }, at: '2026-10-23T01:30' },
      createdAt: 0,
      updatedAt: 0,
    };
    const at = new Date(2026, 9, 23, 10);
    const due = (cal: Calendar) =>
      filterRecords([r], chores, [{ field: 'plan', op: 'due', value: 'today' }], at, cal).length;
    // 0 点开始：今天做过了。2 点开始：1:30 算 22 号，23 号还没做。
    expect(due(DEFAULT_CALENDAR)).toBe(0);
    expect(due(twoAm)).toBe(1);
  });

  it('the day the clocks change does not shift the next date', () => {
    // 巴黎 2026-03-29 和 2026-10-25 换夏令时。
    const spring = plant('Spring', {
      plan: { repeat: 'interval', every: 1 },
      watered: '2026-03-28',
    });
    const autumn = plant('Autumn', {
      plan: { repeat: 'interval', every: 1 },
      watered: '2026-10-24',
    });
    const today = (r: DataRecord, at: Date) =>
      filterRecords([r], plants, [{ field: 'plan', op: 'due', value: 'today' }], at).length;
    expect(today(spring, new Date(2026, 2, 29, 23, 30))).toBe(1);
    expect(today(spring, new Date(2026, 2, 29, 0, 30))).toBe(1);
    expect(today(autumn, new Date(2026, 9, 25, 23, 30))).toBe(1);
    expect(recordValue(autumn, plants, 'left', new Date(2026, 9, 25, 23, 30))).toBe(0);
  });

  it('sorts by the next date, entries without a schedule last', () => {
    const sorted = sortRecords(all, plants, { field: 'plan', direction: 'asc' }, now);
    // 同一天的按创建时间从新到旧（Fresh 比 Fern 新）。
    expect(names(sorted)).toEqual(['Ivy', 'Fresh', 'Fern', 'Palm', 'Cactus', 'None']);
  });

  it('formulas read the next date, inPeriod and gt / lt use it too', () => {
    expect(recordValue(ivy, plants, 'left', now)).toBe(-5);
    expect(recordValue(palm, plants, 'left', now)).toBe(2);
    expect(recordValue(none, plants, 'left', now)).toBeUndefined();
    expect(
      names(
        filterRecords(all, plants, [{ field: 'plan', op: 'inPeriod', value: 'thisMonth' }], now),
      ),
    ).toEqual(['Fern', 'Ivy', 'Palm', 'Fresh']);
    expect(
      names(filterRecords(all, plants, [{ field: 'plan', op: 'gt', value: '2026-10-22' }], now)),
    ).toEqual(['Cactus', 'Palm']);
  });

  it('shows the rule and when it is next due', () => {
    expect(formatRef(fern, plants, 'plan', 'zh', undefined, now)).toBe('每 7 天 · 今天');
    expect(formatRef(ivy, plants, 'plan', 'en', undefined, now)).toBe(
      'Every 7 days · 5 days overdue',
    );
    expect(formatRef(palm, plants, 'plan', 'fr', undefined, now)).toBe(
      'Tous les 3 jours · Prochaine : 24 oct.',
    );
    expect(
      formatRef(plant('One', { watered: '2026-10-14' }), plants, 'plan', 'fr', undefined, now),
    ).toBe('Tous les 7 jours · En retard de 1 jour');
    expect(
      formatRef(plant('Tmw', { watered: '2026-10-16' }), plants, 'plan', 'en', undefined, now),
    ).toBe('Every 7 days · Tomorrow');
    expect(formatRef(none, plants, 'plan', 'en', undefined, now)).toBe('');
  });

  it('a new entry starts with the default rule; the form writes a rule', () => {
    const fresh = prepareRecordValues(plants, { name: 'New' }, null, now);
    expect(fresh).toEqual({
      ok: true,
      values: { name: 'New', plan: { repeat: 'interval', every: 7 } },
    });
    const bad = prepareRecordValues(plants, { plan: { repeat: 'interval', every: 99 } }, null, now);
    expect(bad).toEqual({ ok: false, issues: [{ fieldId: 'plan', code: 'invalid' }] });
    const cleared = prepareRecordValues(plants, { plan: '' }, { plan: { repeat: 'daily' } }, now);
    expect(cleared).toEqual({ ok: true, values: {} });
  });
});

describe('checking schedule fields and filters', () => {
  const problems = (ops: unknown[]) => {
    const r = prepareOps(
      createDefaultWorkspace('en'),
      [{ op: 'addCollection', collection: plants }, ...ops],
      { registry, locale: 'en', now },
    );
    return r.ok ? [] : r.issues.map(String);
  };

  it('last done must be a date, datetime or rollup field of the same table', () => {
    const field = (lastDone: string) => ({
      op: 'addField',
      collectionId: 'plants',
      field: { id: 'plan2', name: 'Plan 2', type: 'schedule', lastDone },
    });
    expect(problems([field('watered')])).toEqual([]);
    expect(problems([field('name')]).join()).toMatch(
      /lastDone name must be a date, datetime or rollup field/,
    );
    expect(problems([field('nope')]).join()).toMatch(/lastDone nope/);
  });

  it('the default rule follows the rule limits', () => {
    expect(
      problems([
        {
          op: 'addField',
          collectionId: 'plants',
          field: {
            id: 'p3',
            name: 'P3',
            type: 'schedule',
            default: { repeat: 'interval', every: 90 },
          },
        },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it('due needs a schedule field and one of today, overdue, thisWeek', () => {
    const list = (filter: unknown): NewComponent =>
      ({
        id: 'l',
        type: 'recordList',
        props: { collectionId: 'plants', display: 'list', titleField: 'name', limit: 30, filter },
      }) as never;
    const add = (filter: unknown) => [
      { op: 'addComponent', pageId: 'home', component: list(filter) },
    ];
    expect(problems(add([{ field: 'plan', op: 'due', value: 'today' }]))).toEqual([]);
    expect(problems(add([{ field: 'plan', op: 'due', value: 'soon' }])).join()).toMatch(
      /today, overdue, thisWeek/,
    );
    expect(problems(add([{ field: 'watered', op: 'due', value: 'today' }])).join()).toMatch(
      /due needs a schedule field/,
    );
  });
});
