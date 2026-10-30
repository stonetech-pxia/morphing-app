import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from './calendar';
import { prepareOps } from './change';
import { prepareRecordValues, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import {
  boardColumns,
  boardDragTool,
  boardField,
  boardMoveAction,
  boardTargets,
  type BoardDragTool,
} from './board-view';
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

  const drag: BoardDragTool = {
    as: 'drag',
    do: 'set',
    table: 'tasks',
    field: field.id,
    value: '$group',
  };

  it('is the drag tool of the block with "$group" set to the column, run like any one-tap tool', () => {
    expect(boardDragTool([{ as: 'button', do: 'toggle', table: 'tasks', field: 'x' }, drag])).toBe(
      drag,
    );
    expect(boardDragTool([{ as: 'button', do: 'toggle', table: 'tasks', field: 'x' }])).toBe(
      undefined,
    );
    const stored = { title: 'Write report', status: 'todo', note: 'n' };
    const action = boardMoveAction(drag, 'doing', 'Doing');
    expect(action).toEqual({
      as: 'drag',
      do: 'set',
      table: 'tasks',
      field: 'status',
      value: 'doing',
      label: 'Doing',
    });
    const input = rowUpdateInput(action, tasks, stored, ctx);
    expect(input).toEqual({ status: 'doing' });
    const prepared = prepareRecordValues(tasks, input!, stored, ctx.now, ctx.cal);
    // 只改分栏字段，别的值原样保留。
    expect(prepared).toEqual({ ok: true, values: { ...stored, status: 'doing' } });
  });

  it('moving to "not set" clears the field', () => {
    const stored = { title: 'x', status: 'done' };
    const input = rowUpdateInput(boardMoveAction(drag, null, 'Not set'), tasks, stored, ctx);
    // 清空和表单一样写成空值。
    expect(input).toEqual({ status: '' });
    const prepared = prepareRecordValues(tasks, input!, stored, ctx.now, ctx.cal);
    expect(prepared.ok && prepared.values.status).toBeUndefined();
  });
});

describe('tiles and board checks (D-311, D-313)', () => {
  const add = (block: NewComponent) =>
    prepareOps(
      createDefaultWorkspace('en'),
      [
        { op: 'addData', table: tasks },
        { op: 'addContainer', page: 'home', block },
      ],
      { registry, locale: 'en', now: new Date(2026, 9, 30) },
    );
  const problems = (block: NewComponent) => {
    const result = add(block);
    return result.ok ? [] : result.issues;
  };
  const block = (
    look: string,
    group?: Record<string, unknown>,
    more: Record<string, unknown> = {},
  ): NewComponent =>
    ({
      id: 'l',
      look,
      source: { table: 'tasks', limit: 30, ...(group ? { group } : {}) },
      show: { title: 'title' },
      ...more,
    }) as NewComponent;

  it('accepts a habit grid and a task board', () => {
    expect(
      problems(
        block('tiles', undefined, {
          source: { table: 'tasks', limit: 24 },
          show: { title: 'title', trailing: 'count', format: { kind: 'progress', goal: 'goal' } },
          tools: [
            { as: 'tap', label: 'Done', do: 'increment', table: 'tasks', field: 'count', by: 1 },
          ],
        }),
      ),
    ).toEqual([]);
    expect(problems(block('tiles'))).toEqual([]);
    expect(
      problems(block('board', { by: 'status' }, { show: { title: 'title', subtitles: ['note'] } })),
    ).toEqual([]);
  });

  it('explains what is wrong', () => {
    const text = (c: NewComponent) => problems(c).join(' | ');
    expect(text(block('board'))).toMatch(/a board needs source.group.by set to a choice or link/);
    expect(text(block('board', { by: 'note' }))).toMatch(
      /a board needs source.group.by set to a choice or link field/,
    );
    expect(text(block('board', { by: 'nope' }))).toMatch(/nope/);
    expect(text(block('tiles', { by: 'status' }))).toMatch(/tiles are not grouped/);
    expect(text(block('calendar', { by: 'status', unit: 'day' }))).toMatch(
      /source.group.by status must be a date or datetime or schedule field/,
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
      { id: 'project', name: 'Project', type: 'link', table: 'projects' },
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
      { id: 'section', name: 'Section', type: 'link', table: 'sections' },
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
    const drag: BoardDragTool = {
      as: 'drag',
      do: 'set',
      table: 'items',
      field: field.id,
      value: '$group',
    };
    expect(boardMoveAction(drag, 's2', 'Doing')).toMatchObject({ field: 'section', value: 's2' });
    expect(
      rowUpdateInput(boardMoveAction(drag, 's2', 'Doing'), items, {}, { now: new Date() }),
    ).toEqual({ section: 's2' });
  });

  it('accepts a link board with a column filter on a page for one project; a filter needs a link board', () => {
    const run = (block: Record<string, unknown>, of?: string) => {
      const r = prepareOps(
        createDefaultWorkspace('en'),
        [
          { op: 'addData', table: projects },
          { op: 'addData', table: sections },
          { op: 'addData', table: items },
          {
            op: 'addContainer',
            page: { id: 'pg', title: 'P', ...(of ? { of } : {}), blocks: [block as NewComponent] },
          },
        ],
        { registry, locale: 'en', now: new Date(2026, 9, 30) },
      );
      return r.ok ? [] : r.issues.map(String);
    };
    const board = (group: Record<string, unknown>, tools?: unknown[]) => ({
      id: 'b',
      look: 'board',
      source: { table: 'items', limit: 30, group },
      show: { title: 'title' },
      ...(tools ? { tools } : {}),
    });
    expect(
      run(
        board({ by: 'section', filter: [{ field: 'project', op: 'is', value: '$record' }] }, [
          { as: 'drag', do: 'set', table: 'items', field: 'section', value: '$group' },
          { as: 'addHere', do: 'create', table: 'items', ask: 'all', values: '$here' },
        ]),
        'projects',
      ),
    ).toEqual([]);
    expect(
      run(board({ by: 'section', filter: [{ field: 'nope', op: 'isEmpty' }] })).join(),
    ).toMatch(/nope is not a field of sections/);
    expect(
      run({
        id: 'l',
        look: 'list',
        source: {
          table: 'items',
          limit: 30,
          group: { by: 'section', filter: [{ field: 'name', op: 'isEmpty' }] },
        },
        show: { title: 'title' },
      }).join(),
    ).toMatch(/source.group.filter only applies to a board/);
  });
});
