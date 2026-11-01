import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from './calendar';
import type { DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import { dayNumber } from './formula';
import type { Collection, WorkspaceConfig } from './schema';
import {
  dayShown,
  dayValue,
  filesFilter,
  hereValues,
  readChart,
  readFiles,
  readNumber,
  readRecords,
  readTable,
  sourceTableIds,
  type FileMeta,
  type SourceContext,
} from './source';

// 共用的读法（source.ts）：每种外观从 source 读出什么。2026-10-22 是周四。
const now = new Date(2026, 9, 22, 9);

const projects: Collection = {
  id: 'projects',
  name: 'Projects',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'area', name: 'Area', type: 'text' },
  ],
};
const tasks: Collection = {
  id: 'tasks',
  name: 'Tasks',
  fields: [
    { id: 'title', name: 'Title', type: 'text' },
    {
      id: 'status',
      name: 'Status',
      type: 'choice',
      options: [
        { id: 'todo', label: 'To do' },
        { id: 'done', label: 'Done' },
      ],
    },
    { id: 'project', name: 'Project', type: 'link', table: 'projects' },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'plan', name: 'Plan', type: 'schedule' },
    { id: 'cost', name: 'Cost', type: 'number' },
    { id: 'area', name: 'Area', type: 'lookup', via: 'project', field: 'area' },
  ],
};

const record = (
  table: string,
  id: string,
  values: Record<string, unknown>,
  createdAt = 0,
): DataRecord => ({ id, collectionId: table, values, createdAt, updatedAt: createdAt });

const projectRecords = [
  record('projects', 'p1', { name: 'Home', area: 'life' }, 1),
  record('projects', 'p2', { name: 'Work', area: 'job' }, 2),
];
const taskRecords = [
  record(
    'tasks',
    't1',
    { title: 'A', status: 'todo', project: 'p1', due: '2026-10-20', cost: 5 },
    1,
  ),
  record(
    'tasks',
    't2',
    { title: 'B', status: 'done', project: 'p2', due: '2026-10-22', cost: 7 },
    2,
  ),
  record(
    'tasks',
    't3',
    { title: 'C', status: 'todo', project: 'p1', due: '2026-10-22', cost: 1 },
    3,
  ),
  record('tasks', 't4', { title: 'D', due: '2026-09-30', cost: 10 }, 4),
  record('tasks', 't5', { title: 'E', status: 'todo', due: '2026-09-21' }, 5),
];

const config: WorkspaceConfig = {
  ...createDefaultWorkspace('en'),
  data: { tables: [projects, tasks] },
};
const ctx = (more: Partial<SourceContext> = {}): SourceContext => ({
  config,
  records: new Map([
    ['projects', projectRecords],
    ['tasks', taskRecords],
  ]),
  now,
  locale: 'en',
  ...more,
});
const ids = (list: readonly DataRecord[]) => list.map((r) => r.id);

describe('a table read once per context, computed values filled in', () => {
  it('lookup values are there and the view shows them as the looked-up field', () => {
    const c = ctx();
    const read = readTable(c, 'tasks')!;
    expect(read.records.find((r) => r.id === 't1')!.values.area).toBe('life');
    expect(read.view.fields.find((f) => f.id === 'area')!.type).toBe('text');
    expect(read.table).toBe(tasks);
    expect(readTable(c, 'tasks')).toBe(read);
    expect(readTable(c, 'nope')).toBeUndefined();
  });

  it('lists the tables a source needs', () => {
    expect(sourceTableIds({ table: 'tasks' }, config).sort()).toEqual(['projects', 'tasks']);
    expect(sourceTableIds({ table: 'projects', minus: { table: 'tasks' } }, config).sort()).toEqual(
      ['projects', 'tasks'],
    );
    expect(sourceTableIds({ table: 'nope' }, config)).toEqual([]);
  });
});

