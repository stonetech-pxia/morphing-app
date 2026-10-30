import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { Op } from './ops';
import { THEME_PRESETS } from './presets';
import { apply, fromV33, registry, v33Fixture } from './test-helpers';
import { DEFAULT_THEME } from './theme';

// v33 的 39 个修改操作在 v34 怎么写（NEW_FORMAT_DRAFT §7.1）：每个旧操作一个例子。
// 写法：一份 v33 的配置 before，按 v33 那个操作的效果改出 v33 的 after（edit）；
// 把 before 迁移到 v34 再执行 v34 的操作，结果应该和 after 迁移到 v34 一模一样。
// 这样每个例子同时证明：新操作做到了旧操作的事，而且和迁移对得上。

type Json = Record<string, any>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const shareIt = {
  id: 'share-it',
  name: '分享',
  steps: [
    { id: 'pick', action: 'in.files', params: { accept: 'any', min: 1, max: 5 } },
    { id: 'share', action: 'out.share', params: {} },
  ],
};

/** v33：默认首页 + 一张笔记表和它的页面、一个快捷操作、一个提醒。 */
function base33(): Json {
  const d = clone(v33Fixture('default-zh')) as Json;
  d.collections = [
    {
      id: 'notes',
      name: '笔记',
      fields: [
        { id: 'title', name: '标题', type: 'text', required: true },
        { id: 'done', name: '看完', type: 'checkbox' },
        {
          id: 'kind',
          name: '类别',
          type: 'choice',
          options: [
            { id: 'a', label: '工作' },
            { id: 'b', label: '生活' },
          ],
        },
        { id: 'day', name: '日期', type: 'date' },
      ],
    },
  ];
  d.pages.push({
    id: 'notes-page',
    title: '笔记',
    components: [
      { id: 'h', type: 'header', props: { title: '笔记' } },
      {
        id: 'list',
        type: 'recordList',
        props: {
          collectionId: 'notes',
          display: 'checklist',
          titleField: 'title',
          checkField: 'done',
          limit: 20,
          rowActions: [{ do: 'set', fieldId: 'kind', value: 'a', label: '工作' }],
        },
      },
      {
        id: 'add',
        type: 'recordForm',
        props: { collectionId: 'notes', fieldIds: ['title'], submitLabel: '添加', mode: 'inline' },
      },
      {
        id: 'g',
        type: 'group',
        props: { layout: 'row' },
        children: [
          {
            id: 'n',
            type: 'stat',
            props: { collectionId: 'notes', aggregate: 'count', label: '条数' },
          },
        ],
      },
    ],
  });
  d.workflows = [clone(shareIt)];
  d.reminders = [
    {
      id: 'daily',
      title: '写笔记',
      enabled: true,
      schedule: 'daily',
      time: '21:00',
      opens: 'page:notes-page',
    },
  ];
  return d;
}

const notesPage = (d: Json) => d.pages.find((p: Json) => p.id === 'notes-page');
const comp = (d: Json, id: string): Json => {
  for (const p of d.pages)
    for (const c of p.components) {
      if (c.id === id) return c;
      for (const x of c.children ?? []) if (x.id === id) return x;
    }
  throw new Error(id);
};

interface Case {
  /** v33 的操作（写出来便于对照）。 */
  v33: Json;
  /** 先在 v33 的配置上准备一下（例如先放一个入口）。 */
  prep?: (d: Json) => void;
  v34: Op[];
  /** v33 那个操作对配置的效果。 */
  edit: (d: Json) => void;
}

