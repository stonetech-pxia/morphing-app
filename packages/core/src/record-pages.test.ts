import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { filterRecords, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import { createInput } from './record-ops';
import { bindRecord } from './record-pages';
import type { BlockOf, Collection, WorkspaceConfig } from './schema';
import { registry } from './test-helpers';

// 给一条记录用的页面（D-342）：项目页列出这个项目的任务，任务页列出它的子任务。

const projects: Collection = {
  id: 'projects',
  name: 'Projects',
  fields: [{ id: 'name', name: 'Name', type: 'text', required: true }],
};
const tasks: Collection = {
  id: 'tasks',
  name: 'Tasks',
  fields: [
    { id: 'title', name: 'Title', type: 'text', required: true },
    { id: 'project', name: 'Project', type: 'link', table: 'projects' },
    { id: 'parent', name: 'Parent', type: 'link', table: 'tasks' },
  ],
};

const list = (
  id: string,
  table: string,
  { filter, ...extra }: { filter?: unknown[]; [key: string]: unknown } = {},
) => ({
  id,
  look: 'list',
  source: { table, limit: 30, ...(filter ? { filter } : {}) },
  show: { title: table === 'tasks' ? 'title' : 'name' },
  ...extra,
});

const projectPage = (blocks: unknown[], of = 'projects') => ({
  op: 'addContainer',
  page: { id: 'project', title: 'Project', of, blocks },
});
const addHome = (block: unknown) => ({ op: 'addContainer', page: 'home', block });

const now = new Date(2026, 9, 30, 9);
function run(ops: unknown[]) {
  const base = [
    { op: 'addData', table: projects },
    { op: 'addData', table: tasks },
  ];
  return prepareOps(createDefaultWorkspace('en'), [...base, ...ops], {
    registry,
    locale: 'en',
    now,
  });
}
const problems = (ops: unknown[]) => {
  const r = run(ops);
  return r.ok ? [] : r.issues.map(String);
};

describe('a page for one entry', () => {
  it('lists the tasks of this project and opens from the project list', () => {
    expect(
      problems([
        projectPage([
          list('its-tasks', 'tasks', {
            filter: [{ field: 'project', op: 'is', value: '$record' }],
          }),
        ]),
        addHome(list('all', 'projects', { opens: 'project' })),
      ]),
    ).toEqual([]);
  });

  it('a task page can list its subtasks (a link to its own table)', () => {
    expect(
      problems([
        {
          op: 'addContainer',
          page: {
            id: 'task',
            title: 'Task',
            of: 'tasks',
            blocks: [
              list('subs', 'tasks', { filter: [{ field: 'parent', op: 'is', value: '$record' }] }),
            ],
          },
        },
      ]),
    ).toEqual([]);
  });

  it('$record needs a page for that table and a link field pointing at it', () => {
    const filter = (field: string, of = 'projects') =>
      problems([
        projectPage([list('l', 'tasks', { filter: [{ field, op: 'is', value: '$record' }] })], of),
      ]).join();
    // 父任务指向任务表，不是项目。
    expect(filter('parent')).toMatch(
      /only works with is \/ isNot on a link field that points at projects/,
    );
    expect(filter('title')).toMatch(/points at projects/);
    expect(
      problems([
        addHome(list('l', 'tasks', { filter: [{ field: 'project', op: 'is', value: '$record' }] })),
      ]).join(),
    ).toMatch(/only works on a page for one entry of a table/);
  });

  it('new entries made on the page can point at the entry', () => {
    const button = (values: Record<string, unknown>) => ({
      id: 'add',
      look: 'button',
      show: { label: 'Add task', variant: 'filled' },
      tools: [{ do: 'create', table: 'tasks', values, ask: 'all' }],
    });
    expect(problems([projectPage([button({ project: '$record' })])])).toEqual([]);
    expect(problems([projectPage([button({ parent: '$record' })])]).join()).toMatch(
      /can be "\$record" only when creating and only if it points at projects/,
    );
  });

  it('cannot be opened from the nav bar, a button or a reminder', () => {
    expect(
      problems([
        projectPage([]),
        { op: 'updateContainer', nav: { bar: ['page:home', 'page:project', 'ai', 'settings'] } },
      ]).join(),
    ).toMatch(/shows one entry of projects; it can only be opened from a list of projects/);
    expect(
      problems([
        projectPage([]),
        addHome({
          id: 'b',
          look: 'button',
          show: { label: 'Go', variant: 'filled' },
          opens: 'page:project',
        }),
      ]).join(),
    ).toMatch(/shows one entry of projects; it can only be opened from a list of projects/);
  });

  it('a list can only open a page for its own table', () => {
    expect(
      problems([projectPage([]), addHome(list('l', 'tasks', { opens: 'project' }))]).join(),
    ).toMatch(/opens project must be a page for one entry of tasks/);
    expect(problems([addHome(list('l', 'tasks', { opens: 'nope' }))]).join()).toMatch(
      /opens nope is not a page/,
    );
  });

  it('removing the page lets the list open the editor again; the table needs its pages gone first', () => {
    const made = run([projectPage([]), addHome(list('all', 'projects', { opens: 'project' }))]);
    expect(made.ok).toBe(true);
    const config = (made as { after: WorkspaceConfig }).after;
    const removed = prepareOps(config, [{ op: 'removeContainer', page: 'project' }], {
      registry,
      locale: 'en',
      now,
    });
    expect(removed.ok).toBe(true);
    const home = (removed as { after: WorkspaceConfig }).after.containers.pages.find(
      (p) => p.id === 'home',
    )!;
    const all = home.blocks.find((c) => c.id === 'all') as BlockOf<'list'>;
    expect(all.opens).toBeUndefined();
    const gone = prepareOps(
      config,
      [
        { op: 'removeContainer', page: 'home', block: 'all' },
        { op: 'removeData', table: 'tasks', field: 'project' },
        { op: 'removeData', table: 'projects' },
      ],
      { registry, locale: 'en', now },
    );
    expect(gone.ok ? [] : gone.issues.map(String)).toEqual([
      expect.stringMatching(/pages project show one entry of projects; remove them first/),
    ]);
  });
});

describe('binding the entry when the page opens', () => {
  const record = (id: string, values: Record<string, unknown>): DataRecord => ({
    id,
    collectionId: 'tasks',
    values,
    createdAt: 0,
    updatedAt: 0,
  });
  const all = [
    record('t1', { title: 'Write', project: 'p1' }),
    record('t2', { title: 'Call', project: 'p2' }),
    record('t3', { title: 'Draft', project: 'p1', parent: 't1' }),
  ];

  it('replaces $record in filters and presets, nothing else', () => {
    const c = {
      ...list('l', 'tasks', { filter: [{ field: 'project', op: 'is', value: '$record' }] }),
      show: { title: 'title', emptyText: 'No tasks' },
      tools: [
        {
          as: 'button',
          label: 'Sub',
          do: 'create',
          table: 'tasks',
          values: { parent: '$row', project: '$record' },
          ask: 'all',
          when: [{ field: 'project', op: 'is', value: '$record' }],
        },
      ],
    } as unknown as BlockOf<'list'>;
    const bound = bindRecord(c, 'p1');
    expect(bound.source.filter).toEqual([{ field: 'project', op: 'is', value: 'p1' }]);
    expect(bound.show.emptyText).toBe('No tasks');
    expect(c.source.filter![0]!.value).toBe('$record');
    const titles = filterRecords(all, tasks, bound.source.filter, now).map((r) => r.values.title);
    expect(titles).toEqual(['Write', 'Draft']);
    const action = bound.tools![0]! as unknown as {
      values: Record<string, never>;
      when: unknown;
    };
    expect(action.when).toEqual([{ field: 'project', op: 'is', value: 'p1' }]);
    expect(createInput(tasks, action.values, { now, rowId: 't1' })).toEqual({
      parent: 't1',
      project: 'p1',
    });
  });

  it('isNot $record lists the rest', () => {
    const titles = filterRecords(
      all,
      tasks,
      [{ field: 'project', op: 'isNot', value: 'p1' }],
      now,
    ).map((r) => r.values.title);
    expect(titles).toEqual(['Call']);
  });
});

// D-352：底部弹出的添加框（浮动的「+」）一页一个，不能放进分组。
describe('a floating add', () => {
  const sheet = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    look: 'form',
    show: { mode: 'sheet' },
    tools: [
      { as: 'submit', label: 'Add task', do: 'create', table: 'tasks', ask: ['title'], ...extra },
    ],
  });
  const add = addHome;

  it('is fine once per page, with a smart date', () => {
    expect(
      problems([add(sheet('quick', { smartDate: { from: 'title', to: 'title' } }))]).join(),
    ).toMatch(/smartDate.to title must be a date, datetime or schedule field/);
    expect(problems([add(sheet('quick'))])).toEqual([]);
  });

  it('a second one on the same page or one in a group is refused', () => {
    expect(problems([add(sheet('one')), add(sheet('two'))]).join()).toMatch(
      /already has a floating add button \(one\); one per page/,
    );
    expect(
      problems([
        add({
          id: 'g',
          look: 'group',
          show: { layout: 'stack' },
          children: [sheet('inside')],
        }),
      ]).join(),
    ).toMatch(/not in a group/);
  });
});