describe('records blocks', () => {
  const list = (source: Record<string, unknown>, look = 'list') =>
    readRecords({ look, source: { table: 'tasks', limit: 10, ...source } } as never, ctx())!;

  it('filters (also on a looked-up value), sorts and keeps limit', () => {
    const read = list({
      filter: [{ field: 'area', op: 'is', value: 'life' }],
      sort: { field: 'cost', direction: 'desc' },
    });
    expect(ids(read.rows)).toEqual(['t1', 't3']);
    expect(ids(list({ limit: 2 }).shown)).toEqual(['t5', 't4']);
    expect(list({}).groups).toBeUndefined();
    expect(
      readRecords({ look: 'list', source: { table: 'nope', limit: 3 } }, ctx()),
    ).toBeUndefined();
  });

  it('"$record" is the entry the page was opened for', () => {
    const source = {
      table: 'tasks',
      limit: 10,
      filter: [{ field: 'project', op: 'is' as const, value: '$record' }],
    };
    expect(ids(readRecords({ look: 'list', source }, ctx({ recordId: 'p2' }))!.rows)).toEqual([
      't2',
    ]);
    expect(readRecords({ look: 'list', source }, ctx())!.rows).toEqual([]);
  });

  it('tiles show at most 24', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      record('tasks', `x${i}`, { title: `${i}` }, i),
    );
    const read = readRecords(
      { look: 'tiles', source: { table: 'tasks', limit: 100 } },
      ctx({ records: new Map([['tasks', many]]) }),
    )!;
    expect(read.shown).toHaveLength(24);
    expect(read.rows).toHaveLength(30);
  });

  it('sections: count is the whole section, records are cut to limit; a link groups by entry', () => {
    const read = list({ limit: 1, group: { by: 'status' } });
    expect(read.groups!.map((g) => [g.key, g.label, g.count, ids(g.records), g.preset])).toEqual([
      ['todo', 'To do', 3, ['t5'], 'todo'],
      ['done', 'Done', 1, ['t2'], 'done'],
      ['none', 'Not set', 1, ['t4'], undefined],
    ]);
    expect(read.by).toBe('status');
    const byProject = list({ group: { by: 'project' } });
    expect(byProject.groups!.map((g) => [g.label, ids(g.records)])).toEqual([
      ['Home', ['t3', 't1']],
      ['Work', ['t2']],
      ['Not set', ['t5', 't4']],
    ]);
    // 不写 by：第一个日期字段。
    const months = list({ group: { unit: 'month' } });
    expect(months.by).toBe('due');
    // 段的先后跟着排序走（默认创建时间从新到旧：九月的在前）。
    expect(months.groups!.map((g) => [g.label, g.count])).toEqual([
      ['September 2026', 2],
      ['October 2026', 3],
    ]);
  });

  it('a board: one column per option, limit per column; a link board filters its columns', () => {
    const read = list({ limit: 1, group: { by: 'status' } }, 'board');
    expect(read.columns!.map((c) => [c.option, ids(c.records)])).toEqual([
      ['todo', ['t5']],
      ['done', ['t2']],
      [null, ['t4']],
    ]);
    expect(read.groups).toBeUndefined();
    const linked = readRecords(
      {
        look: 'board',
        source: {
          table: 'tasks',
          limit: 10,
          group: { by: 'project', filter: [{ field: 'name', op: 'is', value: 'Home' }] },
        },
      },
      ctx(),
    )!;
    expect(linked.columns!.map((c) => [c.option, c.label, ids(c.records)])).toEqual([
      ['p1', 'Home', ['t3', 't1']],
      [null, null, ['t5', 't4', 't2']],
    ]);
    expect(list({ group: { by: 'title' } }, 'board').columns).toBeUndefined();
  });

  it('a calendar: the days of a month, the picked day sorted and cut, what adding on a day fills in', () => {
    const source = {
      table: 'tasks',
      limit: 1,
      sort: { field: 'cost', direction: 'asc' as const },
      filter: [{ field: 'status', op: 'is' as const, value: 'todo' }],
      group: { unit: 'day' as const },
    };
    const c = ctx();
    const read = readRecords({ look: 'calendar', source, show: { color: 'status' } }, c)!;
    expect(read.days!.month).toBe('2026-10');
    expect(read.by).toBe('due');
    const day22 = dayNumber('2026-10-22')!;
    expect([...read.days!.days.keys()]).toEqual([dayNumber('2026-10-20'), day22]);
    expect(read.days!.days.get(day22)!.optionId).toBe('todo');
    expect(ids(dayShown(read, source, day22, c))).toEqual(['t3']);
    const september = readRecords({ look: 'calendar', source }, c, { month: '2026-09' })!;
    expect([...september.days!.days.values()].map((d) => ids(d.records))).toEqual([['t5']]);
    expect(dayValue(read, day22)).toBe('2026-10-22');
    expect(hereValues(read, dayValue(read, day22))).toEqual({ status: 'todo', due: '2026-10-22' });
    const plans = readRecords(
      { look: 'calendar', source: { ...source, group: { by: 'plan', unit: 'day' } } },
      c,
    )!;
    expect(dayValue(plans, day22)).toEqual({ repeat: 'once', date: '2026-10-22' });
  });

  it('"$here" is the equal-to conditions of the filter plus the value of the section', () => {
    const read = readRecords(
      {
        look: 'list',
        source: {
          table: 'tasks',
          limit: 10,
          filter: [{ field: 'project', op: 'is', value: '$record' }],
          group: { by: 'status' },
        },
      },
      ctx({ recordId: 'p1' }),
    )!;
    expect(hereValues(read)).toEqual({ project: 'p1' });
    expect(hereValues(read, read.groups![0]!.preset)).toEqual({ project: 'p1', status: 'todo' });
    expect(hereValues(read, null)).toEqual({ project: 'p1' });
  });
});

