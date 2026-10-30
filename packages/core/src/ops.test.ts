import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { applyOps, OpSchema, type Op, type OpOf } from './ops';
import type {
  Collection,
  Component,
  KnownComponent,
  NewComponent,
  QuickAction,
  Reminder,
  WorkspaceConfig,
} from './schema';
import { allComponents, quickActionsOf, remindersOf } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22, 9, 5) };
const tryOps = (config: WorkspaceConfig, ops: Op[]) => applyOps(config, ops, ctx);
const errorOf = (config: WorkspaceConfig, ops: Op[]) => {
  const r = tryOps(config, ops);
  return r.ok ? null : r.error;
};
const page = (c: WorkspaceConfig, id: string) => c.containers.pages.find((p) => p.id === id)!;
const block = (c: WorkspaceConfig, pageId: string, id: string) =>
  allComponents(page(c, pageId)).find((x) => x.id === id) as KnownComponent | undefined;
const ids = (list: readonly Component[]) => list.map((c) => c.id);
const issuesOf = (config: WorkspaceConfig) => {
  const r = validateWorkspace(config, registry);
  return r.ok ? [] : r.issues.map((i) => i.message);
};

// ---- 测试用的一份配置：任务、项目两张表，一个任务页 ----

const projects: Collection = {
  id: 'projects',
  name: '项目',
  fields: [{ id: 'name', name: '名称', type: 'text', required: true }],
};
const tasks: Collection = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'title', name: '标题', type: 'text', required: true },
    { id: 'done', name: '完成', type: 'checkbox' },
    {
      id: 'status',
      name: '状态',
      type: 'choice',
      options: [
        { id: 'todo', label: '待办' },
        { id: 'doing', label: '进行中' },
      ],
    },
    { id: 'due', name: '截止', type: 'date' },
    { id: 'project', name: '项目', type: 'link', table: 'projects' },
    { id: 'points', name: '点数', type: 'number' },
  ],
};

const tasksPage: Extract<OpOf<'addContainer'>['page'], object> = {
  id: 'tasks-page',
  title: '任务',
  blocks: [
    { id: 'title', look: 'header', show: { title: '任务' } },
    {
      id: 'add',
      look: 'form',
      show: { mode: 'inline' },
      tools: [{ as: 'submit', label: '添加', do: 'create', table: 'tasks', ask: ['title', 'due'] }],
    },
    {
      id: 'checks',
      look: 'checklist',
      source: { table: 'tasks', limit: 20 },
      show: { title: 'title' },
      tools: [
        { as: 'check', do: 'toggle', table: 'tasks', field: 'done' },
        {
          as: 'button',
          label: '开始',
          when: [{ field: 'status', op: 'is', value: 'todo' }],
          do: 'set',
          table: 'tasks',
          field: 'status',
          value: 'doing',
        },
      ],
    },
    {
      id: 'board',
      look: 'board',
      source: { table: 'tasks', limit: 50, group: { by: 'status' } },
      show: { title: 'title' },
      tools: [{ as: 'drag', do: 'set', table: 'tasks', field: 'status', value: '$group' }],
    },
    {
      id: 'row',
      look: 'group',
      show: { layout: 'row' },
      children: [
        {
          id: 'count',
          look: 'number',
          show: { label: '点数' },
          source: { table: 'tasks', aggregate: 'sum', field: 'points' },
        },
        {
          id: 'reset',
          look: 'button',
          show: { label: '全部重来', variant: 'outline' },
          tools: [{ do: 'setAll', table: 'tasks', field: 'done', value: false }],
        },
      ],
    },
    {
      id: 'by-project',
      look: 'list',
      source: { table: 'projects', limit: 20 },
      show: { title: 'name' },
      tools: [
        {
          as: 'button',
          label: '加任务',
          do: 'create',
          table: 'tasks',
          values: { project: '$row' },
          ask: 'all',
        },
      ],
    },
  ],
};

function tasksConfig(): WorkspaceConfig {
  return apply(workspace('zh', { withPdf: true }), [
    { op: 'addData', table: projects },
    { op: 'addData', table: tasks },
    { op: 'addContainer', page: tasksPage },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'new-project',
        look: 'button',
        show: { label: '新项目', variant: 'text' },
        tools: [{ do: 'create', table: 'projects', ask: 'all' }],
      },
    },
    { op: 'updateContainer', nav: { floating: ['page:tasks-page'] } },
  ]);
}

