import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from './calendar';
import { prepareOps } from './change';
import { sortRecords, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import { dayNumber } from './formula';
import { filterPresets, listGroups } from './list-groups';
import { monthDays } from './month-view';
import type { Collection } from './schema';
import { registry } from './test-helpers';

// 记录列表分段（D-347）、月历认日程（D-348）、就地添加带上的值（D-349）。2026-10-30 是周五。
const now = new Date(2026, 9, 30, 9);
const cal = DEFAULT_CALENDAR;

const tasks: Collection = {
  id: 'tasks',
  name: 'Tasks',
  fields: [
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'plan', name: 'Plan', type: 'schedule' },
    {
      id: 'section',
      name: 'Section',
      type: 'choice',
      options: [
        { id: 'a', label: 'Section A' },
        { id: 'b', label: 'Section B' },
        { id: 'c', label: 'Section C' },
      ],
    },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'done', name: 'Done', type: 'checkbox' },
  ],
};
let seq = 0;
const task = (title: string, values: Record<string, unknown>): DataRecord => ({
  id: title,
  collectionId: 'tasks',
  values: { title, ...values },
  createdAt: ++seq,
  updatedAt: seq,
});
const titles = (rs: DataRecord[]) => rs.map((r) => r.values.title);

describe('sections in a list', () => {
  const list = [
    task('One', { section: 'a' }),
    task('Two', { section: 'b' }),
    task('Three', { section: 'a' }),
    task('Loose', {}),
  ];

  it('one section per option in option order, empty ones only when asked, not set last', () => {
    const groups = listGroups(list, tasks, 'section', { locale: 'en', now, cal });
    expect(groups.map((g) => [g.label, titles(g.records), g.preset])).toEqual([
      ['Section A', ['One', 'Three'], 'a'],
      ['Section B', ['Two'], 'b'],
      ['Not set', ['Loose'], undefined],
    ]);
    const all = listGroups(list, tasks, 'section', { locale: 'en', now, cal, showEmpty: true });
    expect(all.map((g) => g.label)).toEqual(['Section A', 'Section B', 'Section C', 'Not set']);
  });

  it('by the next date of a schedule: overdue first, then each day in order, no date last', () => {
    const plans = [
      task('Tomorrow', { plan: { repeat: 'once', date: '2026-10-31' } }),
      task('Late', { plan: { repeat: 'once', date: '2026-10-27' } }),
      task('Someday', { plan: { repeat: 'once' } }),
      task('Today', { plan: { repeat: 'daily' } }),
      task('Monday', { plan: { repeat: 'weekdays', days: [1] } }),
    ];
    const sorted = sortRecords(plans, tasks, { field: 'plan', direction: 'asc' }, now, cal);
    const groups = listGroups(sorted, tasks, 'plan', { locale: 'zh', now, cal });
    expect(groups.map((g) => [g.label, titles(g.records)])).toEqual([
      ['已过期', ['Late']],
      ['今天 · 10月30日 周五', ['Today']],
      ['明天 · 10月31日 周六', ['Tomorrow']],
      ['11月2日 周一', ['Monday']],
      ['不定日期', ['Someday']],
    ]);
    // 在某一天添加 = 「一次，这一天」；已过期、不定日期没有预设。
    expect(groups[2]!.preset).toEqual({ repeat: 'once', date: '2026-10-31' });
    expect(groups[0]!.preset).toBeUndefined();
    expect(groups[4]!.preset).toBeUndefined();
  });

  it('a date field by day, week or month in three languages', () => {
    const dated = [
      task('A', { due: '2026-10-30' }),
      task('B', { due: '2026-11-03' }),
      task('C', { due: '2026-11-20' }),
    ];
    expect(listGroups(dated, tasks, 'due', { locale: 'en', now, cal }).map((g) => g.label)).toEqual(
      ['Today · Fri, Oct 30', 'Tue, Nov 3', 'Fri, Nov 20'],
    );
    const weeks = listGroups(dated, tasks, 'due', { locale: 'fr', now, cal, unit: 'week' });
    expect(weeks.map((g) => g.label)).toEqual([
      'Semaine du 26 oct.',
      'Semaine du 2 nov.',
      'Semaine du 16 nov.',
    ]);
    expect(weeks[0]!.preset).toBeUndefined();
    const months = listGroups(dated, tasks, 'due', { locale: 'zh', now, cal, unit: 'month' });
    expect(months.map((g) => [g.label, g.records.length])).toEqual([
      ['2026年10月', 1],
      ['2026年11月', 2],
    ]);
    expect(listGroups(dated, tasks, 'due', { locale: 'en', now, cal })[1]!.preset).toBe(
      '2026-11-03',
    );
  });
});