describe('number blocks', () => {
  const number = (source: Record<string, unknown>, more: Partial<SourceContext> = {}) =>
    readNumber({ table: 'tasks', aggregate: 'count', ...source } as never, ctx(more))!;

  it('count, sum, a goal does not change the value', () => {
    expect(number({}).value).toBe(5);
    expect(number({ aggregate: 'sum', field: 'cost', goal: 3 }).value).toBe(23);
    expect(number({ aggregate: 'avg', field: 'cost' }).value).toBe(5.75);
    expect(readNumber({ table: 'nope', aggregate: 'count' }, ctx())).toBeUndefined();
  });

  it('a streak with its best, by days.date', () => {
    // 10 月 20 日、22 日（今天）有：今天做到了，连续 1，最佳 1。
    expect(number({ aggregate: 'streak', days: { date: 'due' } })).toMatchObject({
      value: 1,
      best: 1,
    });
    expect(number({ aggregate: 'streak', days: { date: 'createdAt' } })).toMatchObject({
      value: 0,
      best: 1,
    });
    expect(number({ aggregate: 'daysSince' }).value).toBe(0);
  });

  it('compare: the same part of the previous period, also per group', () => {
    const read = number({
      aggregate: 'sum',
      field: 'cost',
      filter: [{ field: 'due', op: 'inPeriod', value: 'thisMonth' }],
      compare: 'previous',
      group: { by: 'status' },
    });
    expect(read.value).toBe(13);
    // 9 月 1–22 日：只有 t5（没有 cost）。
    expect(read.previous).toEqual({ period: 'thisMonth', value: 0 });
    expect(read.groups!.map((g) => [g.optionId, g.label, g.count, g.value, g.previous])).toEqual([
      ['todo', 'To do', 2, 6, 0],
      ['done', 'Done', 1, 7, 0],
    ]);
  });

  it('minus another total, which can be another table; "$record" works there too', () => {
    expect(
      number({ aggregate: 'sum', field: 'cost', minus: { table: 'projects', aggregate: 'count' } })
        .value,
    ).toBe(21);
    expect(
      number(
        {
          aggregate: 'sum',
          field: 'cost',
          minus: {
            table: 'tasks',
            aggregate: 'sum',
            field: 'cost',
            filter: [{ field: 'project', op: 'is', value: '$record' }],
          },
        },
        { recordId: 'p1' },
      ).value,
    ).toBe(17);
  });

  it('groups by a link field: one row per linked entry, "Not set" in the language', () => {
    const read = number({ group: { by: 'project' } }, { locale: 'fr' });
    expect(read.groups!.map((g) => [g.optionId, g.label, g.value])).toEqual([
      ['p1', 'Home', 2],
      ['p2', 'Work', 1],
      [null, 'Non renseigné', 2],
    ]);
  });
});

