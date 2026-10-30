import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from './calendar';
import { prepareOps } from './change';
import { prepareRecordValues, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import { boardColumns, boardField, boardMoveAction, boardTargets } from './board-view';
import { rowUpdateInput } from './record-ops';
import type { Collection, NewComponent } from './schema';
import { registry } from './test-helpers';

// 阶段 C3（方案 P7）：记录列表的大圆块 tiles 和看板 board。

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
        { id: 'doing', label: 'Doing' },
        { id: 'done', label: 'Done' },
      ],
    },
    { id: 'note', name: 'Note', type: 'text' },
    { id: 'count', name: 'Count', type: 'number' },
    { id: 'goal', name: 'Goal', type: 'number' },
  ],
};

let seq = 0;
const rec = (values: Record<string, unknown>): DataRecord => ({
  id: `r${++seq}`,
  collectionId: 'tasks',
  values,
  createdAt: 0,
  updatedAt: 0,
});

describe('board columns (D-313)', () => {
  const field = boardField(tasks, 'status')!;

  it('has one column per option in option order, then "not set"', () => {
    const a = rec({ status: 'done' });
    const b = rec({ status: 'todo' });
    const c = rec({});
    // 选项删掉了的旧值也算「未分」。
    const d = rec({ status: 'gone' });
    const columns = boardColumns(field, [a, b, c, d], 30);
    expect(columns.map((col) => col.option)).toEqual(['todo', 'doing', 'done', null]);
    expect(columns.map((col) => col.records.map((r) => r.id))).toEqual([
      [b.id],
      [],
      [a.id],
      [c.id, d.id],
    ]);
    expect(columns[0]!.label).toBe('To do');
  });

  it('keeps the given order and at most limit cards per column', () => {
    const list = [1, 2, 3, 4].map(() => rec({ status: 'todo' }));
    const columns = boardColumns(field, [...list, rec({ status: 'done' })], 2);
    expect(columns[0]!.records).toEqual(list.slice(0, 2));
    expect(columns[2]!.records).toHaveLength(1);
  });

  it('hides an empty "not set" column for a required field and never offers it as a target', () => {
    const required = { ...field, required: true };
    const columns = boardColumns(required, [rec({ status: 'todo' })], 30);
    expect(columns.map((c) => c.option)).toEqual(['todo', 'doing', 'done']);
    const old = boardColumns(required, [rec({})], 30);
    expect(old.at(-1)!.option).toBeNull();
    expect(boardTargets(required, old, null).map((c) => c.option)).toEqual([
      'todo',
      'doing',
      'done',
    ]);
    expect(boardTargets(field, boardColumns(field, [], 30), 'doing').map((c) => c.option)).toEqual([
      'todo',
      'done',
      null,
    ]);
  });

  it('is not a board field unless it is a choice field', () => {
    expect(boardField(tasks, 'note')).toBeUndefined();
    expect(boardField(tasks, undefined)).toBeUndefined();
  });
});

describe('moving a card (D-314)', () => {
  const field = boardField(tasks, 'status')!;
  const ctx = { now: new Date(2026, 9, 30, 9), cal: DEFAULT_CALENDAR };

  it('is a set of the group field, written like any one-tap row action', () => {
    const stored = { title: 'Write report', status: 'todo', note: 'n' };
    const action = boardMoveAction(field, 'doing', 'Doing');
    expect(action).toEqual({ do: 'set', fieldId: 'status', value: 'doing', label: 'Doing' });
    const input = rowUpdateInput(action, tasks, stored, ctx);
    expect(input).toEqual({ status: 'doing' });
    const prepared = prepareRecordValues(tasks, input!, stored, ctx.now, ctx.cal);
    // 只改分栏字段，别的值原样保留。
    expect(prepared).toEqual({ ok: true, values: { ...stored, status: 'doing' } });
  });

  it('moving to "not set" clears the field', () => {
    const stored = { title: 'x', status: 'done' };
    const input = rowUpdateInput(boardMoveAction(field, null, 'Not set'), tasks, stored, ctx);
    // 清空和表单一样写成空值。
    expect(input).toEqual({ status: '' });
    const prepared = prepareRecordValues(tasks, input!, stored, ctx.now, ctx.cal);
    expect(prepared.ok && prepared.values.status).toBeUndefined();
  });
});

