import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { filterRecords, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import { createInput } from './record-ops';
import { bindRecord } from './record-pages';
import type { Collection, Component, WorkspaceConfig } from './schema';
import { registry } from './test-helpers';

// 给一条记录用的页面（D-332）：项目页列出这个项目的任务，任务页列出它的子任务。

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
    { id: 'project', name: 'Project', type: 'link', collectionId: 'projects' },
    { id: 'parent', name: 'Parent', type: 'link', collectionId: 'tasks' },
  ],
};

const list = (id: string, collectionId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'recordList',
  props: {
    collectionId,
    display: 'list',
    titleField: collectionId === 'tasks' ? 'title' : 'name',
    limit: 30,
    ...extra,
  },
});

const projectPage = (components: unknown[], recordOf = 'projects') => ({
  op: 'addPage',
  page: { id: 'project', title: 'Project', recordOf, components },
});

const now = new Date(2026, 9, 30, 9);
function run(ops: unknown[]) {
  const base = [
    { op: 'addCollection', collection: projects },
    { op: 'addCollection', collection: tasks },
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
        {
          op: 'addComponent',
          pageId: 'home',
          component: list('all', 'projects', { opens: 'project' }),
        },
      ]),
    ).toEqual([]);
  });

  it('a task page can list its subtasks (a link to its own table)', () => {
    expect(
      problems([
        {
          op: 'addPage',
          page: {
            id: 'task',
            title: 'Task',
            recordOf: 'tasks',
            components: [
              list('subs', 'tasks', { filter: [{ field: 'parent', op: 'is', value: '$record' }] }),
            ],
          },
        },
      ]),
    ).toEqual([]);
  });

  it('$record needs a page for that table and a link field pointing at it', () => {
    const filter = (field: string, recordOf = 'projects') =>
      problems([
        projectPage(
          [list('l', 'tasks', { filter: [{ field, op: 'is', value: '$record' }] })],
          recordOf,
        ),
      ]).join();
    // 父任务指向任务表，不是项目。
    expect(filter('parent')).toMatch(
      /only works with is \/ isNot on a link field that points at projects/,
    );
    expect(filter('title')).toMatch(/points at projects/);
    expect(
      problems([
        {
          op: 'addComponent',
          pageId: 'home',
          component: list('l', 'tasks', {
            filter: [{ field: 'project', op: 'is', value: '$record' }],
          }),
        },
      ]).join(),
    ).toMatch(/only works on a page for one entry of a table/);
  });

  it('new entries made on the page can point at the entry', () => {
    const button = (values: Record<string, unknown>) => ({
      id: 'add',
      type: 'button',
      props: {
        label: 'Add task',
        variant: 'filled',
        action: { do: 'create', collectionId: 'tasks', values, form: true },
      },
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
        { op: 'setNavItems', items: ['page:home', 'page:project', 'ai', 'settings'] },
      ]).join(),
    ).toMatch(/shows one entry of projects; it can only be opened from a list of projects/);
    expect(
      problems([
        projectPage([]),
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'b',
            type: 'button',
            props: { label: 'Go', variant: 'filled', target: 'page:project' },
          },
        },
      ]).join(),
    ).toMatch(/recordList.opens/);
  });

  it('a list can only open a page for its own table', () => {
    expect(
      problems([
        projectPage([]),
        { op: 'addComponent', pageId: 'home', component: list('l', 'tasks', { opens: 'project' }) },
      ]).join(),
    ).toMatch(/opens project must be a page for one entry of tasks/);
    expect(
      problems([
        { op: 'addComponent', pageId: 'home', component: list('l', 'tasks', { opens: 'nope' }) },
      ]).join(),
    ).toMatch(/opens nope is not a page/);
  });

  it('removing the page lets the list open the editor again; the table needs its pages gone first', () => {
    const made = run([
      projectPage([]),
      {
        op: 'addComponent',
        pageId: 'home',
        component: list('all', 'projects', { opens: 'project' }),
      },
    ]);
    expect(made.ok).toBe(true);
    const config = (made as { after: WorkspaceConfig }).after;
    const removed = prepareOps(config, [{ op: 'removePage', pageId: 'project' }], {
      registry,
      locale: 'en',
      now,
    });
    expect(removed.ok).toBe(true);
    const home = (removed as { after: WorkspaceConfig }).after.pages.find((p) => p.id === 'home')!;
    const all = home.components.find((c) => c.id === 'all') as Extract<
      Component,
      { type: 'recordList' }
    >;
    expect(all.props.opens).toBeUndefined();
    const gone = prepareOps(
      config,
      [
        { op: 'removeComponent', pageId: 'home', componentId: 'all' },
        { op: 'removeField', collectionId: 'tasks', fieldId: 'project' },
        { op: 'removeCollection', collectionId: 'projects' },
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
    const c = list('l', 'tasks', {
      emptyText: 'No tasks',
      filter: [{ field: 'project', op: 'is', value: '$record' }],
      rowActions: [
        {
          label: 'Sub',
          do: 'create',
          collectionId: 'tasks',
          values: { parent: 'row', project: '$record' },
          form: true,
        },
      ],
    }) as unknown as Extract<Component, { type: 'recordList' }>;
    const bound = bindRecord(c, 'p1');
    expect(bound.props.filter).toEqual([{ field: 'project', op: 'is', value: 'p1' }]);
    expect(bound.props.emptyText).toBe('No tasks');
    expect(c.props.filter![0]!.value).toBe('$record');
    const titles = filterRecords(all, tasks, bound.props.filter, now).map((r) => r.values.title);
    expect(titles).toEqual(['Write', 'Draft']);
    const action = bound.props.rowActions![0]! as unknown as { values: Record<string, never> };
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