describe('charts', () => {
  it('by time (group.unit, by the first date field) and by a choice', () => {
    const c = ctx();
    const weeks = readChart(
      { table: 'tasks', aggregate: 'sum', field: 'cost', group: { unit: 'week', last: 2 } },
      c,
    )!;
    expect(weeks.points.map((p) => [p.key, p.value])).toEqual([
      ['2026-10-12', 0],
      ['2026-10-19', 13],
    ]);
    const choice = readChart({ table: 'tasks', aggregate: 'count', group: { by: 'status' } }, c)!;
    expect(choice.points.map((p) => [p.key, p.label, p.value])).toEqual([
      ['todo', 'To do', 3],
      ['done', 'Done', 1],
      [null, 'Not set', 1],
    ]);
    const days = readChart(
      {
        table: 'tasks',
        aggregate: 'distinctDays',
        days: { date: 'due' },
        group: { by: 'project' },
      },
      c,
    )!;
    expect(days.points.map((p) => [p.key, p.value])).toEqual([
      ['p1', 2],
      ['p2', 1],
      [null, 2],
    ]);
  });
});

describe('files lists ($files)', () => {
  const file = (name: string, mimeType: string, createdAt: number, size = 10): FileMeta => ({
    name,
    mimeType,
    createdAt,
    size,
    source: 'picked',
  });
  const files = [
    file('a.pdf', 'application/pdf', 1),
    file('b.jpg', 'image/jpeg', 2),
    file('c.mp4', 'video/mp4', 3, 5000),
    file('d.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 4),
    file('e.m4a', 'audio/mp4', 5),
  ];
  const names = (list: FileMeta[]) => list.map((f) => f.name);

  it('filters by the kind of file like the old mime type list did', () => {
    const kind = (op: 'is' | 'isNot', value: string) =>
      names(files.filter(filesFilter({ filter: [{ field: 'kind', op, value }] })));
    expect(kind('is', 'pdf')).toEqual(['a.pdf']);
    expect(kind('is', 'image')).toEqual(['b.jpg']);
    expect(kind('is', 'video')).toEqual(['c.mp4']);
    expect(kind('is', 'audio')).toEqual(['e.m4a']);
    expect(kind('isNot', 'image')).toEqual(['a.pdf', 'c.mp4', 'd.docx', 'e.m4a']);
    expect(kind('is', 'doc')).toEqual(['d.docx']);
    expect(names(files.filter(filesFilter({})))).toHaveLength(5);
  });

  it('other automatic fields, newest first by default, limit', () => {
    expect(
      names(files.filter(filesFilter({ filter: [{ field: 'size', op: 'gt', value: 100 }] }))),
    ).toEqual(['c.mp4']);
    const today = file('today.pdf', 'application/pdf', now.getTime() - 3600_000);
    expect(
      names(
        [...files, today].filter(
          filesFilter(
            { filter: [{ field: 'createdAt', op: 'inPeriod', value: 'today' }] },
            now,
            DEFAULT_CALENDAR,
          ),
        ),
      ),
    ).toEqual(['today.pdf']);
    expect(names(readFiles({ table: '$files', limit: 2 }, files))).toEqual(['e.m4a', 'd.docx']);
    expect(
      names(readFiles({ limit: 3, sort: { field: 'name', direction: 'asc' } }, files)),
    ).toEqual(['a.pdf', 'b.jpg', 'c.mp4']);
  });
});