describe('tiles and board checks (D-311, D-313)', () => {
  const add = (component: NewComponent) =>
    prepareOps(
      createDefaultWorkspace('en'),
      [
        { op: 'addCollection', collection: tasks },
        { op: 'addComponent', pageId: 'home', component },
      ],
      { registry, locale: 'en', now: new Date(2026, 9, 30) },
    );
  const problems = (component: NewComponent) => {
    const result = add(component);
    return result.ok ? [] : result.issues;
  };
  const list = (props: Record<string, unknown>): NewComponent =>
    ({
      id: 'l',
      type: 'recordList',
      props: { collectionId: 'tasks', display: 'list', titleField: 'title', limit: 30, ...props },
    }) as NewComponent;

  it('accepts a habit grid and a task board', () => {
    expect(
      problems(
        list({
          display: 'tiles',
          limit: 24,
          trailingField: 'count',
          trailingFormat: { kind: 'progress', goal: 'goal' },
          rowActions: [{ label: 'Done', do: 'increment', fieldId: 'count', by: 1 }],
        }),
      ),
    ).toEqual([]);
    expect(problems(list({ display: 'tiles' }))).toEqual([]);
    expect(
      problems(list({ display: 'board', groupField: 'status', subtitleFields: ['note'] })),
    ).toEqual([]);
  });

  it('explains what is wrong', () => {
    const text = (c: NewComponent) => problems(c).join(' | ');
    expect(text(list({ display: 'board' }))).toMatch(/a board needs groupField/);
    expect(text(list({ display: 'board', groupField: 'note' }))).toMatch(
      /groupField note must be a choice or link field/,
    );
    expect(text(list({ display: 'board', groupField: 'nope' }))).toMatch(/nope/);
    for (const display of ['list', 'cards', 'tiles', 'calendar'])
      expect(text(list({ display, groupField: 'status' }))).toMatch(
        /groupField only applies to display "board"/,
      );
  });
});

// D-351：看板按引用字段分栏（每个项目自己的版块）。
describe('a board by a link field', () => {
  const sections: Collection = {
    id: 'sections',
    name: 'Sections',
    fields: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'project', name: 'Project', type: 'link', collectionId: 'projects' },
    ],
  };
  const projects: Collection = {
    id: 'projects',
    name: 'Projects',
    fields: [{ id: 'name', name: 'Name', type: 'text' }],
  };
  const items: Collection = {
    id: 'items',
    name: 'Items',
    fields: [
      { id: 'title', name: 'Title', type: 'text' },
      { id: 'section', name: 'Section', type: 'link', collectionId: 'sections' },
    ],
  };
  const section = (id: string, name: string, createdAt: number): DataRecord => ({
    id,
    collectionId: 'sections',
    values: { name, project: 'p1' },
    createdAt,
    updatedAt: createdAt,
  });
  const item = (id: string, sectionId?: string): DataRecord => ({
    id,
    collectionId: 'items',
    values: { title: id, ...(sectionId ? { section: sectionId } : {}) },
    createdAt: 0,
    updatedAt: 0,
  });

  it('one column per linked entry in the order they were made, then not set', () => {
    const field = boardField(items, 'section')!;
    const linked = {
      collection: sections,
      records: [section('s2', 'Doing', 2), section('s1', 'To do', 1)],
      locale: 'en' as const,
    };
    const columns = boardColumns(
      field,
      [item('a', 's1'), item('b', 's2'), item('c', 'gone')],
      30,
      linked,
    );
    expect(columns.map((c) => [c.option, c.label, c.records.map((r) => r.id)])).toEqual([
      ['s1', 'To do', ['a']],
      ['s2', 'Doing', ['b']],
      [null, null, ['c']],
    ]);
    // 拖到另一栏：引用字段设成那一栏的那条。
    expect(boardMoveAction(field, 's2', 'Doing')).toEqual({
      do: 'set',
      fieldId: 'section',
      value: 's2',
      label: 'Doing',
    });
    expect(
      rowUpdateInput(boardMoveAction(field, 's2', 'Doing'), items, {}, { now: new Date() }),
    ).toEqual({
      section: 's2',
    });
  });

  it('accepts a link board with a column filter on a page for one project; a filter needs a link board', () => {
    const run = (component: Record<string, unknown>, recordOf?: string) => {
      const r = prepareOps(
        createDefaultWorkspace('en'),
        [
          { op: 'addCollection', collection: projects },
          { op: 'addCollection', collection: sections },
          { op: 'addCollection', collection: items },
          {
            op: 'addPage',
            page: {
              id: 'pg',
              title: 'P',
              ...(recordOf ? { recordOf } : {}),
              components: [component],
            },
          },
        ],
        { registry, locale: 'en', now: new Date(2026, 9, 30) },
      );
      return r.ok ? [] : r.issues.map(String);
    };
    const board = (props: Record<string, unknown>) => ({
      id: 'b',
      type: 'recordList',
      props: { collectionId: 'items', display: 'board', titleField: 'title', limit: 30, ...props },
    });
    expect(
      run(
        board({
          groupField: 'section',
          groupFilter: [{ field: 'project', op: 'is', value: '$record' }],
          addHere: true,
        }),
        'projects',
      ),
    ).toEqual([]);
    expect(
      run(board({ groupField: 'section', groupFilter: [{ field: 'nope', op: 'isEmpty' }] })).join(),
    ).toMatch(/groupFilter: filter field nope is not a field of sections/);
    expect(
      run({
        id: 'l',
        type: 'recordList',
        props: {
          collectionId: 'items',
          display: 'list',
          titleField: 'title',
          limit: 30,
          groupFilter: [{ field: 'name', op: 'isEmpty' }],
        },
      }).join(),
    ).toMatch(/groupFilter only applies to a board whose groupField is a link field/);
  });
});