const CASES: Case[] = [
  {
    v33: { op: 'setTheme', primaryColor: '#2F9E44', radius: 8 },
    v34: [{ op: 'setTheme', primaryColor: '#2F9E44', radius: 8 }],
    edit: (d) => Object.assign(d.theme, { primaryColor: '#2F9E44', radius: 8 }),
  },
  {
    v33: { op: 'resetTheme' },
    prep: (d) => (d.theme.radius = 8),
    v34: [{ op: 'setTheme', reset: true }],
    edit: (d) => (d.theme = clone(DEFAULT_THEME)),
  },
  {
    v33: { op: 'applyThemePreset', preset: 'nature' },
    v34: [{ op: 'setTheme', preset: 'nature' }],
    edit: (d) => (d.theme = clone(THEME_PRESETS.nature.theme)),
  },
  {
    v33: { op: 'setNavItems', items: ['page:home', 'ai'] },
    v34: [{ op: 'updateContainer', nav: { bar: ['page:home', 'ai'] } }],
    edit: (d) => (d.shell = { nav: ['page:home', 'ai'], floating: ['settings'] }),
  },
  {
    v33: { op: 'setFloatingItems', items: ['ai'] },
    v34: [{ op: 'updateContainer', nav: { floating: ['ai'] } }],
    edit: (d) =>
      (d.shell = { nav: ['page:home', 'tools', 'history', 'settings'], floating: ['ai'] }),
  },
  {
    v33: { op: 'setPageTitle', pageId: 'notes-page', title: '读书笔记' },
    v34: [{ op: 'updateContainer', page: 'notes-page', changes: { title: '读书笔记' } }],
    edit: (d) => (notesPage(d).title = '读书笔记'),
  },
  {
    v33: { op: 'setPageIcon', pageId: 'home', icon: null },
    v34: [{ op: 'updateContainer', page: 'home', changes: { icon: null } }],
    edit: (d) => delete d.pages[0].icon,
  },
  {
    v33: { op: 'setPageBackdrop', pageId: 'home', backdrop: { overlay: 'light' } },
    v34: [{ op: 'updateContainer', page: 'home', changes: { backdrop: { overlay: 'light' } } }],
    edit: (d) => (d.pages[0].backdrop = { overlay: 'light' }),
  },
  {
    v33: { op: 'addPage', page: { id: 'more', title: '更多', components: [] } },
    v34: [
      {
        op: 'addContainer',
        page: {
          id: 'more',
          title: '更多',
          blocks: [{ id: 't', look: 'text', show: { text: '你好' } }],
        },
      },
    ],
    edit: (d) =>
      d.pages.push({
        id: 'more',
        title: '更多',
        components: [{ id: 't', type: 'text', props: { text: '你好' } }],
      }),
  },
  {
    // 连带：指向它的入口、浮动入口，以及要打开它的提醒。
    v33: { op: 'removePage', pageId: 'notes-page' },
    prep: (d) => {
      d.pages[0].components.push({
        id: 'go',
        type: 'shortcut',
        props: { title: '笔记', target: 'page:notes-page' },
      });
      d.shell.floating = ['page:notes-page'];
    },
    v34: [{ op: 'removeContainer', page: 'notes-page' }],
    edit: (d) => {
      d.pages = d.pages.filter((p: Json) => p.id !== 'notes-page');
      d.pages[0].components = d.pages[0].components.filter((c: Json) => c.id !== 'go');
      d.shell.floating = [];
      d.reminders = [];
    },
  },
  {
    v33: { op: 'moveComponent', pageId: 'notes-page', componentId: 'n', toIndex: 1 },
    v34: [{ op: 'moveContainer', page: 'notes-page', block: 'n', toIndex: 1 }],
    edit: (d) => {
      const page = notesPage(d);
      const n = page.components[3].children.pop();
      page.components.splice(1, 0, n);
    },
  },
  {
    // 一个 props 补丁，v34 按 show / source 分开合并。
    v33: {
      op: 'setComponentProps',
      pageId: 'notes-page',
      componentId: 'list',
      props: { limit: 5, subtitleFields: ['day'] },
    },
    v34: [
      {
        op: 'updateContainer',
        page: 'notes-page',
        block: 'list',
        changes: { source: { limit: 5 }, show: { subtitles: ['day'] } },
      },
    ],
    edit: (d) => Object.assign(comp(d, 'list').props, { limit: 5, subtitleFields: ['day'] }),
  },
  {
    v33: {
      op: 'setComponentStyle',
      pageId: 'notes-page',
      componentId: 'n',
      style: { tone: 'primary' },
    },
    v34: [
      {
        op: 'updateContainer',
        page: 'notes-page',
        block: 'n',
        changes: { style: { tone: 'primary' } },
      },
    ],
    edit: (d) => (comp(d, 'n').style = { tone: 'primary' }),
  },
  {
    v33: { op: 'setComponentHidden', pageId: 'notes-page', componentId: 'h', hidden: true },
    v34: [{ op: 'updateContainer', page: 'notes-page', block: 'h', changes: { hidden: true } }],
    edit: (d) => (comp(d, 'h').hidden = true),
  },
  {
    v33: {
      op: 'addComponent',
      pageId: 'notes-page',
      parentId: 'g',
      component: { id: 'tip', type: 'notice', props: { text: '记得写' } },
    },
    v34: [
      {
        op: 'addContainer',
        page: 'notes-page',
        parent: 'g',
        block: { id: 'tip', look: 'notice', show: { text: '记得写' } },
      },
    ],
    edit: (d) =>
      comp(d, 'g').children.push({ id: 'tip', type: 'notice', props: { text: '记得写' } }),
  },
  {
    v33: { op: 'removeComponent', pageId: 'notes-page', componentId: 'add' },
    v34: [{ op: 'removeContainer', page: 'notes-page', block: 'add' }],
    edit: (d) =>
      (notesPage(d).components = notesPage(d).components.filter((c: Json) => c.id !== 'add')),
  },
  {
    v33: {
      op: 'setStepParams',
      workflowId: 'share-it',
      stepId: 'pick',
      params: { max: 3 },
      ask: ['max'],
    },
    v34: [
      {
        op: 'updateTool',
        tool: 'share-it',
        step: 'pick',
        changes: { params: { max: 3 }, ask: ['max'] },
      },
    ],
    edit: (d) =>
      Object.assign(d.workflows[0].steps[0], {
        params: { accept: 'any', min: 1, max: 3 },
        ask: ['max'],
      }),
  },
  {
    v33: { op: 'removeWorkflowStep', workflowId: 'share-it', stepId: 'pick' },
    v34: [{ op: 'removeTool', tool: 'share-it', step: 'pick' }],
    edit: (d) => d.workflows[0].steps.shift(),
  },
  {
    v33: { op: 'addWorkflow', workflow: { ...shareIt, id: 'share-2' } },
    v34: [{ op: 'addTool', tool: { ...clone(shareIt), id: 'share-2', kind: 'quickAction' } }],
    edit: (d) => d.workflows.push({ ...clone(shareIt), id: 'share-2' }),
  },
  {
    // 连带：运行它的卡片、打开它的入口；提醒要打开它时提醒也移除。
    v33: { op: 'removeWorkflow', workflowId: 'share-it' },
    prep: (d) => {
      d.pages[0].components.push(
        { id: 'run', type: 'workflowRunner', props: { workflowId: 'share-it' } },
        { id: 'go', type: 'shortcut', props: { title: '分享', target: 'workflow:share-it' } },
      );
      d.reminders[0].opens = 'workflow:share-it';
    },
    v34: [{ op: 'removeTool', tool: 'share-it' }],
    edit: (d) => {
      d.workflows = [];
      d.pages[0].components = d.pages[0].components.filter(
        (c: Json) => !['run', 'go'].includes(c.id),
      );
      d.reminders = [];
    },
  },
  {
    v33: { op: 'renameWorkflow', workflowId: 'share-it', name: '发出去', icon: 'share' },
    v34: [{ op: 'updateTool', tool: 'share-it', changes: { name: '发出去', icon: 'share' } }],
    edit: (d) => Object.assign(d.workflows[0], { name: '发出去', icon: 'share' }),
  },
  {
    v33: {
      op: 'addWorkflowStep',
      workflowId: 'share-it',
      index: 1,
      step: { id: 'order', action: 'file.order', params: {} },
    },
    v34: [
      {
        op: 'addTool',
        tool: 'share-it',
        index: 1,
        step: { id: 'order', action: 'file.order', params: {} },
      },
    ],
    edit: (d) =>
      d.workflows[0].steps.splice(1, 0, { id: 'order', action: 'file.order', params: {} }),
  },
  {
    v33: { op: 'moveWorkflowStep', workflowId: 'share-it', stepId: 'share', toIndex: 0 },
    v34: [{ op: 'moveTool', tool: 'share-it', step: 'share', toIndex: 0 }],
    edit: (d) => d.workflows[0].steps.reverse(),
  },
  {
    v33: { op: 'setWorkflowHomeScreen', workflowId: 'share-it', homeScreen: true },
    v34: [{ op: 'updateContainer', nav: { phoneHomeScreen: ['share-it'] } }],
    edit: (d) => (d.workflows[0].homeScreen = true),
  },
  {
    v33: {
      op: 'updateWorkflow',
      workflowId: 'share-it',
      name: '只分享',
      steps: [shareIt.steps[1]],
    },
    v34: [
      {
        op: 'updateTool',
        tool: 'share-it',
        changes: { name: '只分享', steps: [clone(shareIt.steps[1])] },
      },
    ],
    edit: (d) =>
      Object.assign(d.workflows[0], { name: '只分享', steps: [clone(shareIt.steps[1])] }),
  },
  {
    v33: { op: 'addCollection', collection: { id: 'books', name: '书', fields: [] } },
    v34: [
      {
        op: 'addData',
        table: { id: 'books', name: '书', fields: [{ id: 'name', name: '书名', type: 'text' }] },
      },
    ],
    edit: (d) =>
      d.collections.push({
        id: 'books',
        name: '书',
        fields: [{ id: 'name', name: '书名', type: 'text' }],
      }),
  },
  {
    v33: { op: 'updateCollection', collectionId: 'notes', name: '读书笔记', icon: 'book' },
    v34: [{ op: 'updateData', table: 'notes', changes: { name: '读书笔记', icon: 'book' } }],
    edit: (d) => Object.assign(d.collections[0], { name: '读书笔记', icon: 'book' }),
  },
  {
    v33: {
      op: 'addField',
      collectionId: 'notes',
      index: 1,
      field: { id: 'pages', name: '页数', type: 'number' },
    },
    v34: [
      {
        op: 'addData',
        table: 'notes',
        index: 1,
        field: { id: 'pages', name: '页数', type: 'number' },
      },
    ],
    edit: (d) =>
      d.collections[0].fields.splice(1, 0, { id: 'pages', name: '页数', type: 'number' }),
  },
  {
    v33: { op: 'updateField', collectionId: 'notes', fieldId: 'title', changes: { type: 'note' } },
    v34: [{ op: 'updateData', table: 'notes', field: 'title', changes: { type: 'note' } }],
    edit: (d) =>
      (d.collections[0].fields[0] = { id: 'title', name: '标题', type: 'note', required: true }),
  },
  {
    v33: { op: 'moveField', collectionId: 'notes', fieldId: 'day', toIndex: 0 },
    v34: [{ op: 'moveData', table: 'notes', field: 'day', toIndex: 0 }],
    edit: (d) => d.collections[0].fields.unshift(d.collections[0].fields.pop()),
  },
  {
    // 连带：用到这个字段的行按钮去掉（D-304）。
    v33: { op: 'removeField', collectionId: 'notes', fieldId: 'kind' },
    v34: [{ op: 'removeData', table: 'notes', field: 'kind' }],
    edit: (d) => {
      d.collections[0].fields.splice(2, 1);
      delete comp(d, 'list').props.rowActions;
    },
  },
  {
    // 连带：读它的块（列表、表单、分组里的数字）。
    v33: { op: 'removeCollection', collectionId: 'notes' },
    v34: [{ op: 'removeData', table: 'notes' }],
    edit: (d) => {
      d.collections = [];
      notesPage(d).components = [notesPage(d).components[0], { ...comp(d, 'g'), children: [] }];
    },
  },
  {
    v33: {
      op: 'addReminder',
      reminder: {
        id: 'weekly',
        title: '整理笔记',
        enabled: true,
        schedule: 'weekly',
        weekdays: [1, 5],
        time: '08:30',
        opens: 'page:notes-page',
      },
    },
    v34: [
      {
        op: 'addTool',
        tool: {
          id: 'weekly',
          kind: 'reminder',
          title: '整理笔记',
          enabled: true,
          when: { every: 'week', days: [1, 5], at: '08:30' },
          opens: 'page:notes-page',
        },
      },
    ],
    edit: (d) =>
      d.reminders.push({
        id: 'weekly',
        title: '整理笔记',
        enabled: true,
        schedule: 'weekly',
        weekdays: [1, 5],
        time: '08:30',
        opens: 'page:notes-page',
      }),
  },
  {
    v33: { op: 'updateReminder', reminderId: 'daily', changes: { enabled: false, time: '22:00' } },
    v34: [
      {
        op: 'updateTool',
        tool: 'daily',
        changes: { enabled: false, when: { every: 'day', at: '22:00' } },
      },
    ],
    edit: (d) => Object.assign(d.reminders[0], { enabled: false, time: '22:00' }),
  },
  {
    v33: { op: 'removeReminder', reminderId: 'daily' },
    v34: [{ op: 'removeTool', tool: 'daily' }],
    edit: (d) => (d.reminders = []),
  },
  {
    v33: { op: 'setCalendar', dayStartHour: 4, weekStart: 'sunday' },
    v34: [{ op: 'updateData', calendar: { dayStartHour: 4, weekStart: 'sunday' } }],
    edit: (d) => (d.calendar = { dayStartHour: 4, weekStart: 'sunday' }),
  },
];