describe('what adding here fills in from the list filter', () => {
  it('takes equal-to conditions on choices, links and checkboxes; nothing else', () => {
    expect(
      filterPresets(tasks, [
        { field: 'section', op: 'is', value: 'b' },
        { field: 'done', op: 'is', value: false },
        { field: 'section', op: 'isNot', value: 'a' },
        { field: 'due', op: 'inPeriod', value: 'thisWeek' },
        { field: 'title', op: 'is', value: 'x' },
      ]),
    ).toEqual({ section: 'b', done: false });
  });
});

describe('a calendar on a schedule field', () => {
  it('shows each coming time in the month; overdue on today; a finished once not at all', () => {
    const plans = [
      task('Weekly', { plan: { repeat: 'weekdays', days: [1] } }),
      task('Late', { plan: { repeat: 'once', date: '2026-10-20' } }),
      task('Nov 5', { plan: { repeat: 'once', date: '2026-11-05' } }),
    ];
    const october = monthDays(plans, tasks, { dateField: 'plan' }, '2026-10', now, cal).days;
    expect([...october.keys()].map((d) => new Date(d * 86_400_000).getUTCDate())).toEqual([30]);
    expect(titles(october.get(dayNumber('2026-10-30')!)!.records)).toEqual(['Late']);
    const november = monthDays(plans, tasks, { dateField: 'plan' }, '2026-11', now, cal).days;
    const mondays = [2, 9, 16, 23, 30].map((d) =>
      dayNumber(`2026-11-${String(d).padStart(2, '0')}`)!,
    );
    for (const d of mondays) expect(titles(november.get(d)!.records)).toEqual(['Weekly']);
    expect(titles(november.get(dayNumber('2026-11-05')!)!.records)).toEqual(['Nov 5']);
    // 过去的月份：重复的没有记录可查，不显示。
    expect(monthDays(plans, tasks, { dateField: 'plan' }, '2026-09', now, cal).days.size).toBe(0);
  });
});

describe('checking sections and adding here', () => {
  const problems = (props: Record<string, unknown>) => {
    const r = prepareOps(
      createDefaultWorkspace('en'),
      [
        { op: 'addCollection', collection: tasks },
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'l',
            type: 'recordList',
            props: {
              collectionId: 'tasks',
              display: 'list',
              titleField: 'title',
              limit: 30,
              ...props,
            },
          },
        },
      ],
      { registry, locale: 'en', now },
    );
    return r.ok ? [] : r.issues.map(String);
  };

  it('accepts sections by choice, date and schedule, and a calendar on a schedule', () => {
    expect(problems({ groupBy: 'section', showEmpty: true, addHere: true })).toEqual([]);
    expect(problems({ groupBy: 'due', groupUnit: 'week' })).toEqual([]);
    expect(problems({ groupBy: 'plan' })).toEqual([]);
    expect(problems({ display: 'calendar', dateField: 'plan', addHere: true })).toEqual([]);
  });

  it('explains what does not fit', () => {
    expect(problems({ groupBy: 'title' }).join()).toMatch(/groupBy title must be a choice, link/);
    expect(problems({ groupBy: 'section', groupUnit: 'week' }).join()).toMatch(
      /groupUnit only applies/,
    );
    expect(problems({ groupBy: 'due', showEmpty: true }).join()).toMatch(/showEmpty only applies/);
    expect(
      problems({ display: 'board', groupField: 'section', groupBy: 'section' }).join(),
    ).toMatch(/groupBy only applies/);
    expect(problems({ groupUnit: 'day' }).join()).toMatch(/need groupBy/);
  });
});
