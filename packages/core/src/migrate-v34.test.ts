import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { migrateWorkspace } from './migrate';
import { allComponents, WorkspaceConfigSchema, type WorkspaceConfig } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';

// v33 → v34 的迁移（NEW_FORMAT_DRAFT §8）：v33 代码存下来的每一份配置都要升成合法的 v34；
// 风险 M1–M13 各有一个针对性的例子。

type Json = Record<string, any>;

const FIXTURES = readdirSync(join(__dirname, 'fixtures', 'v33'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  // coverage-*：别的测试为读派生数据手写的配置（v33 也不合法），不是 v33 代码存下来的。
  .filter((f) => !f.startsWith('coverage-'));

function expectValid(config: unknown) {
  const parsed = WorkspaceConfigSchema.safeParse(config);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  const valid = validateWorkspace(config as WorkspaceConfig, registry);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
}

/** 默认工作空间（v33）加上几张表、页面、快捷操作、提醒。 */
function v33(extra: Json): Json {
  const base = v33Fixture('default-zh') as Json;
  return {
    ...base,
    ...extra,
    collections: [...(base.collections as Json[]), ...(extra.collections ?? [])],
    pages: [...(base.pages as Json[]), ...(extra.pages ?? [])],
  };
}

const page = (id: string, components: Json[], more: Json = {}) => ({
  id,
  title: id,
  components,
  ...more,
});
const block = (config: WorkspaceConfig, pageId: string, id: string): Json =>
  allComponents(config.containers.pages.find((p) => p.id === pageId)!).find(
    (c) => c.id === id,
  ) as Json;

const TASKS = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'title', name: '标题', type: 'text' },
    { id: 'done', name: '完成', type: 'checkbox' },
    {
      id: 'status',
      name: '状态',
      type: 'choice',
      // 选项 ID 恰好叫 row（M5）。
      options: [
        { id: 'todo', label: '待办' },
        { id: 'row', label: '一行' },
      ],
    },
    { id: 'due', name: '截止', type: 'date' },
    { id: 'count', name: '次数', type: 'number' },
    { id: 'parent', name: '上级', type: 'link', collectionId: 'tasks' },
    { id: 'plan', name: '日程', type: 'schedule' },
  ],
};
const LOG = {
  id: 'log',
  name: '记录',
  fields: [
    { id: 'task', name: '任务', type: 'link', collectionId: 'tasks' },
    { id: 'when', name: '日期', type: 'date' },
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
  ],
};

describe('v33 fixtures migrate to valid v34 configs', () => {
  it.each(FIXTURES)('%s', (name) => {
    const result = migrateWorkspace(v33Fixture(name));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.config as Json).schemaVersion).toBe(34);
    expectValid(result.config);
  });

  it.each(FIXTURES)('%s keeps every id (tables, fields, pages, blocks, quick actions)', (name) => {
    // M2、M10：桌面小组件、运行记录、通知按 ID 找；ID 一律不改（提醒只在撞号时改，M1）。
    const raw = v33Fixture(name) as Json;
    const after = fromV33(raw);
    const blockIds = (comps: Json[]): string[] =>
      comps.flatMap((c) => [c.id, ...blockIds(c.children ?? [])]);
    for (const p of raw.pages as Json[]) {
      const migrated = after.containers.pages.find((x) => x.id === p.id)!;
      expect(allComponents(migrated).map((c) => c.id)).toEqual(blockIds(p.components));
    }
    expect(after.data.tables.map((t) => [t.id, t.fields.map((f) => f.id)])).toEqual(
      (raw.collections as Json[]).map((t) => [t.id, (t.fields as Json[]).map((f) => f.id)]),
    );
    expect(after.tools.filter((t) => t.kind === 'quickAction').map((t) => t.id)).toEqual(
      (raw.workflows as Json[]).map((w) => w.id),
    );
    expect(after.packages.map((p) => p.id)).toEqual((raw.tools as Json[]).map((t) => t.toolId));
  });
});