describe('every v33 op has a v34 way to do the same thing', () => {
  it.each(CASES.map((c) => [c.v33.op as string, c] as const))('%s', (_name, c) => {
    const before = base33();
    c.prep?.(before);
    const after = clone(before);
    c.edit(after);
    expect(apply(fromV33(before), c.v34)).toEqual(fromV33(after));
  });

  it('installTool → setPackage add: the same as the v33 code made (frozen fixture)', () => {
    const added = apply(fromV33(v33Fixture('default-zh')), [
      { op: 'setPackage', package: 'pdf', do: 'add' },
    ]);
    expect(added).toEqual(fromV33(v33Fixture('setup-pdf-zh')));
  });

  it('uninstallTool → setPackage remove: back to where it was', () => {
    const removed = apply(fromV33(v33Fixture('setup-pdf-zh')), [
      { op: 'setPackage', package: 'pdf', do: 'remove' },
    ]);
    expect(removed).toEqual(fromV33(v33Fixture('default-zh')));
  });

  it('updateTool → setPackage update: an old PDF tool is brought up to date', async () => {
    const { V4_FIXED_NAME } = await import('./fixtures/v4');
    const { prepareSnapshot } = await import('./change');
    const old = prepareSnapshot(V4_FIXED_NAME, registry);
    if (!old.ok) throw new Error(old.issues.join('; '));
    const result = prepareOps(old.after, [{ op: 'setPackage', package: 'pdf', do: 'update' }], {
      registry,
      locale: 'zh',
      now: new Date(2026, 9, 30),
    });
    expect(result.ok && result.after.packages[0]!.version).toBe(registry.tools.get('pdf')!.version);
  });

  it('covers all 39 v33 ops', () => {
    const names = new Set([
      ...CASES.map((c) => c.v33.op as string),
      'installTool',
      'uninstallTool',
      'updateTool',
    ]);
    expect(names.size).toBe(39);
  });
});