describe('applyOps', () => {
  it('does not mutate its input', () => {
    const before = tasksConfig();
    const snapshot = JSON.stringify(before);
    apply(before, [
      { op: 'setTheme', primaryColor: '#2F9E44' },
      { op: 'removeData', table: 'tasks', field: 'done' },
      { op: 'moveContainer', page: 'tasks-page', block: 'count', toIndex: 0 },
    ]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('runs the ops in order; one failing op fails the whole change', () => {
    const result = tryOps(workspace(), [
      { op: 'setTheme', primaryColor: '#2F9E44' },
      { op: 'removeContainer', page: 'home', block: 'nope' },
    ]);
    expect(result).toEqual({ ok: false, error: 'block nope not found on page home' });
  });

  it('the test fixture is a valid workspace', () => {
    expect(issuesOf(tasksConfig())).toEqual([]);
  });
});

// ---- 数据 ----

describe('addData', () => {
  it('adds a table, then a field at an index', () => {
    const config = apply(workspace(), [
      { op: 'addData', table: projects },
      {
        op: 'addData',
        table: 'projects',
        field: { id: 'note', name: '备注', type: 'text' },
        index: 0,
      },
    ]);
    expect(config.data.tables.map((t) => t.id)).toEqual(['projects']);
    expect(config.data.tables[0]!.fields.map((f) => f.id)).toEqual(['note', 'name']);
  });

  it('refuses a duplicate table or field and a missing table', () => {
    const config = tasksConfig();
    expect(errorOf(config, [{ op: 'addData', table: projects }])).toBe(
      'table projects already exists',
    );
    expect(
      errorOf(config, [
        { op: 'addData', table: 'tasks', field: { id: 'done', name: 'x', type: 'checkbox' } },
      ]),
    ).toBe('field done already exists in tasks');
    expect(
      errorOf(config, [
        { op: 'addData', table: 'nope', field: { id: 'x', name: 'x', type: 'checkbox' } },
      ]),
    ).toBe('table nope not found');
  });

  it('the shape: a new table or a table id with a field, not both', () => {
    const parse = (o: unknown) => OpSchema.safeParse(o).success;
    expect(parse({ op: 'addData', table: projects })).toBe(true);
    expect(parse({ op: 'addData', table: 'projects' })).toBe(false);
    expect(
      parse({ op: 'addData', table: projects, field: { id: 'x', name: 'x', type: 'text' } }),
    ).toBe(false);
  });
});

describe('updateData', () => {
  it('renames a table, changes and resets an icon', () => {
    const renamed = apply(tasksConfig(), [
      { op: 'updateData', table: 'tasks', changes: { name: '待办', icon: 'check' } },
    ]);
    expect(renamed.data.tables[1]).toMatchObject({ name: '待办', icon: 'check' });
    const reset = apply(renamed, [{ op: 'updateData', table: 'tasks', changes: { icon: null } }]);
    expect(reset.data.tables[1]).not.toHaveProperty('icon');
  });

  it('a table changes only its name and icon; fields go through field ops', () => {
    expect(
      errorOf(tasksConfig(), [{ op: 'updateData', table: 'tasks', changes: { fields: [] } }]),
    ).toBe('table tasks can change name, icon; not fields');
  });

  it('merges field changes, null removes a key, the id never changes', () => {
    const config = apply(tasksConfig(), [
      {
        op: 'updateData',
        table: 'tasks',
        field: 'points',
        changes: { name: '分数', unit: '分' },
      },
    ]);
    expect(config.data.tables[1]!.fields[5]).toEqual({
      id: 'points',
      name: '分数',
      type: 'number',
      unit: '分',
    });
    const cleared = apply(config, [
      { op: 'updateData', table: 'tasks', field: 'points', changes: { unit: null } },
    ]);
    expect(cleared.data.tables[1]!.fields[5]).not.toHaveProperty('unit');
    expect(
      errorOf(config, [
        { op: 'updateData', table: 'tasks', field: 'points', changes: { id: 'p' } },
      ]),
    ).toBe('a field id cannot change');
    expect(
      errorOf(config, [{ op: 'updateData', table: 'tasks', field: 'nope', changes: {} }]),
    ).toBe('field nope not found in tasks');
  });

  it('changes a field type only between compatible types, keeping the common keys', () => {
    const note = apply(tasksConfig(), [
      { op: 'updateData', table: 'tasks', field: 'title', changes: { type: 'note' } },
    ]);
    expect(note.data.tables[1]!.fields[0]).toEqual({
      id: 'title',
      name: '标题',
      type: 'note',
      required: true,
    });
    expect(
      errorOf(tasksConfig(), [
        { op: 'updateData', table: 'tasks', field: 'title', changes: { type: 'date' } },
      ]),
    ).toBe('field title cannot change from text to date; add a new field instead');
  });

  it('sets the calendar: merges, null resets, nothing left removes it', () => {
    const set = apply(workspace(), [
      { op: 'updateData', calendar: { dayStartHour: 4, weekStart: 'sunday' } },
    ]);
    expect(set.data.calendar).toEqual({ dayStartHour: 4, weekStart: 'sunday' });
    const one = apply(set, [{ op: 'updateData', calendar: { weekStart: null } }]);
    expect(one.data.calendar).toEqual({ dayStartHour: 4 });
    const none = apply(one, [{ op: 'updateData', calendar: { dayStartHour: null } }]);
    expect(none.data).not.toHaveProperty('calendar');
  });

  it('the shape: {table, field?, changes} or {calendar}, never both', () => {
    const parse = (o: unknown) => OpSchema.safeParse(o).success;
    expect(parse({ op: 'updateData', table: 'tasks' })).toBe(false);
    expect(parse({ op: 'updateData', calendar: { dayStartHour: 4 }, table: 'tasks' })).toBe(false);
    expect(parse({ op: 'updateData', field: 'x', changes: {} })).toBe(false);
  });
});

describe('removeData', () => {
  it('a field: tools that use it go, a checklist becomes a list, a board becomes read-only', () => {
    const result = tryOps(tasksConfig(), [{ op: 'removeData', table: 'tasks', field: 'done' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.config;
    expect(c.data.tables[1]!.fields.map((f) => f.id)).not.toContain('done');
    // 勾的工具没了：清单退成列表，另一个按钮留着。
    expect(block(c, 'tasks-page', 'checks')).toMatchObject({
      look: 'list',
      tools: [{ as: 'button', do: 'set', field: 'status' }],
    });
    // 「全部重来」写的就是这个字段：按钮跟着移除。
    expect(block(c, 'tasks-page', 'reset')).toBeUndefined();
    expect(result.notes).toEqual([{ kind: 'removedRecordActions', count: 2 }]);
    expect(issuesOf(c)).toEqual([]);
  });

  it('a field used in a when condition, a drag and a set: those tools go; the board keeps its view', () => {
    const result = tryOps(tasksConfig(), [{ op: 'removeData', table: 'tasks', field: 'status' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(block(result.config, 'tasks-page', 'checks')!).toMatchObject({
      look: 'checklist',
      tools: [{ as: 'check', field: 'done' }],
    });
    // 拖动没了，看板只能看（它的分栏字段也没了，校验器会让 AI 一起改）。
    expect(block(result.config, 'tasks-page', 'board')).not.toHaveProperty('tools');
    expect(result.notes).toEqual([{ kind: 'removedRecordActions', count: 2 }]);
  });

  it('a field preset by a create on another list: that row tool goes', () => {
    const result = tryOps(tasksConfig(), [{ op: 'removeData', table: 'tasks', field: 'project' }]);
    expect(result.ok && block(result.config, 'tasks-page', 'by-project')).not.toHaveProperty(
      'tools',
    );
  });

  it('a field asked by a form: the form stays and the checker names it', () => {
    const result = tryOps(tasksConfig(), [{ op: 'removeData', table: 'tasks', field: 'due' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(block(result.config, 'tasks-page', 'add')).toMatchObject({ look: 'form' });
    expect(result.notes).toEqual([]);
    expect(issuesOf(result.config).join('\n')).toContain('due');
  });

  it('a table: its blocks go, also a number that subtracts it and tools that write it', () => {
    const config = apply(tasksConfig(), [
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'left',
          look: 'number',
          show: { label: '剩下' },
          source: {
            table: 'projects',
            aggregate: 'count',
            minus: { table: 'tasks', aggregate: 'count' },
          },
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'new-task',
          look: 'button',
          show: { label: '新任务', variant: 'filled' },
          tools: [{ do: 'create', table: 'tasks', ask: 'all' }],
        },
      },
    ]);
    const result = tryOps(config, [{ op: 'removeData', table: 'tasks' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.config;
    expect(c.data.tables.map((t) => t.id)).toEqual(['projects']);
    expect(ids(allComponents(page(c, 'tasks-page')))).toEqual(['title', 'row', 'by-project']);
    expect(block(c, 'home', 'left')).toBeUndefined();
    expect(block(c, 'home', 'new-task')).toBeUndefined();
    expect(block(c, 'tasks-page', 'by-project')).not.toHaveProperty('tools');
    expect(result.notes).toEqual([
      // form、checklist、board、number（点数）、number（剩下）
      { kind: 'removedDataComponents', table: 'tasks', count: 5 },
      // 「全部重来」「新任务」两个按钮，项目列表上的「加任务」
      { kind: 'removedRecordActions', count: 3 },
    ]);
  });

  it('refuses a table another table links to, or one with pages for one entry', () => {
    expect(errorOf(tasksConfig(), [{ op: 'removeData', table: 'projects' }])).toBe(
      'table projects is linked from tasks.project; remove those fields (and the blocks that show them) first',
    );
    const withPage = apply(tasksConfig(), [
      { op: 'addContainer', page: { id: 'task', title: '任务', of: 'tasks', blocks: [] } },
    ]);
    expect(errorOf(withPage, [{ op: 'removeData', table: 'tasks' }])).toBe(
      'pages task show one entry of tasks; remove them first',
    );
    expect(errorOf(tasksConfig(), [{ op: 'removeData', table: 'nope' }])).toBe(
      'table nope not found',
    );
    expect(errorOf(tasksConfig(), [{ op: 'removeData', table: 'tasks', field: 'nope' }])).toBe(
      'field nope not found in tasks',
    );
  });

  it('a reminder on a removed field goes with it', () => {
    const config = apply(tasksConfig(), [
      {
        op: 'addTool',
        tool: {
          id: 'due-soon',
          kind: 'reminder',
          title: '快到期了',
          enabled: true,
          when: { before: { table: 'tasks', field: 'due' }, days: 1, at: '09:00' },
          opens: 'page:tasks-page',
        },
      },
    ]);
    const result = tryOps(config, [{ op: 'removeData', table: 'tasks', field: 'due' }]);
    expect(result.ok && remindersOf(result.config)).toEqual([]);
    expect(result.ok && result.notes).toContainEqual({
      kind: 'removedReminders',
      titles: ['快到期了'],
    });
  });
});

describe('moveData', () => {
  it('moves a field; refuses a missing one', () => {
    const config = apply(tasksConfig(), [
      { op: 'moveData', table: 'tasks', field: 'points', toIndex: 0 },
    ]);
    expect(config.data.tables[1]!.fields[0]!.id).toBe('points');
    expect(errorOf(config, [{ op: 'moveData', table: 'tasks', field: 'x', toIndex: 0 }])).toBe(
      'field x not found in tasks',
    );
  });
});

// ---- 容器 ----

describe('addContainer', () => {
  it('adds a page with blocks, and a block at an index or into a group', () => {
    const config = apply(tasksConfig(), [
      {
        op: 'addContainer',
        page: {
          id: 'notes',
          title: '笔记',
          blocks: [{ id: 'h', look: 'header', show: { title: '笔记' } }],
        },
      },
      {
        op: 'addContainer',
        page: 'notes',
        index: 0,
        block: { id: 'sp', look: 'spacer', show: { size: 'small' } },
      },
      {
        op: 'addContainer',
        page: 'tasks-page',
        parent: 'row',
        block: { id: 'd', look: 'divider' },
      },
    ]);
    expect(ids(page(config, 'notes').blocks)).toEqual(['sp', 'h']);
    expect(ids((block(config, 'tasks-page', 'row') as { children: Component[] }).children)).toEqual(
      ['count', 'reset', 'd'],
    );
  });

  it('a group can hold one more group, but not two levels deep', () => {
    const inner: NewComponent = {
      id: 'inner',
      look: 'group',
      show: { layout: 'row' },
      children: [],
    };
    const two = apply(tasksConfig(), [
      { op: 'addContainer', page: 'tasks-page', parent: 'row', block: inner },
    ]);
    expect(ids(allComponents(page(two, 'tasks-page')))).toContain('inner');
    expect(
      errorOf(two, [
        {
          op: 'addContainer',
          page: 'tasks-page',
          parent: 'inner',
          block: { id: 'deeper', look: 'group', show: { layout: 'row' }, children: [] },
        },
      ]),
    ).toBe('block inner is already inside a group; groups nest two levels at most');
    expect(
      errorOf(two, [
        {
          op: 'addContainer',
          page: 'tasks-page',
          parent: 'row',
          block: {
            id: 'outer',
            look: 'group',
            show: { layout: 'stack' },
            children: [{ id: 'in2', look: 'group', show: { layout: 'row' }, children: [] }],
          },
        },
      ]),
    ).toBe(
      'group outer holds a group; it can only sit at the top of the page (groups nest two levels at most)',
    );
  });

  it('refuses duplicate pages and blocks, missing pages and non-group parents', () => {
    const config = tasksConfig();
    expect(
      errorOf(config, [{ op: 'addContainer', page: { id: 'home', title: 'x', blocks: [] } }]),
    ).toBe('page home already exists');
    expect(
      errorOf(config, [
        { op: 'addContainer', page: 'tasks-page', block: { id: 'board', look: 'divider' } },
      ]),
    ).toBe('block board already exists on page tasks-page');
    expect(
      errorOf(config, [{ op: 'addContainer', page: 'nope', block: { id: 'x', look: 'divider' } }]),
    ).toBe('page nope not found');
    expect(
      errorOf(config, [
        {
          op: 'addContainer',
          page: 'tasks-page',
          parent: 'board',
          block: { id: 'x', look: 'divider' },
        },
      ]),
    ).toBe('block board is not a group');
    expect(
      errorOf(config, [
        {
          op: 'addContainer',
          page: 'tasks-page',
          parent: 'nope',
          block: { id: 'x', look: 'divider' },
        },
      ]),
    ).toBe('block nope not found on page tasks-page');
  });

  it('adds a block above or below the preview in the file room', () => {
    const config = apply(workspace(), [
      {
        op: 'addContainer',
        desk: 'above',
        block: { id: 'tip', look: 'notice', show: { text: '先选文件' } },
      },
    ]);
    expect(config.containers.desk).toEqual({
      above: [{ id: 'tip', look: 'notice', show: { text: '先选文件' } }],
    });
    expect(
      errorOf(config, [
        { op: 'addContainer', desk: 'below', block: { id: 'tip', look: 'divider' } },
      ]),
    ).toBe('block tip already exists in the file room');
  });

  it('the shape: a page, a block on a page, or a block in the file room', () => {
    const parse = (o: unknown) => OpSchema.safeParse(o).success;
    expect(parse({ op: 'addContainer', page: 'home' })).toBe(false);
    expect(parse({ op: 'addContainer', page: { id: 'x', title: 'x', blocks: [] }, index: 0 })).toBe(
      false,
    );
    expect(
      parse({ op: 'addContainer', page: { id: 'x', title: 'x', blocks: [], package: 'pdf' } }),
    ).toBe(false);
    expect(
      parse({
        op: 'addContainer',
        desk: 'above',
        page: 'home',
        block: { id: 'x', look: 'divider' },
      }),
    ).toBe(false);
  });
});

describe('updateContainer', () => {
  it('changes a page title, icon and backdrop', () => {
    const config = apply(workspace(), [
      {
        op: 'updateContainer',
        page: 'home',
        changes: { title: '主页', icon: 'star', backdrop: { overlay: 'light' } },
      },
    ]);
    expect(page(config, 'home')).toMatchObject({
      title: '主页',
      icon: 'star',
      backdrop: { overlay: 'light' },
    });
    const off = apply(config, [
      { op: 'updateContainer', page: 'home', changes: { icon: null, backdrop: null } },
    ]);
    expect(page(off, 'home')).not.toHaveProperty('icon');
    expect(page(off, 'home')).not.toHaveProperty('backdrop');
  });

  it('merges show and source key by key; replaces tools and opens; null removes', () => {
    const config = apply(tasksConfig(), [
      {
        op: 'updateContainer',
        page: 'tasks-page',
        block: 'checks',
        changes: {
          show: { subtitles: ['due'], emptyText: '都做完了' },
          source: { limit: 5, sort: { field: 'due', direction: 'asc' } },
        },
      },
    ]);
    expect(block(config, 'tasks-page', 'checks')).toMatchObject({
      show: { title: 'title', subtitles: ['due'], emptyText: '都做完了' },
      source: { table: 'tasks', limit: 5, sort: { field: 'due', direction: 'asc' } },
    });
    const replaced = apply(config, [
      {
        op: 'updateContainer',
        page: 'tasks-page',
        block: 'checks',
        changes: {
          show: { emptyText: null },
          tools: [{ as: 'check', do: 'toggle', table: 'tasks', field: 'done' }],
        },
      },
      { op: 'updateContainer', page: 'tasks-page', block: 'board', changes: { tools: null } },
    ]);
    expect(block(replaced, 'tasks-page', 'checks')).toMatchObject({
      show: { title: 'title', subtitles: ['due'] },
      tools: [{ as: 'check', do: 'toggle', table: 'tasks', field: 'done' }],
    });
    expect((block(replaced, 'tasks-page', 'checks') as { show: object }).show).not.toHaveProperty(
      'emptyText',
    );
    expect(block(replaced, 'tasks-page', 'board')).not.toHaveProperty('tools');
    expect(issuesOf(replaced)).toEqual([]);
  });

  it('style and hidden: set and reset; a block in a group too', () => {
    const styled = apply(tasksConfig(), [
      {
        op: 'updateContainer',
        page: 'tasks-page',
        block: 'count',
        changes: { style: { tone: 'primary' }, hidden: true },
      },
    ]);
    expect(block(styled, 'tasks-page', 'count')).toMatchObject({
      style: { tone: 'primary' },
      hidden: true,
    });
    const reset = apply(styled, [
      {
        op: 'updateContainer',
        page: 'tasks-page',
        block: 'count',
        changes: { style: { tone: null }, hidden: false },
      },
    ]);
    expect(block(reset, 'tasks-page', 'count')).not.toHaveProperty('style');
    expect(block(reset, 'tasks-page', 'count')).not.toHaveProperty('hidden');
  });

  it('a page takes only page changes, a block only block changes', () => {
    expect(
      errorOf(workspace(), [{ op: 'updateContainer', page: 'home', changes: { hidden: true } }]),
    ).toBe('page home can change title, icon, backdrop; not hidden');
    expect(
      errorOf(workspace(), [
        { op: 'updateContainer', page: 'home', block: 'welcome', changes: { title: 'x' } },
      ]),
    ).toBe('block welcome can change style, hidden, show, source, tools, opens; not title');
    expect(
      errorOf(workspace(), [
        { op: 'updateContainer', page: 'home', block: 'nope', changes: { hidden: true } },
      ]),
    ).toBe('block nope not found on page home');
  });

  it('nav: the bar takes items out of floating; Settings never gets lost', () => {
    const result = tryOps(workspace(), [
      { op: 'updateContainer', nav: { bar: ['page:home', 'ai'] } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.nav).toEqual({ bar: ['page:home', 'ai'], floating: ['settings'] });
    expect(result.notes).toEqual([{ kind: 'movedToFloating', target: 'settings' }]);
    const back = apply(result.config, [
      { op: 'updateContainer', nav: { bar: ['page:home', 'settings', 'settings'] } },
    ]);
    expect(back.nav).toEqual({ bar: ['page:home', 'settings'], floating: [] });
  });

  it('nav: floating takes items out of the bar', () => {
    const config = apply(workspace(), [{ op: 'updateContainer', nav: { floating: ['ai'] } }]);
    expect(config.nav).toEqual({
      bar: ['page:home', 'tools', 'history', 'settings'],
      floating: ['ai'],
    });
    expect(issuesOf(config)).toEqual([]);
  });

  it('nav: the phone home screen is a whole list of quick actions; [] empties it', () => {
    const config = apply(workspace('zh', { withPdf: true }), [
      { op: 'updateContainer', nav: { phoneHomeScreen: ['pdf-merge', 'pdf-merge'] } },
    ]);
    expect(config.nav.phoneHomeScreen).toEqual(['pdf-merge']);
    const none = apply(config, [{ op: 'updateContainer', nav: { phoneHomeScreen: [] } }]);
    expect(none.nav).not.toHaveProperty('phoneHomeScreen');
    expect(errorOf(config, [{ op: 'updateContainer', nav: { phoneHomeScreen: ['nope'] } }])).toBe(
      'tool nope not found',
    );
  });

  it('the file room layout: merges, null resets, only layout keys', () => {
    const config = apply(workspace(), [
      { op: 'updateContainer', desk: { toolbar: 'top', strip: false } },
    ]);
    expect(config.containers.desk).toEqual({ toolbar: 'top', strip: false });
    const reset = apply(config, [{ op: 'updateContainer', desk: { toolbar: null, strip: null } }]);
    expect(reset.containers).not.toHaveProperty('desk');
    expect(errorOf(config, [{ op: 'updateContainer', desk: { above: [] } }])).toBe(
      'the file room can change toolbar, preview, strip, tools; not above',
    );
  });

  it('a block this version does not know can only be moved or removed', () => {
    const config = structuredClone(workspace());
    page(config, 'home').blocks.push({ id: 'future', look: 'hologram' } as unknown as Component);
    expect(
      errorOf(config, [
        { op: 'updateContainer', page: 'home', block: 'future', changes: { hidden: true } },
      ]),
    ).toBe('block future needs a newer version of the app; it can only be moved or removed');
    expect(
      tryOps(config, [{ op: 'moveContainer', page: 'home', block: 'future', toIndex: 0 }]).ok,
    ).toBe(true);
  });

  it('the shape: page changes, nav or desk, one at a time', () => {
    const parse = (o: unknown) => OpSchema.safeParse(o).success;
    expect(parse({ op: 'updateContainer', page: 'home' })).toBe(false);
    expect(parse({ op: 'updateContainer', nav: { bar: [] } })).toBe(false);
    expect(parse({ op: 'updateContainer', nav: { floating: [] }, page: 'home', changes: {} })).toBe(
      false,
    );
    expect(parse({ op: 'updateContainer', desk: {}, nav: {} })).toBe(false);
  });
});

describe('removeContainer', () => {
  it('a page: links, nav items and record blocks that opened it are cleaned up', () => {
    const config = apply(tasksConfig(), [
      { op: 'addContainer', page: { id: 'task', title: '任务', of: 'tasks', blocks: [] } },
      { op: 'updateContainer', page: 'tasks-page', block: 'board', changes: { opens: 'task' } },
      {
        op: 'updateContainer',
        page: 'tasks-page',
        block: 'checks',
        changes: {
          tools: [
            { as: 'check', do: 'toggle', table: 'tasks', field: 'done' },
            { as: 'button', label: '打开', opens: 'task' },
          ],
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'go', look: 'entry', show: { title: '任务' }, opens: 'page:tasks-page' },
      },
    ]);
    const gone = tryOps(config, [{ op: 'removeContainer', page: 'task' }]);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(block(gone.config, 'tasks-page', 'board')).not.toHaveProperty('opens');
    expect((block(gone.config, 'tasks-page', 'checks') as { tools: unknown[] }).tools[1]).toEqual({
      as: 'button',
      label: '打开',
      opens: 'record',
    });
    expect(gone.notes).toEqual([]);

    const result = tryOps(config, [
      { op: 'removeContainer', page: 'task' },
      { op: 'removeContainer', page: 'tasks-page' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.containers.pages.map((p) => p.id)).toEqual(['home', 'tool-pdf']);
    expect(result.config.nav.floating).toEqual([]);
    expect(block(result.config, 'home', 'go')).toBeUndefined();
    expect(result.notes).toEqual([{ kind: 'removedLinks', pageId: 'tasks-page', count: 1 }]);
  });

  it('a page in the bar: an empty bar falls back to the home page', () => {
    const config = apply(workspace(), [
      { op: 'addContainer', page: { id: 'notes', title: '笔记', blocks: [] } },
      { op: 'updateContainer', nav: { bar: ['page:notes'] } },
    ]);
    const removed = apply(config, [{ op: 'removeContainer', page: 'notes' }]);
    expect(removed.nav.bar).toEqual(['page:home']);
  });

  it('refuses the home page, a tool page and a missing page', () => {
    const config = workspace('zh', { withPdf: true });
    expect(errorOf(config, [{ op: 'removeContainer', page: 'home' }])).toBe(
      'the home page cannot be removed',
    );
    expect(errorOf(config, [{ op: 'removeContainer', page: 'tool-pdf' }])).toBe(
      'page tool-pdf belongs to tool pdf; remove the tool',
    );
    expect(errorOf(config, [{ op: 'removeContainer', page: 'nope' }])).toBe('page nope not found');
  });

  it('a block, also inside a group; a missing block is an error', () => {
    const config = apply(tasksConfig(), [
      { op: 'removeContainer', page: 'tasks-page', block: 'count' },
      { op: 'removeContainer', page: 'tasks-page', block: 'board' },
    ]);
    expect(ids(allComponents(page(config, 'tasks-page')))).toEqual([
      'title',
      'add',
      'checks',
      'row',
      'reset',
      'by-project',
    ]);
    expect(errorOf(config, [{ op: 'removeContainer', page: 'tasks-page', block: 'count' }])).toBe(
      'block count not found on page tasks-page',
    );
  });

  it('a block in the file room; an empty room layout is dropped', () => {
    const config = apply(workspace(), [
      { op: 'addContainer', desk: 'below', block: { id: 'd', look: 'divider' } },
    ]);
    const removed = apply(config, [{ op: 'removeContainer', desk: 'below', block: 'd' }]);
    expect(removed.containers).not.toHaveProperty('desk');
    expect(errorOf(removed, [{ op: 'removeContainer', desk: 'below', block: 'd' }])).toBe(
      'block d not found below the preview in the file room',
    );
  });
});

describe('moveContainer', () => {
  it('moves blocks within a page, into and out of groups', () => {
    const config = apply(tasksConfig(), [
      { op: 'moveContainer', page: 'tasks-page', block: 'board', toIndex: 0, parent: 'row' },
      { op: 'moveContainer', page: 'tasks-page', block: 'reset', toIndex: 0 },
    ]);
    expect(ids(page(config, 'tasks-page').blocks)).toEqual([
      'reset',
      'title',
      'add',
      'checks',
      'row',
      'by-project',
    ]);
    expect(ids((block(config, 'tasks-page', 'row') as { children: Component[] }).children)).toEqual(
      ['board', 'count'],
    );
  });

  it('refuses a group into itself, a missing block and a non-group parent', () => {
    const config = tasksConfig();
    expect(
      errorOf(config, [
        { op: 'moveContainer', page: 'tasks-page', block: 'row', toIndex: 0, parent: 'row' },
      ]),
    ).toBe('a group cannot contain itself');
    expect(
      errorOf(config, [{ op: 'moveContainer', page: 'tasks-page', block: 'x', toIndex: 0 }]),
    ).toBe('block x not found on page tasks-page');
    expect(
      errorOf(config, [
        { op: 'moveContainer', page: 'tasks-page', block: 'count', toIndex: 0, parent: 'board' },
      ]),
    ).toBe('block board is not a group');
  });
});

// ---- 工具 ----

const myAction: QuickAction = {
  id: 'share-it',
  kind: 'quickAction',
  name: '分享',
  steps: [
    { id: 'pick', action: 'in.files', params: { accept: 'any', min: 1, max: 5 } },
    { id: 'share', action: 'out.share', params: {} },
  ],
};
const daily: Reminder = {
  id: 'daily',
  kind: 'reminder',
  title: '写日记',
  enabled: true,
  when: { every: 'day', at: '21:00' },
  opens: 'page:home',
};

describe('addTool', () => {
  it('adds a quick action and a reminder; steps at an index', () => {
    const config = apply(workspace(), [
      { op: 'addTool', tool: myAction },
      { op: 'addTool', tool: daily },
      {
        op: 'addTool',
        tool: 'share-it',
        index: 1,
        step: { id: 'zip', action: 'file.order', params: {} },
      },
    ]);
    expect(config.tools.map((t) => t.id)).toEqual(['share-it', 'daily']);
    expect(quickActionsOf(config)[0]!.steps.map((s) => s.id)).toEqual(['pick', 'zip', 'share']);
  });

  it('refuses a used id, a step on a reminder, a duplicate step and too many reminders', () => {
    const config = apply(workspace(), [
      { op: 'addTool', tool: myAction },
      { op: 'addTool', tool: daily },
    ]);
    expect(errorOf(config, [{ op: 'addTool', tool: { ...daily, id: 'share-it' } }])).toBe(
      'tool share-it already exists',
    );
    const step = { id: 'x', action: 'out.share', params: {} };
    expect(errorOf(config, [{ op: 'addTool', tool: 'daily', step }])).toBe(
      'tool daily is a reminder, not a quick action',
    );
    expect(errorOf(config, [{ op: 'addTool', tool: 'nope', step }])).toBe('tool nope not found');
    expect(
      errorOf(config, [{ op: 'addTool', tool: 'share-it', step: { ...step, id: 'share' } }]),
    ).toBe('step share already exists in share-it');
    const full = apply(
      workspace(),
      Array.from({ length: 20 }, (_, i) => ({
        op: 'addTool' as const,
        tool: { ...daily, id: `r${i}` },
      })),
    );
    expect(errorOf(full, [{ op: 'addTool', tool: { ...daily, id: 'r20' } }])).toBe(
      'at most 20 reminders',
    );
  });

  it('the shape: a new tool, or a quick action id with a step; never a package’s', () => {
    const parse = (o: unknown) => OpSchema.safeParse(o).success;
    expect(parse({ op: 'addTool', tool: 'share-it' })).toBe(false);
    expect(parse({ op: 'addTool', tool: { ...myAction, package: 'pdf' } })).toBe(false);
    expect(
      parse({ op: 'addTool', tool: myAction, step: { id: 'x', action: 'out.share', params: {} } }),
    ).toBe(false);
  });
});

describe('updateTool', () => {
  const base = () =>
    apply(workspace(), [
      { op: 'addTool', tool: myAction },
      { op: 'addTool', tool: daily },
    ]);

  it('renames a quick action, sets and removes its icon, replaces its steps', () => {
    const config = apply(base(), [
      { op: 'updateTool', tool: 'share-it', changes: { name: '发出去', icon: 'share' } },
      {
        op: 'updateTool',
        tool: 'share-it',
        changes: {
          steps: [
            { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
          ],
        },
      },
    ]);
    expect(quickActionsOf(config)[0]).toMatchObject({ name: '发出去', icon: 'share' });
    expect(quickActionsOf(config)[0]!.steps.map((s) => s.id)).toEqual(['pick']);
    const plain = apply(config, [{ op: 'updateTool', tool: 'share-it', changes: { icon: null } }]);
    expect(quickActionsOf(plain)[0]).not.toHaveProperty('icon');
  });

  it('a step: params merge, ask is replaced, [] asks nothing', () => {
    const config = apply(base(), [
      {
        op: 'updateTool',
        tool: 'share-it',
        step: 'pick',
        changes: { params: { max: 3 }, ask: ['max', 'max'] },
      },
    ]);
    expect(quickActionsOf(config)[0]!.steps[0]).toEqual({
      id: 'pick',
      action: 'in.files',
      params: { accept: 'any', min: 1, max: 3 },
      ask: ['max'],
    });
    const quiet = apply(config, [
      { op: 'updateTool', tool: 'share-it', step: 'pick', changes: { ask: [] } },
    ]);
    expect(quickActionsOf(quiet)[0]!.steps[0]).not.toHaveProperty('ask');
  });

  it('a reminder merges; null removes an optional key; id and kind never change', () => {
    const config = apply(base(), [
      {
        op: 'updateTool',
        tool: 'daily',
        changes: { enabled: false, when: { every: 'week', days: [1], at: '08:00' } },
      },
    ]);
    expect(remindersOf(config)[0]).toMatchObject({
      enabled: false,
      when: { every: 'week', days: [1], at: '08:00' },
    });
    expect(
      errorOf(config, [{ op: 'updateTool', tool: 'daily', changes: { kind: 'quickAction' } }]),
    ).toBe("a reminder's kind cannot change");
  });

  it('refuses unknown keys, a missing tool or step, twice the same step id', () => {
    const config = base();
    expect(errorOf(config, [{ op: 'updateTool', tool: 'share-it', changes: { id: 'x' } }])).toBe(
      'quick action share-it can change name, icon, steps; not id',
    );
    expect(errorOf(config, [{ op: 'updateTool', tool: 'nope', changes: {} }])).toBe(
      'tool nope not found',
    );
    expect(
      errorOf(config, [{ op: 'updateTool', tool: 'share-it', step: 'nope', changes: {} }]),
    ).toBe('step nope not found in share-it');
    expect(
      errorOf(config, [
        { op: 'updateTool', tool: 'share-it', step: 'pick', changes: { action: 'out.share' } },
      ]),
    ).toBe('step pick can change params, ask; not action');
    const step = { id: 'a', action: 'out.share', params: {} };
    expect(
      errorOf(config, [{ op: 'updateTool', tool: 'share-it', changes: { steps: [step, step] } }]),
    ).toBe('step a appears twice in share-it');
    expect(errorOf(config, [{ op: 'updateTool', tool: 'share-it', changes: { steps: [] } }])).toBe(
      'steps of share-it must be a list of at least one step',
    );
  });
});

describe('removeTool', () => {
  it('a quick action: its action blocks, entries that open it, the home screen and the room toolbar', () => {
    const config = apply(workspace(), [
      { op: 'addTool', tool: myAction },
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'run', look: 'action', tools: [{ tool: 'share-it' }] },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'go', look: 'entry', show: { title: '分享' }, opens: 'tool:share-it' },
      },
      { op: 'updateContainer', nav: { phoneHomeScreen: ['share-it'] } },
      {
        op: 'updateContainer',
        desk: {
          tools: {
            pdf: [{ items: ['share-it'] }, { items: [{ action: 'pdf.merge' }, 'share-it'] }],
          },
        },
      },
    ]);
    const result = tryOps(config, [{ op: 'removeTool', tool: 'share-it' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.config;
    expect(c.tools).toEqual([]);
    expect(ids(page(c, 'home').blocks)).toEqual(ids(page(workspace(), 'home').blocks));
    expect(c.nav).not.toHaveProperty('phoneHomeScreen');
    expect(c.containers.desk).toEqual({ tools: { pdf: [{ items: [{ action: 'pdf.merge' }] }] } });
    expect(result.notes).toEqual([
      { kind: 'removedRunners', tool: 'share-it', count: 1 },
      { kind: 'removedWorkflowLinks', tool: 'share-it', count: 3 },
    ]);
  });

  it('a reminder that opens a removed quick action goes too', () => {
    const config = apply(workspace(), [
      { op: 'addTool', tool: myAction },
      { op: 'addTool', tool: { ...daily, opens: 'tool:share-it' } },
    ]);
    const result = tryOps(config, [{ op: 'removeTool', tool: 'share-it' }]);
    expect(result.ok && result.config.tools).toEqual([]);
    expect(result.ok && result.notes).toEqual([{ kind: 'removedReminders', titles: ['写日记'] }]);
  });

  it('a step; a reminder; never a package’s quick action', () => {
    const config = apply(workspace('zh', { withPdf: true }), [
      { op: 'addTool', tool: myAction },
      { op: 'addTool', tool: daily },
      { op: 'removeTool', tool: 'share-it', step: 'share' },
      { op: 'removeTool', tool: 'daily' },
    ]);
    expect(
      quickActionsOf(config)
        .find((w) => w.id === 'share-it')!
        .steps.map((s) => s.id),
    ).toEqual(['pick']);
    expect(remindersOf(config)).toEqual([]);
    expect(errorOf(config, [{ op: 'removeTool', tool: 'pdf-merge' }])).toBe(
      'pdf-merge belongs to tool pdf; remove the tool or remove steps instead',
    );
    expect(errorOf(config, [{ op: 'removeTool', tool: 'nope' }])).toBe('tool nope not found');
    expect(errorOf(config, [{ op: 'removeTool', tool: 'share-it', step: 'nope' }])).toBe(
      'step nope not found in share-it',
    );
  });
});

describe('moveTool', () => {
  it('moves a step; refuses a missing step or a reminder', () => {
    const config = apply(workspace(), [
      { op: 'addTool', tool: myAction },
      { op: 'addTool', tool: daily },
      { op: 'moveTool', tool: 'share-it', step: 'share', toIndex: 0 },
    ]);
    expect(quickActionsOf(config)[0]!.steps.map((s) => s.id)).toEqual(['share', 'pick']);
    expect(errorOf(config, [{ op: 'moveTool', tool: 'share-it', step: 'x', toIndex: 0 }])).toBe(
      'step x not found in share-it',
    );
    expect(errorOf(config, [{ op: 'moveTool', tool: 'daily', step: 'x', toIndex: 0 }])).toBe(
      'tool daily is a reminder, not a quick action',
    );
  });
});

// ---- 主题 ----

describe('setTheme', () => {
  it('sets and resets theme tokens and color overrides', () => {
    const styled = apply(workspace(), [
      {
        op: 'setTheme',
        fontScale: 1.15,
        radius: 8,
        density: 'compact',
        cardStyle: 'outline',
        navStyle: 'icon',
        font: 'serif',
        colors: { background: '#FFFFFF' },
      },
    ]);
    expect(styled.theme).toMatchObject({
      fontScale: 1.15,
      radius: 8,
      density: 'compact',
      cardStyle: 'outline',
      navStyle: 'icon',
      font: 'serif',
      colors: { background: '#FFFFFF' },
    });
    expect(issuesOf(styled)).toEqual([]);
    const cleared = apply(styled, [{ op: 'setTheme', colors: { background: null } }]);
    expect(cleared.theme.colors).toEqual({});
    expect(apply(styled, [{ op: 'setTheme', reset: true }]).theme).toEqual(workspace().theme);
  });

  it('sets dark-mode colors separately and drops them when all are cleared', () => {
    const styled = apply(workspace(), [
      {
        op: 'setTheme',
        mode: 'system',
        cardStyle: 'brutal',
        colors: { background: '#FFF8E7', tertiary: '#3B82F6' },
        darkColors: { background: '#111111', surface: '#1C1C1C', text: '#F5F5F5' },
      },
    ]);
    expect(styled.theme.colors).toEqual({ background: '#FFF8E7', tertiary: '#3B82F6' });
    expect(styled.theme.darkColors).toEqual({
      background: '#111111',
      surface: '#1C1C1C',
      text: '#F5F5F5',
    });
    const cleared = apply(styled, [
      { op: 'setTheme', darkColors: { background: null, surface: null, text: null } },
    ]);
    expect(cleared.theme).not.toHaveProperty('darkColors');
  });

  it('a page backdrop and glass cards; resetting the theme removes the backdrop', () => {
    const styled = apply(workspace(), [{ op: 'setTheme', backdrop: 'aurora', cardStyle: 'glass' }]);
    expect(styled.theme).toMatchObject({ backdrop: 'aurora', cardStyle: 'glass' });
    expect(apply(styled, [{ op: 'setTheme', reset: true }]).theme).not.toHaveProperty('backdrop');
  });

  it('a preset replaces the whole theme', () => {
    const styled = apply(workspace(), [{ op: 'setTheme', primaryColor: '#2F9E44' }]);
    const preset = apply(styled, [{ op: 'setTheme', preset: 'nature' }]);
    expect(preset.theme.primaryColor).not.toBe('#2F9E44');
  });

  it('the shape: a preset, a reset or a patch, alone', () => {
    const parse = (o: unknown) => OpSchema.safeParse(o).success;
    expect(parse({ op: 'setTheme' })).toBe(false);
    expect(parse({ op: 'setTheme', preset: 'nature', radius: 8 })).toBe(false);
    expect(parse({ op: 'setTheme', reset: true, radius: 8 })).toBe(false);
    expect(parse({ op: 'setTheme', preset: 'nope' })).toBe(false);
  });
});

// ---- 工具包 ----

describe('setPackage', () => {
  it('add: page, quick actions and a home entry before "Add tools"', () => {
    const config = workspace('zh', { withPdf: true });
    expect(config.packages.map((t) => t.id)).toEqual(['pdf']);
    expect(config.containers.pages.map((p) => p.id)).toEqual(['home', 'tool-pdf']);
    expect(quickActionsOf(config).map((w) => w.id)).toEqual(
      registry.tools
        .get('pdf')!
        .createWorkflows('zh')
        .map((w) => w.id),
    );
    expect(ids(page(config, 'home').blocks)).toEqual([
      'welcome',
      'card-pdf',
      'catalog',
      'recent-files',
    ]);
    expect(block(config, 'home', 'card-pdf')).toEqual({
      id: 'card-pdf',
      look: 'entry',
      show: { shape: 'tile' },
      opens: 'package:pdf',
    });
    expect(issuesOf(config)).toEqual([]);
    expect(errorOf(config, [{ op: 'setPackage', package: 'pdf', do: 'add' }])).toBe(
      'tool pdf is already added',
    );
    expect(errorOf(config, [{ op: 'setPackage', package: 'nope', do: 'add' }])).toBe(
      'tool nope is not in the catalog',
    );
  });

  it('add: no home entry when a tool grid already shows it', () => {
    const config = apply(workspace(), [
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'grid', look: 'packages', source: { catalog: 'packages' } },
      },
      { op: 'setPackage', package: 'pdf', do: 'add' },
    ]);
    expect(block(config, 'home', 'card-pdf')).toBeUndefined();
  });

  it('remove: everything it added, its entries (also in a group) and links to its page', () => {
    const config = apply(workspace('zh', { withPdf: true }), [
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'g', look: 'group', show: { layout: 'row' }, children: [] },
      },
      { op: 'moveContainer', page: 'home', block: 'card-pdf', parent: 'g', toIndex: 0 },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'go',
          look: 'button',
          show: { label: 'PDF', variant: 'text' },
          opens: 'page:tool-pdf',
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'merge', look: 'action', tools: [{ tool: 'pdf-merge' }] },
      },
      {
        op: 'updateContainer',
        nav: { floating: ['page:tool-pdf'], phoneHomeScreen: ['pdf-merge'] },
      },
    ]);
    const removed = apply(config, [{ op: 'setPackage', package: 'pdf', do: 'remove' }]);
    expect(removed.packages).toEqual([]);
    expect(removed.tools).toEqual([]);
    expect(removed.containers.pages.map((p) => p.id)).toEqual(['home']);
    expect(ids(allComponents(page(removed, 'home')))).toEqual([
      'welcome',
      'catalog',
      'recent-files',
      'g',
    ]);
    expect(removed.nav).toEqual(workspace().nav);
    expect(issuesOf(removed)).toEqual([]);
    expect(errorOf(removed, [{ op: 'setPackage', package: 'pdf', do: 'remove' }])).toBe(
      'tool pdf is not added',
    );
  });

  it('update: refuses one that is up to date or not added', () => {
    const config = workspace('zh', { withPdf: true });
    expect(errorOf(config, [{ op: 'setPackage', package: 'pdf', do: 'update' }])).toBe(
      'tool pdf is up to date',
    );
    expect(errorOf(workspace(), [{ op: 'setPackage', package: 'pdf', do: 'update' }])).toBe(
      'tool pdf is not added',
    );
  });

  it('update: an old PDF tool gets the new quick actions and entries; user changes stay', async () => {
    const { V4_FIXED_NAME } = await import('./fixtures/v4');
    const { prepareSnapshot } = await import('./change');
    const old = prepareSnapshot(V4_FIXED_NAME, registry);
    if (!old.ok) throw new Error(old.issues.join('; '));
    expect(old.after.packages[0]!.version).toBe('1.0.0');
    const result = prepareOps(old.after, [{ op: 'setPackage', package: 'pdf', do: 'update' }], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.after;
    expect(after.packages[0]!.version).toBe(registry.tools.get('pdf')!.version);
    // 用户改过的合并流程（固定文件名）不变。
    expect(after.tools[0]).toEqual(old.after.tools[0]);
    expect(after.tools.map((w) => w.id)).toContain('pdf-split');
    const pdf = page(after, 'tool-pdf');
    expect((pdf.blocks.at(-1) as KnownComponent).look).toBe('files');
    expect(pdf.blocks.filter((c) => (c as KnownComponent).look === 'action')).toHaveLength(
      quickActionsOf(after).length,
    );
    expect(result.lines[0]).toMatch(/^更新「PDF」工具：新增 PDF 和图片合成一个、图片转 PDF/);
    expect(prepareOps(after, [{ op: 'setPackage', package: 'pdf', do: 'update' }], ctx).ok).toBe(
      false,
    );
  });
});

describe('prepareOps', () => {
  it('rejects malformed model output before applying anything', () => {
    const result = prepareOps(workspace(), [{ op: 'runScript', code: 'rm -rf /' }], ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('parse');
  });

  it('rejects ops whose result fails validation', () => {
    const result = prepareOps(
      workspace(),
      [{ op: 'updateContainer', page: 'home', block: 'welcome', changes: { show: { title: '' } } }],
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('validate');
  });

  it('describes the change in the user’s language', () => {
    const result = prepareOps(
      workspace('zh', { withPdf: true }),
      [
        { op: 'updateContainer', nav: { bar: ['page:home', 'tools', 'settings'] } },
        {
          op: 'updateTool',
          tool: 'pdf-merge',
          step: 'name',
          changes: { params: { template: '合并-{date:YYYY-MM-DD}' }, ask: [] },
        },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      '导航栏改为：首页、工具、设置（原来：首页、工具、AI 修改、改动记录、设置）',
      '「合并 PDF」的「命名」：文件名 合并-{date:YYYY-MM-DD}（例如 合并-2026-10-22）',
      '「合并 PDF」的「命名」不再询问，直接使用设定值',
    ]);
  });

  it('names a group created in the same change', () => {
    const result = prepareOps(
      workspace('zh', { withPdf: true }),
      [
        {
          op: 'addContainer',
          page: 'home',
          index: 1,
          block: { id: 'grid', look: 'group', show: { layout: 'grid' }, children: [] },
        },
        { op: 'moveContainer', page: 'home', block: 'card-pdf', parent: 'grid', toIndex: 0 },
      ],
      ctx,
    );
    expect(result.ok && result.lines).toEqual([
      '在「首页」添加网格分组',
      '把「PDF」工具入口移到「首页」的网格分组第 1 位',
    ]);
  });

  it('describes style and page changes', () => {
    const result = prepareOps(
      workspace(),
      [
        { op: 'setTheme', fontScale: 1.15, radius: 8, cardStyle: 'flat' },
        { op: 'updateContainer', nav: { bar: ['page:home', 'ai'] } },
        { op: 'addContainer', page: { id: 'notes', title: '笔记', blocks: [] } },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      '字号改为115%',
      '圆角改为8',
      '卡片样式改为无阴影无描边',
      '导航栏改为：首页、AI 修改（原来：首页、工具、AI 修改、改动记录、设置）',
      '新建页面「笔记」（0 块内容）',
      '「设置」不能移除（AI 修改和改动记录的入口都在里面），已改为浮动按钮',
    ]);
  });

  it('describes dark-mode colors and the new card styles', () => {
    const op = {
      op: 'setTheme',
      cardStyle: 'soft',
      colors: { tertiary: '#3B82F6' },
      darkColors: { background: '#111111' },
    } as const;
    const zh = prepareOps(workspace(), [op], ctx);
    expect(zh.ok && zh.lines).toEqual([
      '第三色改为 #3B82F6',
      '深色模式的背景色改为 #111111',
      '卡片样式改为柔和浮雕（新拟物）',
    ]);
    const en = prepareOps(workspace('en'), [op], { ...ctx, locale: 'en' });
    expect(en.ok && en.lines).toEqual([
      'Tertiary color → #3B82F6',
      'Dark mode background → #111111',
      'Card style → soft embossed (neumorphic)',
    ]);
  });
});