describe('v34 scope fixtures (templates-v34 without a v33 counterpart)', () => {
  it.each(['habits', 'calendar', 'tasks', 'todo'])('%s validates', (name) => {
    const config = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'v34', `${name}.json`), 'utf8'),
    ) as unknown;
    expectValid(config);
  });
});

describe('v33 → v34 risks', () => {
  it('M1: a reminder whose id a quick action uses gets a new id; the quick action keeps its own', () => {
    const daily = (id: string) => ({
      id,
      title: '提醒',
      enabled: true,
      schedule: 'daily',
      time: '09:00',
      opens: 'workflow:same',
    });
    const config = fromV33(
      v33({
        workflows: [
          {
            id: 'same',
            name: '合并',
            homeScreen: true,
            steps: [{ id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } }],
          },
        ],
        reminders: [daily('same'), daily('same-reminder'), daily('other')],
      }),
    );
    expect(config.tools.map((t) => [t.kind, t.id])).toEqual([
      ['quickAction', 'same'],
      ['reminder', 'same-reminder'],
      // 改出来的 ID 和后面原有的撞了，原有的那个再换。
      ['reminder', 'same-reminder-reminder'],
      ['reminder', 'other'],
    ]);
    // 快捷操作的引用不跟着动：打开它的提醒、手机桌面菜单。
    expect(config.tools[1]).toMatchObject({
      opens: 'tool:same',
      when: { every: 'day', at: '09:00' },
    });
    expect(config.nav.phoneHomeScreen).toEqual(['same']);
    expectValid(config);
  });

  it('M3: a rollup with 5 filters and a period gets 6 conditions, the period last', () => {
    const conditions = Array.from({ length: 5 }, () => ({
      field: 'amount',
      op: 'gt',
      value: 1,
    }));
    const rollup = (id: string, extra: Json) => ({
      id,
      name: id,
      type: 'rollup',
      collectionId: 'log',
      linkField: 'task',
      aggregate: 'sum',
      fieldId: 'amount',
      ...extra,
    });
    const config = fromV33(
      v33({
        collections: [
          {
            ...TASKS,
            fields: [
              ...TASKS.fields,
              rollup('month', { filter: conditions, period: 'thisMonth' }),
              rollup('picked', { period: 'thisWeek', dateField: 'createdAt' }),
            ],
          },
          LOG,
        ],
      }),
    );
    const fields = config.data.tables[0]!.fields as Json[];
    const month = fields.find((f) => f.id === 'month')!;
    expect(month.filter).toHaveLength(6);
    // 没写 dateField：第一个日期字段（related.ts 的 rollupDate）。
    expect(month.filter.at(-1)).toEqual({ field: 'when', op: 'inPeriod', value: 'thisMonth' });
    expect(month).not.toHaveProperty('period');
    expect(fields.find((f) => f.id === 'picked')).toMatchObject({
      table: 'log',
      via: 'task',
      field: 'amount',
      filter: [{ field: 'createdAt', op: 'inPeriod', value: 'thisWeek' }],
      days: { date: 'createdAt' },
    });
    expectValid(config);
  });

  it('M3: a rollup period on a table without a date field counts by the creation time', () => {
    const config = fromV33(
      v33({
        collections: [
          { id: 'a', name: 'A', fields: [{ id: 'name', name: 'N', type: 'text' }] },
          {
            id: 'b',
            name: 'B',
            fields: [
              { id: 'a', name: 'A', type: 'link', collectionId: 'a' },
              {
                id: 'n',
                name: 'N',
                type: 'rollup',
                collectionId: 'b',
                linkField: 'a',
                aggregate: 'count',
                period: 'today',
              },
            ],
          },
        ],
      }),
    );
    expect(config.data.tables[1]!.fields[1]).toMatchObject({
      filter: [{ field: 'createdAt', op: 'inPeriod', value: 'today' }],
    });
  });

  it('M4 / Q6: an add button (recordForm mode button) keeps its preset values, and now fills them in', () => {
    const config = fromV33(
      v33({
        collections: [TASKS],
        pages: [
          page('p', [
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: 'tasks',
                mode: 'button',
                submitLabel: '添加',
                fieldIds: ['title'],
                values: { status: 'row', parent: 'row' },
              },
            },
          ]),
        ],
      }),
    );
    expect(block(config, 'p', 'add')).toEqual({
      id: 'add',
      look: 'button',
      show: { label: '添加', variant: 'filled' },
      // fieldIds 在按钮模式下本来就不起作用（打开完整表单），丢掉。
      tools: [
        {
          do: 'create',
          table: 'tasks',
          ask: 'all',
          // M5：引用字段上的 row 是「这一行」，单选的 row 是一个选项。
          values: { status: 'row', parent: '$row' },
        },
      ],
    });
  });

  it('M5: "row" becomes "$row" only on link fields (row actions, button actions, reminder done)', () => {
    const config = fromV33(
      v33({
        collections: [TASKS, LOG],
        pages: [
          page('p', [
            {
              id: 'list',
              type: 'recordList',
              props: {
                collectionId: 'tasks',
                display: 'list',
                titleField: 'title',
                limit: 50,
                rowActions: [
                  { do: 'set', fieldId: 'status', value: 'row', label: '设成 row' },
                  { do: 'create', collectionId: 'log', values: { task: 'row' }, label: '记一笔' },
                  { do: 'open', label: '打开' },
                ],
              },
            },
          ]),
        ],
        reminders: [
          {
            id: 'due',
            title: '到期',
            enabled: true,
            schedule: 'scheduleField',
            collectionId: 'tasks',
            fieldId: 'plan',
            time: '08:00',
            opens: 'page:p',
            done: { do: 'create', collectionId: 'log', values: { task: 'row' } },
            snoozeMinutes: 15,
            unless: { collectionId: 'log', within: 'day', dateField: 'when', link: 'task' },
          },
        ],
      }),
    );
    expect(block(config, 'p', 'list').tools).toEqual([
      { as: 'button', label: '设成 row', do: 'set', table: 'tasks', field: 'status', value: 'row' },
      { as: 'button', label: '记一笔', do: 'create', table: 'log', values: { task: '$row' } },
      { as: 'button', label: '打开', opens: 'record' },
    ]);
    expect(config.tools.find((t) => t.id === 'due')).toEqual({
      id: 'due',
      kind: 'reminder',
      title: '到期',
      enabled: true,
      when: { each: { table: 'tasks', field: 'plan' }, at: '08:00' },
      opens: 'page:p',
      done: { do: 'create', table: 'log', values: { task: '$row' } },
      snoozeMinutes: 15,
      unless: { table: 'log', within: 'day', date: 'when', link: 'task' },
    });
    expectValid(config);
  });

  it('M6: default date fields stay unwritten (charts, numbers, month lists, rollups)', () => {
    const config = fromV33(
      v33({
        collections: [TASKS, LOG],
        pages: [
          page('p', [
            {
              id: 'chart',
              type: 'chart',
              props: {
                collectionId: 'log',
                kind: 'bar',
                title: '每周',
                aggregate: 'sum',
                fieldId: 'amount',
                group: 'week',
                periods: 8,
              },
            },
            {
              id: 'streak',
              type: 'stat',
              props: { collectionId: 'log', aggregate: 'streak', label: '连续' },
            },
            {
              id: 'month',
              type: 'recordList',
              props: { collectionId: 'log', display: 'calendar', titleField: 'amount', limit: 50 },
            },
          ]),
        ],
      }),
    );
    expect(block(config, 'p', 'chart').source).toEqual({
      table: 'log',
      aggregate: 'sum',
      field: 'amount',
      group: { unit: 'week', last: 8 },
    });
    expect(block(config, 'p', 'streak').source).toEqual({ table: 'log', aggregate: 'streak' });
    expect(block(config, 'p', 'month').source).toEqual({
      table: 'log',
      limit: 50,
      group: { unit: 'day' },
    });
    expectValid(config);
  });

  it('M7: the "Add tools" link becomes an entry with an accent title', () => {
    const config = fromV33(v33Fixture('default-zh'));
    expect(block(config, 'home', 'catalog')).toEqual({
      id: 'catalog',
      look: 'entry',
      show: { title: '添加工具', icon: 'plus', shape: 'tile', accent: true },
      opens: 'tools',
    });
  });

  it('M8: an unknown component is kept raw, also inside a group', () => {
    const future = { id: 'future', type: 'hologram', props: { x: 1 } };
    const config = fromV33(
      v33({
        pages: [
          page('p', [
            future,
            {
              id: 'g',
              type: 'group',
              props: { layout: 'stack' },
              children: [{ ...future, id: 'inner', hidden: true }],
            },
          ]),
        ],
      }),
    );
    expect(block(config, 'p', 'future')).toEqual({ id: 'future', look: '$unknown', raw: future });
    expect(block(config, 'p', 'inner')).toEqual({
      id: 'inner',
      look: '$unknown',
      hidden: true,
      raw: { ...future, id: 'inner', hidden: true },
    });
  });

  it('record lists: check, drag, tap and add-here become tools on the block', () => {
    const list = (id: string, props: Json) => ({
      id,
      type: 'recordList',
      props: { collectionId: 'tasks', titleField: 'title', ...props },
    });
    const config = fromV33(
      v33({
        collections: [TASKS],
        pages: [
          page('p', [
            list('check', { display: 'checklist', checkField: 'done', addHere: true }),
            // 非 checklist 上的 checkField 渲染器不用，丢掉。
            list('plain', {
              display: 'list',
              checkField: 'done',
              groupBy: 'due',
              groupUnit: 'week',
            }),
            list('board', {
              display: 'board',
              groupField: 'status',
              groupFilter: [{ field: 'title', op: 'isNotEmpty' }],
              showEmpty: true,
            }),
            list('tiles', {
              display: 'tiles',
              rowActions: [{ do: 'increment', fieldId: 'count', by: 1 }],
              opens: 'p',
            }),
          ]),
        ],
      }),
    );
    expect(block(config, 'p', 'check').tools).toEqual([
      { as: 'check', do: 'toggle', table: 'tasks', field: 'done' },
      { as: 'addHere', do: 'create', table: 'tasks', ask: 'all', values: '$here' },
    ]);
    expect(block(config, 'p', 'plain')).toEqual({
      id: 'plain',
      look: 'list',
      source: { table: 'tasks', group: { by: 'due', unit: 'week' } },
      show: { title: 'title' },
    });
    expect(block(config, 'p', 'board')).toMatchObject({
      source: {
        table: 'tasks',
        group: { by: 'status', filter: [{ field: 'title', op: 'isNotEmpty' }] },
      },
      tools: [{ as: 'drag', do: 'set', table: 'tasks', field: 'status', value: '$group' }],
    });
    expect(block(config, 'p', 'tiles')).toMatchObject({
      tools: [{ as: 'tap', do: 'increment', table: 'tasks', field: 'count', by: 1 }],
      opens: 'p',
    });
  });

  it('quick actions, the phone home screen, buttons and the desk toolbar point at tools', () => {
    const merge = {
      id: 'merge',
      name: '合并',
      toolId: undefined,
      presetId: 'merge-pdf',
      steps: [{ id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } }],
    };
    const config = fromV33(
      v33({
        workflows: [
          { ...merge, homeScreen: true },
          { ...merge, id: 'second', presetId: undefined },
          { ...merge, id: 'third', homeScreen: true },
        ],
        pages: [
          page('p', [
            { id: 'open', type: 'button', props: { label: '打开', target: 'workflow:second' } },
            { id: 'run', type: 'workflowRunner', props: { workflowId: 'merge', look: 'card' } },
          ]),
        ],
        desk: {
          toolbar: 'top',
          above: [{ id: 'note', type: 'notice', props: { text: '提示' } }],
          tools: { pdf: [{ items: [{ workflowId: 'merge' }, { action: 'pdf.compress' }] }] },
        },
      }),
    );
    expect(config.tools[0]).toEqual({
      id: 'merge',
      kind: 'quickAction',
      name: '合并',
      preset: 'merge-pdf',
      steps: merge.steps,
    });
    // 放到手机桌面的按原 workflows 的顺序。
    expect(config.nav.phoneHomeScreen).toEqual(['merge', 'third']);
    expect(block(config, 'p', 'open')).toEqual({
      id: 'open',
      look: 'button',
      show: { label: '打开' },
      opens: 'tool:second',
    });
    expect(block(config, 'p', 'run')).toEqual({
      id: 'run',
      look: 'action',
      show: { shape: 'card' },
      tools: [{ tool: 'merge' }],
    });
    expect(config.containers.desk).toEqual({
      toolbar: 'top',
      above: [{ id: 'note', look: 'notice', show: { text: '提示' } }],
      tools: { pdf: [{ items: ['merge', { action: 'pdf.compress' }] }] },
    });
  });

  it('file lists read $files by kind; file slots and tool cards become entries', () => {
    const config = fromV33(
      v33({
        pages: [
          page('p', [
            {
              id: 'pdfs',
              type: 'fileList',
              props: { title: 'PDF', limit: 10, mimeType: 'application/pdf' },
            },
            {
              id: 'pics',
              type: 'fileList',
              props: { title: '图片', limit: 5, mimeType: 'image/*' },
            },
            {
              id: 'slot',
              type: 'fileSlot',
              props: { title: '护照', hint: '点一下选', look: 'tile' },
            },
            { id: 'pick', type: 'filePick', props: { source: 'files' } },
          ]),
        ],
      }),
    );
    expect(block(config, 'p', 'pdfs').source).toEqual({
      table: '$files',
      filter: [{ field: 'kind', op: 'is', value: 'pdf' }],
      limit: 10,
    });
    expect(block(config, 'p', 'pics').source.filter).toEqual([
      { field: 'kind', op: 'is', value: 'image' },
    ]);
    expect(block(config, 'p', 'slot')).toEqual({
      id: 'slot',
      look: 'entry',
      show: { title: '护照', hint: '点一下选', shape: 'tile' },
      opens: { file: null },
    });
    expect(block(config, 'p', 'pick').tools).toEqual([{ tool: '$pick.files' }]);
    expectValid(config);
  });

  it('numbers keep minus, goal, compare and the day settings', () => {
    const config = fromV33(
      v33({
        collections: [TASKS, LOG],
        pages: [
          page('p', [
            {
              id: 'left',
              type: 'stat',
              props: {
                collectionId: 'log',
                aggregate: 'sum',
                fieldId: 'amount',
                label: '剩余',
                groupBy: 'task',
                goal: 100,
                minus: { collectionId: 'log', aggregate: 'count', filter: [] },
              },
            },
            {
              id: 'streak',
              type: 'stat',
              props: {
                collectionId: 'log',
                aggregate: 'streak',
                label: '连续',
                dateField: 'when',
                unit: 'week',
                perUnit: 3,
                compare: 'previous',
              },
            },
          ]),
        ],
      }),
    );
    expect(block(config, 'p', 'left').source).toEqual({
      table: 'log',
      aggregate: 'sum',
      field: 'amount',
      group: { by: 'task' },
      goal: 100,
      minus: { table: 'log', aggregate: 'count', filter: [] },
    });
    expect(block(config, 'p', 'streak').source).toEqual({
      table: 'log',
      aggregate: 'streak',
      days: { date: 'when', unit: 'week', perUnit: 3 },
      compare: 'previous',
    });
  });
});
