import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createDefaultWorkspace } from './defaults';
import { prepareOps } from './change';
import { SAMPLE_APPS, sampleOps } from './samples';
import { createStarterWorkspace } from './starter';
import { checkRequestParams, checkTools, tableIsShown, type ToolCheckResult } from './tool-check';
import type { Collection, Component, QuickAction, Reminder, WorkspaceConfig } from './schema';
import { registry } from './test-helpers';
import { WORKFLOW_PRESETS, presetWorkflow } from './workflows/presets';

// 工具检查：断言写「应该怎样」。用的例子都是两轮测试里真实发生过的（AGENT_PLAN §2、REPORT2）。
// 配置直接拼，不过校验器：有些例子（目标表没有附件字段）校验器本来就拒绝，这里要看检查自己认不认得。

const text = (id: string, required = false) =>
  ({
    id,
    name: id,
    type: 'text',
    ...(required ? { required } : {}),
  }) as Collection['fields'][number];
const number = (id: string) => ({ id, name: id, type: 'number' }) as Collection['fields'][number];
const table = (id: string, fields: Collection['fields'], name = id): Collection => ({
  id,
  name,
  fields,
});

const list = (id: string, tableId: string, extra: object = {}) =>
  ({
    id,
    look: 'list',
    source: { table: tableId, limit: 30 },
    show: { title: 'title' },
    ...extra,
  }) as unknown as Component;
const addButton = (id: string, tableId: string) =>
  ({
    id,
    look: 'button',
    show: { label: 'Add', variant: 'filled' },
    tools: [{ do: 'create', table: tableId, ask: 'all' }],
  }) as unknown as Component;
const form = (id: string, tableId: string, ask: string[], values?: object) =>
  ({
    id,
    look: 'form',
    show: { mode: 'inline' },
    tools: [
      {
        as: 'submit',
        label: 'Save',
        do: 'create',
        table: tableId,
        ask,
        ...(values ? { values } : {}),
      },
    ],
  }) as unknown as Component;
const stat = (id: string, tableId: string) =>
  ({
    id,
    look: 'number',
    show: { label: 'Total' },
    source: { table: tableId, aggregate: 'count' },
  }) as unknown as Component;
const entry = (id: string, opens: string) =>
  ({ id, look: 'entry', show: { title: id, icon: 'document' }, opens }) as unknown as Component;
const action = (id: string, tool: string) =>
  ({ id, look: 'action', tools: [{ tool }] }) as unknown as Component;

const quick = (id: string, steps: [string, object, (string[] | undefined)?][]): QuickAction => ({
  id,
  kind: 'quickAction',
  name: id,
  steps: steps.map(([a, params, ask], i) => ({
    id: `s${i}`,
    action: a,
    params: params as Record<string, unknown>,
    ...(ask ? { ask } : {}),
  })),
});

function workspace(parts: {
  tables?: Collection[];
  home?: Component[];
  pages?: { id: string; blocks: Component[]; of?: string }[];
  tools?: (QuickAction | Reminder)[];
}): WorkspaceConfig {
  const config = createDefaultWorkspace('en');
  config.data.tables = parts.tables ?? [];
  config.containers.pages[0]!.blocks.push(...(parts.home ?? []));
  for (const p of parts.pages ?? []) config.containers.pages.push({ title: p.id, ...p });
  config.tools = parts.tools ?? [];
  return config;
}

const check = (config: WorkspaceConfig) => checkTools(config, registry);
const codes = (r: ToolCheckResult, severity?: 'blocker' | 'warning') =>
  r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const tool = (r: ToolCheckResult, id: string) => r.tools.find((t) => t.id === id)!;
/** 一张能用的表：首页上有添加按钮和列表。 */
const usable = (id: string) => [addButton(`add-${id}`, id), list(`list-${id}`, id)];

describe('tableIsShown', () => {
  const tables = [table('t', [text('title')])];

  it('没有块读：看不到', () => {
    expect(tableIsShown(workspace({ tables, pages: [] }), 't', registry)).toBe(false);
  });

  it('到得了的页面上有块读：看得到', () => {
    const config = workspace({ tables, pages: [{ id: 'ledger', blocks: usable('t') }] });
    const shown = {
      ...config,
      nav: { ...config.nav, bar: [...config.nav.bar, 'page:ledger' as const] },
    };
    expect(tableIsShown(shown, 't', registry)).toBe(true);
  });

  it('块在打不开的页面上：还是看不到', () => {
    const config = workspace({ tables, pages: [{ id: 'ledger', blocks: usable('t') }] });
    expect(tableIsShown(config, 't', registry)).toBe(false);
  });
});

describe('文件工具', () => {
  const chain = quick('send', [
    ['in.photos', { source: 'library', min: 1, max: 5 }],
    ['image.compress', { maxKB: 500, format: 'jpeg' }],
    ['out.share', {}],
  ]);

  it('链通、参数齐、摆在页面上：能用，没有问题', () => {
    const r = check(workspace({ tools: [chain], home: [action('run', 'send')] }));
    expect(r.issues).toEqual([]);
    expect(tool(r, 'send')).toMatchObject({ kind: 'file', ok: true });
    expect(tool(r, 'send').checks).toMatchObject({ chain: true, params: true, entry: 'placed' });
  });

  it('输入动作不在第一步：用不了', () => {
    // 第一步收文件的快捷操作由记录的附件字段交文件（D-442）；输入动作只能放在第一步。
    const wf = quick('bad', [
      ['image.compress', { maxKB: 500, format: 'jpeg' }],
      ['in.photos', { source: 'library', min: 1, max: 5 }],
    ]);
    const r = check(workspace({ tools: [wf], home: [action('run', 'bad')] }));
    expect(codes(r, 'blocker')).toContain('step-source');
    expect(tool(r, 'bad').ok).toBe(false);
  });

  it('相邻步骤类型接不上：用不了', () => {
    const wf = quick('bad', [
      ['in.videos', { source: 'library', min: 1, max: 1 }],
      ['image.compress', { maxKB: 500, format: 'jpeg' }],
    ]);
    expect(codes(check(workspace({ tools: [wf] })), 'blocker')).toContain('step-binding');
  });

  it('必填参数缺了：用不了', () => {
    const wf = quick('bad', [
      ['in.photos', { source: 'library', min: 1, max: 5 }],
      ['image.compress', {}],
    ]);
    expect(codes(check(workspace({ tools: [wf] })), 'blocker')).toContain('step-params');
  });

  it('只在「设置 → 快捷操作」里：到得了，所以只提醒', () => {
    const r = check(workspace({ tools: [chain] }));
    expect(codes(r)).toEqual(['no-entry']);
    expect(r.issues[0]!.severity).toBe('warning');
    expect(tool(r, 'send')).toMatchObject({ ok: true });
    expect(tool(r, 'send').checks).toMatchObject({ entry: 'settings' });
  });

  it.each([
    ['入口块', { home: [entry('go', 'tool:send')] }, {}],
    [
      '快捷操作库块',
      {
        home: [
          { id: 'l', look: 'library', source: { catalog: 'quickActions' } } as unknown as Component,
        ],
      },
      {},
    ],
    ['手机桌面', {}, { phoneHomeScreen: ['send'] }],
  ])('%s也算入口', (_name, parts, nav) => {
    const config = workspace({ tools: [chain], ...parts });
    Object.assign(config.nav, nav);
    expect(codes(check(config))).toEqual([]);
  });

  it('从预设添加的快捷操作在预设库里，不算没入口', () => {
    const r = check(workspace({ tools: [{ ...chain, preset: 'email-photos' }] }));
    expect(codes(r)).toEqual([]);
  });

  it('入口在进不去的页面上不算', () => {
    const config = workspace({
      tools: [chain],
      pages: [{ id: 'lost', blocks: [action('run', 'send')] }],
    });
    expect(codes(check(config))).toEqual(expect.arrayContaining(['no-entry', 'page-unreachable']));
  });
});

describe('记录工具：4 个问题', () => {
  it('有添加、有列表：能用', () => {
    const r = check(
      workspace({ tables: [table('tasks', [text('title', true)])], home: usable('tasks') }),
    );
    expect(r.issues).toEqual([]);
    expect(tool(r, 'tasks')).toMatchObject({ kind: 'record', ok: true });
    expect(tool(r, 'tasks').checks).toMatchObject({
      where: true,
      add: true,
      view: true,
      remind: null,
    });
  });

  it('按钮写 A 表、统计读 B 表：两边都用不了，还提醒是同一个用途', () => {
    const fields = [text('title'), number('amount')];
    const r = check(
      workspace({
        tables: [table('expenses', fields, 'Expenses'), table('spending', fields, 'Spending')],
        home: [addButton('add', 'expenses'), stat('total', 'spending')],
      }),
    );
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'view-missing', target: 'table:expenses' }),
        expect.objectContaining({ code: 'add-missing', target: 'table:spending' }),
        expect.objectContaining({ code: 'duplicate-table', severity: 'warning' }),
      ]),
    );
  });

  it('两张不相干的表各写各读，不报重复', () => {
    const r = check(
      workspace({
        tables: [
          table('tasks', [text('title'), text('owner')], 'Tasks'),
          table('books', [text('author'), number('pages')], 'Books'),
        ],
        home: [addButton('add', 'tasks'), stat('total', 'books')],
      }),
    );
    expect(codes(r)).not.toContain('duplicate-table');
  });

  it('两张相近的表都有写有读（各自能用），不报重复', () => {
    const fields = [text('title'), number('amount')];
    const r = check(
      workspace({
        tables: [table('a', fields, 'Spending 2025'), table('b', fields, 'Spending 2026')],
        home: [...usable('a'), ...usable('b')],
      }),
    );
    expect(codes(r)).not.toContain('duplicate-table');
  });

  it('表单漏必填字段：永远存不进去', () => {
    const r = check(
      workspace({
        tables: [table('t', [text('title', true), text('amount', true)])],
        home: [form('f', 't', ['title']), list('l', 't')],
      }),
    );
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'add-missing-required', severity: 'blocker' }),
      ]),
    );
    expect(tool(r, 't').ok).toBe(false);
    expect(tool(r, 't').checks).toMatchObject({ add: false });
  });

  it('必填字段有默认值、有预设值，或者打开完整表单：不算漏', () => {
    const withDefault = { ...text('b', true), default: 'x' } as Collection['fields'][number];
    const choice = {
      id: 'kind',
      name: 'kind',
      type: 'choice',
      required: true,
      options: [{ id: 'a', label: 'A' }],
    } as Collection['fields'][number];
    const r = check(
      workspace({
        tables: [table('t', [text('title', true), withDefault, choice])],
        home: [form('f', 't', ['title'], { kind: 'a' }), addButton('add', 't'), list('l', 't')],
      }),
    );
    expect(codes(r, 'blocker')).toEqual([]);
  });

  it('什么都不能添加：用不了', () => {
    const r = check(workspace({ tables: [table('t', [text('title')])], home: [list('l', 't')] }));
    expect(codes(r, 'blocker')).toEqual(['add-missing']);
  });

  it('「设置 → 数据」不算添加的入口（它只能导出、恢复），看不到记录的表也不能靠它', () => {
    const r = check(
      workspace({ tables: [table('t', [text('title')])], home: [addButton('a', 't')] }),
    );
    expect(codes(r, 'blocker')).toEqual(['view-missing']);
  });

  it('只有每一条上的「新建」：第一条加不进去', () => {
    const rowAdd = list('l', 't', {
      tools: [{ as: 'button', label: 'Add', do: 'create', table: 't', ask: 'all' }],
    });
    const r = check(workspace({ tables: [table('t', [text('title')])], home: [rowAdd] }));
    expect(codes(r, 'blocker')).toEqual(['add-needs-existing-row']);
  });

  it('另一张表每一条上的新建（$row）算添加的入口；就地添加也算', () => {
    const habits = table('habits', [text('title')]);
    const checkins = table('checkins', [
      { id: 'habit', name: 'habit', type: 'link', table: 'habits' } as Collection['fields'][number],
      { id: 'n', name: 'n', type: 'number' } as Collection['fields'][number],
    ]);
    const tiles = {
      id: 't',
      look: 'tiles',
      source: { table: 'habits', limit: 24 },
      show: { title: 'title' },
      tools: [
        { as: 'tap', label: 'Done', do: 'create', table: 'checkins', values: { habit: '$row' } },
      ],
    } as unknown as Component;
    const here = list('l', 'checkins', {
      show: { title: 'n' },
      tools: [{ as: 'addHere', do: 'create', table: 'checkins', ask: 'all' }],
    });
    const r = check(
      workspace({ tables: [habits, checkins], home: [addButton('a', 'habits'), tiles, here] }),
    );
    expect(codes(r, 'blocker')).toEqual([]);
  });

  it('有附件字段的表没有添加入口时，收件页面「存成记录」能加，只提醒', () => {
    const r = check(
      workspace({
        tables: [
          table('t', [
            text('title'),
            { id: 'file', name: 'file', type: 'file' } as Collection['fields'][number],
          ]),
        ],
        home: [list('l', 't')],
      }),
    );
    expect(codes(r, 'blocker')).toEqual([]);
    expect(codes(r)).toContain('add-only-from-inbox');
  });

  it('藏起来的块不算', () => {
    const hidden = { ...(list('l', 't') as object), hidden: true } as unknown as Component;
    const r = check(
      workspace({ tables: [table('t', [text('title')])], home: [addButton('a', 't'), hidden] }),
    );
    expect(codes(r, 'blocker')).toEqual(['view-missing']);
  });

  it('页面没入口：页面和它上面的工具都用不了', () => {
    const r = check(
      workspace({
        tables: [table('t', [text('title')])],
        pages: [{ id: 'ledger', blocks: usable('t') }],
      }),
    );
    expect(codes(r, 'blocker').sort()).toEqual([
      'add-unreachable',
      'page-unreachable',
      'view-unreachable',
    ]);
  });

  it('入口要从到得了的页面走到：只被另一个进不去的页面打开也不算', () => {
    const r = check(
      workspace({
        pages: [
          { id: 'a', blocks: [entry('to-b', 'page:b')] },
          { id: 'b', blocks: [entry('to-a', 'page:a')] },
        ],
      }),
    );
    expect(r.issues.filter((i) => i.code === 'page-unreachable')).toHaveLength(2);
  });

  it('页面有入口（首页的入口块、导航、记录块的 opens）：不报', () => {
    const config = workspace({
      tables: [table('t', [text('title')])],
      home: [entry('go', 'page:tasks'), addButton('a', 't')],
      pages: [
        { id: 'tasks', blocks: [list('l', 't', { opens: 'one' })] },
        { id: 'one', of: 't', blocks: [stat('n', 't')] },
        { id: 'bar', blocks: [stat('m', 't')] },
      ],
    });
    config.nav.bar = [...config.nav.bar.slice(0, 4), 'page:bar'];
    expect(codes(check(config), 'blocker')).toEqual([]);
  });

  it('工具包的页面在「设置 → 工具」里到得了，不报', () => {
    const config = workspace({ pages: [{ id: 'pdf', blocks: [action('r', 'x')] }] });
    config.containers.pages[1]!.package = 'pdf';
    expect(codes(check(config))).not.toContain('page-unreachable');
  });

  it('什么都没在用的表只提醒：可能是用户不要了、数据留着（底线 5）', () => {
    const r = check(workspace({ tables: [table('old', [text('title')])] }));
    expect(codes(r)).toEqual(['table-unused']);
    expect(r.issues[0]!.severity).toBe('warning');
    expect(tool(r, 'old').ok).toBe(false);
  });

  it('只靠引用字段显示的表（选项表）算看得到，但没人往里加还是用不了', () => {
    const r = check(
      workspace({
        tables: [
          table('rooms', [text('title')]),
          table('tasks', [
            text('title'),
            {
              id: 'room',
              name: 'room',
              type: 'link',
              table: 'rooms',
            } as Collection['fields'][number],
          ]),
        ],
        home: [form('f', 'tasks', ['title', 'room']), list('l', 'tasks')],
      }),
    );
    expect(r.issues).toEqual([
      expect.objectContaining({ code: 'add-missing', target: 'table:rooms', severity: 'blocker' }),
    ]);
  });
});

describe('记录工具：提醒', () => {
  const plants = table('plants', [
    text('title'),
    {
      id: 'water',
      name: 'water',
      type: 'schedule',
      default: { repeat: 'interval', every: 7 },
    } as unknown as Collection['fields'][number],
  ]);
  const reminder = (extra: Partial<Reminder>): Reminder => ({
    id: 'r',
    kind: 'reminder',
    title: 'Water',
    enabled: true,
    when: { each: { table: 'plants', field: 'water' }, at: '09:00' },
    opens: 'page:plants-page',
    ...extra,
  });
  const page = { id: 'plants-page', blocks: usable('plants') };

  it('打开的页面读这张表：能用', () => {
    const config = workspace({ tables: [plants], pages: [page], tools: [reminder({})] });
    config.nav.bar = [...config.nav.bar.slice(0, 4), 'page:plants-page'];
    const r = check(config);
    expect(codes(r, 'blocker')).toEqual([]);
    expect(tool(r, 'plants').checks).toMatchObject({ remind: true });
  });

  it('打开的页面上没有相关内容：用不了', () => {
    const r = check(
      workspace({
        tables: [plants],
        home: usable('plants').slice(0, 0),
        pages: [
          {
            id: 'other',
            blocks: [{ id: 'h', look: 'header', show: { title: 'x' } } as unknown as Component],
          },
          { id: 'plants-page', blocks: usable('plants') },
        ],
        tools: [reminder({ opens: 'page:other' })],
      }),
    );
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'reminder-opens-unrelated', severity: 'blocker' }),
      ]),
    );
    expect(tool(r, 'plants').checks).toMatchObject({ remind: false });
  });

  it('打开首页时不算用不了（规则 35 让新表的提醒先开首页）：只提醒', () => {
    const r = check(
      workspace({
        tables: [plants],
        home: [{ id: 'h', look: 'header', show: { title: 'x' } } as unknown as Component],
        pages: [{ id: 'plants-page', blocks: usable('plants') }],
        tools: [reminder({ opens: 'page:home' })],
      }),
    );
    expect(r.issues.filter((i) => i.code === 'reminder-opens-unrelated')).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
    expect(tool(r, 'plants').checks).not.toMatchObject({ remind: false });
  });

  it('打开的页面读相关的表（引用过去的）：算对', () => {
    const logs = table('logs', [
      text('title'),
      { id: 'plant', name: 'plant', type: 'link', table: 'plants' } as Collection['fields'][number],
    ]);
    const r = check(
      workspace({
        tables: [plants, logs],
        home: usable('plants'),
        pages: [{ id: 'log-page', blocks: usable('logs') }],
        tools: [reminder({ opens: 'page:log-page' })],
      }),
    );
    expect(codes(r)).not.toContain('reminder-opens-unrelated');
  });

  it('打开的页面只是通往那一页的入口：只提醒', () => {
    const r = check(
      workspace({
        tables: [plants],
        home: [entry('go', 'page:plants-page')],
        pages: [page],
        tools: [reminder({ opens: 'page:home' })],
      }),
    );
    expect(codes(r)).toContain('reminder-opens-indirect');
    expect(codes(r, 'blocker')).toEqual([]);
  });

  it('「完成」写一张表、「不再提醒」看另一张：点了完成还是响', () => {
    const r = check(
      workspace({
        tables: [plants, table('logs', [text('title')])],
        home: [...usable('plants'), ...usable('logs')],
        tools: [
          reminder({
            opens: 'page:home',
            done: { do: 'create', table: 'logs' },
            unless: { table: 'plants', within: 'day' },
          }),
        ],
      }),
    );
    expect(codes(r, 'blocker')).toContain('reminder-done-wrong-table');
  });

  it('「完成」和「不再提醒」是同一张表：不报', () => {
    const r = check(
      workspace({
        tables: [plants, table('logs', [text('title')])],
        home: [...usable('plants'), ...usable('logs')],
        tools: [
          reminder({
            opens: 'page:home',
            done: { do: 'create', table: 'logs' },
            unless: { table: 'logs', within: 'day' },
          }),
        ],
      }),
    );
    expect(codes(r)).not.toContain('reminder-done-wrong-table');
  });

  it('每天的提醒打开的页面什么都没有：只提醒', () => {
    const r = check(
      workspace({
        tools: [reminder({ when: { every: 'day', at: '09:00' }, opens: 'page:home' })],
      }),
    );
    expect(r.issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('文件进记录', () => {
  const scan = (target: string) =>
    quick('scan', [
      ['in.photos', { source: 'scanner', min: 1, max: 5 }],
      ['out.addRecord', { collectionId: target }],
    ]);
  const receipts = table('receipts', [
    text('title'),
    { id: 'file', name: 'file', type: 'file' } as Collection['fields'][number],
  ]);

  it('目标有附件字段、有入口、表能看：能用，算一个工具也算表的添加入口', () => {
    const r = check(
      workspace({
        tables: [receipts],
        home: [action('run', 'scan'), list('l', 'receipts')],
        tools: [scan('receipts')],
      }),
    );
    expect(r.issues).toEqual([]);
    expect(tool(r, 'scan')).toMatchObject({ kind: 'fileToRecord', ok: true });
    expect(tool(r, 'scan').checks).toMatchObject({ target: true, place: true, recordSide: true });
    expect(tool(r, 'receipts').checks).toMatchObject({ add: true });
  });

  it('目标没有附件字段：文件放不进去', () => {
    const r = check(
      workspace({
        tables: [table('receipts', [text('title')])],
        home: [action('run', 'scan'), list('l', 'receipts')],
        tools: [scan('receipts')],
      }),
    );
    expect(codes(r, 'blocker')).toContain('record-no-place');
    expect(tool(r, 'scan').ok).toBe(false);
  });

  it('给文字时要文字字段，不要附件字段', () => {
    const wf = quick('note', [
      ['in.text', { text: 'x' }],
      ['out.addRecord', { collectionId: 'notes' }],
    ]);
    const ok = check(
      workspace({
        tables: [table('notes', [text('title')])],
        home: [list('l', 'notes')],
        tools: [wf],
      }),
    );
    expect(codes(ok, 'blocker')).toEqual([]);
    const bad = check(
      workspace({
        tables: [table('notes', [number('title')])],
        home: [list('l', 'notes', { show: { title: 'title' } })],
        tools: [wf],
      }),
    );
    expect(codes(bad, 'blocker')).toContain('record-no-place');
  });

  it('目标表不存在：用不了', () => {
    const r = check(workspace({ home: [action('run', 'scan')], tools: [scan('gone')] }));
    expect(codes(r, 'blocker')).toContain('step-table-missing');
    expect(tool(r, 'scan').checks).toMatchObject({ target: false });
  });

  it('表没有任何块读：文件进去了看不到，这个工具也不算完整', () => {
    const r = check(
      workspace({ tables: [receipts], home: [action('run', 'scan')], tools: [scan('receipts')] }),
    );
    expect(codes(r, 'blocker')).toContain('view-missing');
    expect(tool(r, 'scan').ok).toBe(false);
    expect(tool(r, 'scan').checks).toMatchObject({ recordSide: false });
  });
});

describe('字段', () => {
  it('既不显示、表单也不问、也没被引用：提醒', () => {
    const r = check(
      workspace({
        tables: [table('t', [text('title'), text('phone')])],
        home: [form('f', 't', ['title']), list('l', 't')],
      }),
    );
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'field-unused',
        target: 'field:t.phone',
        severity: 'warning',
      }),
    ]);
  });

  it.each([
    [
      '显示在副标题',
      [
        form('f', 't', ['title']),
        list('l', 't', { show: { title: 'title', subtitles: ['phone'] } }),
      ],
    ],
    ['表单问了', [form('f', 't', ['title', 'phone']), list('l', 't')]],
    ['完整表单问了', [addButton('a', 't'), list('l', 't')]],
    [
      '筛选用了',
      [
        form('f', 't', ['title']),
        list('l', 't', {
          source: { table: 't', limit: 9, filter: [{ field: 'phone', op: 'isNotEmpty' }] },
        }),
      ],
    ],
  ])('%s：不算没用', (_name, blocks) => {
    const r = check(
      workspace({
        tables: [table('t', [text('title'), text('phone')])],
        home: blocks as Component[],
      }),
    );
    expect(codes(r)).not.toContain('field-unused');
  });

  it('被公式、汇总、查找引用的字段不算没用', () => {
    const r = check(
      workspace({
        tables: [
          table('parents', [
            text('title'),
            { id: 'budget', name: 'budget', type: 'number' } as Collection['fields'][number],
            {
              id: 'total',
              name: 'total',
              type: 'rollup',
              table: 'kids',
              via: 'parent',
              aggregate: 'sum',
              field: 'amount',
            } as Collection['fields'][number],
          ]),
          table('kids', [
            text('title'),
            {
              id: 'parent',
              name: 'parent',
              type: 'link',
              table: 'parents',
            } as Collection['fields'][number],
            number('amount'),
            number('qty'),
            {
              id: 'double',
              name: 'double',
              type: 'formula',
              expression: '{qty} * 2',
            } as Collection['fields'][number],
            {
              id: 'pb',
              name: 'pb',
              type: 'lookup',
              via: 'parent',
              field: 'budget',
            } as Collection['fields'][number],
          ]),
        ],
        home: [
          ...usable('parents').slice(1),
          form('fp', 'parents', ['title']),
          list('p2', 'parents', { show: { title: 'title', trailing: 'total' } }),
          form('fk', 'kids', ['title', 'parent', 'amount', 'qty']),
          list('k', 'kids', { show: { title: 'title', subtitles: ['double', 'pb'] } }),
        ],
      }),
    );
    expect(r.issues.filter((i) => i.code === 'field-unused').map((i) => i.target)).toEqual([]);
  });

  it('被日程字段当作「上次完成」的字段不算没用', () => {
    const r = check(
      workspace({
        tables: [
          table('t', [
            text('title'),
            {
              id: 'next',
              name: 'next',
              type: 'schedule',
              default: { repeat: 'interval', every: 7 },
              lastDone: 'last',
            } as unknown as Collection['fields'][number],
            { id: 'last', name: 'last', type: 'date' } as Collection['fields'][number],
          ]),
        ],
        home: [form('f', 't', ['title', 'next']), list('l', 't')],
      }),
    );
    expect(codes(r)).not.toContain('field-unused');
  });

  it('计算值依赖的字段没有入口：提醒', () => {
    const tiles = {
      id: 't',
      look: 'tiles',
      source: { table: 't', limit: 9 },
      show: { title: 'title', trailing: 'double' },
      tools: [{ as: 'tap', label: 'x', do: 'create', table: 't' }],
    } as unknown as Component;
    const r = check(
      workspace({
        tables: [
          table('t', [
            text('title'),
            number('qty'),
            {
              id: 'double',
              name: 'double',
              type: 'formula',
              expression: '{qty} * 2',
            } as Collection['fields'][number],
          ]),
        ],
        home: [form('f', 't', ['title']), tiles],
      }),
    );
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'computed-input-missing', severity: 'warning' }),
      ]),
    );
  });

  it('依赖的字段能在点开一条的编辑页里填：不提醒', () => {
    const r = check(
      workspace({
        tables: [
          table('t', [
            text('title'),
            number('qty'),
            {
              id: 'double',
              name: 'double',
              type: 'formula',
              expression: '{qty} * 2',
            } as Collection['fields'][number],
          ]),
        ],
        home: [
          form('f', 't', ['title']),
          list('l', 't', { show: { title: 'title', trailing: 'double' } }),
        ],
      }),
    );
    expect(codes(r)).not.toContain('computed-input-missing');
  });
});

describe('真实内容上没有误报（目标：样板和预设 blocker 为 0）', () => {
  it.each(['en', 'zh', 'fr'] as const)('全部样板（%s）', (locale) => {
    for (const sample of SAMPLE_APPS) {
      const base = createStarterWorkspace(locale, registry);
      const ops = sampleOps(sample, base, locale);
      if (!ops.ok) throw new Error(ops.message);
      const prepared = prepareOps(base, ops.ops, { registry, locale, now: new Date(0) });
      if (!prepared.ok) throw new Error(prepared.issues.join('; '));
      expect(codes(check(prepared.after), 'blocker')).toEqual([]);
    }
  });

  it('全部预设', () => {
    for (const preset of WORKFLOW_PRESETS) {
      const config = createDefaultWorkspace('en');
      config.tools = [presetWorkflow(preset, 'en', preset.id)];
      expect(check(config).issues).toEqual([]);
    }
  });

  it('只读，不改配置（底线 15）', () => {
    const config = workspace({ tables: [table('t', [text('title')])], home: usable('t') });
    const before = JSON.stringify(config);
    check(config);
    checkRequestParams('2MB', 'en', config, config);
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe('用户说的数和词落到参数上', () => {
  const compress = (params: object, ask?: string[]) =>
    quick('c', [
      ['in.photos', { source: 'library', min: 1, max: 5 }],
      ['image.compress', { format: 'jpeg', ...params }, ask],
    ]);
  const pdf = (maxMB: number) =>
    quick('p', [
      ['in.photos', { source: 'library', min: 1, max: 5 }],
      [
        'pdf.fromImages',
        { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB },
      ],
    ]);
  const with_ = (...tools: QuickAction[]) => workspace({ tools });
  const empty = workspace({});
  const run = (input: string, locale: 'en' | 'zh' | 'fr', after: WorkspaceConfig, before = empty) =>
    checkRequestParams(input, locale, before, after).map((i) => i.code);

  describe('大小', () => {
    it('「固定 2MB」只清了 ask、值还是旧的：要报', () => {
      const before = with_(pdf(4));
      const after = with_(pdf(4));
      after.tools[0] = { ...(after.tools[0] as QuickAction) };
      (after.tools[0] as QuickAction).steps[1]!.ask = [];
      expect(run('固定 2MB，不用每次问', 'zh', after, before)).toEqual(['param-size']);
    });

    it('「固定 2MB」写进了 maxMB：不报', () => {
      expect(run('固定 2MB，不用每次问', 'zh', with_(pdf(2)), with_(pdf(4)))).toEqual([]);
    });

    it.each([
      ['压到 2048KB 换算：2MB', '压到 2MB', compress({ maxKB: 2048 })],
      ['1000 进制也认', 'compress to 2MB', compress({ maxKB: 2000 })],
      ['兆', '压到两兆', compress({ maxKB: 2048 })],
      ['2M', '压到2M', pdf(2)],
      ['Ko', 'compresser à 500 Ko', compress({ maxKB: 500 })],
      ['1 Mo = 1024 Ko', 'compresser à 1 Mo', compress({ maxKB: 1024 })],
      [
        '不超过 1 MB 写小一点也对',
        'il faut moins de 1 Mo par pièce jointe',
        compress({ maxKB: 900 }),
      ],
      ['两个数只要对上一个', '500MB 的文件压到 2MB', pdf(2)],
      ['否定的不算', '不要 2MB，改成 5MB', pdf(5)],
    ] as const)('%s：不报', (_name, input, wf) => {
      const locale = /[一-龥]/.test(input)
        ? 'zh'
        : input.includes('Ko') || input.includes('Mo')
          ? 'fr'
          : 'en';
      expect(run(input, locale, with_(wf))).toEqual([]);
    });

    it('说的是 500 KB、写成 300 KB：要报（三种语言）', () => {
      for (const [input, locale] of [
        ['压到 500KB', 'zh'],
        ['compress to 500 KB', 'en'],
        ['compresser à 500 Ko', 'fr'],
      ] as const)
        expect(run(input, locale, with_(compress({ maxKB: 300 })))).toEqual(['param-size']);
    });

    it('新建的快捷操作要压到多大，却没有压缩这一步：要报', () => {
      const wf = quick('n', [
        ['in.photos', { source: 'library', min: 1, max: 5 }],
        ['out.share', {}],
      ]);
      expect(run('压到 2MB 再分享', 'zh', with_(wf))).toEqual(['param-size']);
    });

    it('不确定的都不报：没碰快捷操作、4K、2 mo（两个月）、已有的链只加了一步', () => {
      expect(run('固定 2MB', 'zh', empty, empty)).toEqual([]);
      expect(run('compress to 4K', 'en', with_(compress({ maxKB: 300 })))).toEqual([]);
      expect(run('keep it for 2 mo', 'en', with_(compress({ maxKB: 300 })))).toEqual([]);
      const before = with_(quick('n', [['in.photos', { source: 'library', min: 1, max: 5 }]]));
      const after = with_(
        quick('n', [
          ['in.photos', { source: 'library', min: 1, max: 5 }],
          ['out.share', {}],
        ]),
      );
      expect(run('那个 2MB 的快捷操作加一步分享', 'zh', after, before)).toEqual([]);
    });

    it('改别的快捷操作时，没动的快捷操作不算', () => {
      const other = pdf(4);
      const before = with_(other);
      const after = with_(other, compress({ maxKB: 2048 }));
      expect(run('压到 2MB', 'zh', after, before)).toEqual([]);
    });
  });

  describe('目标语言', () => {
    const translate = (to: string) =>
      quick('t', [
        ['in.text', { text: 'x' }],
        ['translate.text', { from: 'auto', to }],
      ]);

    it.each([
      ['traduire mon relevé de notes en anglais', 'fr', 'fr'],
      ['翻译成英文', 'zh', 'zh-Hans'],
      ['国外寄来的信，拍一下变成英文 PDF', 'zh', 'zh-Hans'],
      ['translate it into English', 'en', 'fr'],
      ['翻译成中文', 'zh', 'en'],
      ['traduire en français', 'fr', 'en'],
      ['翻译成日语', 'zh', 'ko'],
    ] as const)('「%s」写错语言：要报', (input, locale, to) => {
      expect(run(input, locale, with_(translate(to)))).toEqual(['param-language']);
    });

    it.each([
      ['traduire mon relevé de notes en anglais', 'fr', 'en'],
      ['翻译成英文', 'zh', 'en'],
      ['translate it into English', 'en', 'en'],
      ['翻译成中文', 'zh', 'zh-Hans'],
      ['翻译成中文', 'zh', 'zh-Hant'],
      ['翻译成繁体中文', 'zh', 'zh-Hant'],
      ['把英文翻译成法语', 'zh', 'fr'],
      ['translate from French to English', 'en', 'en'],
    ] as const)('「%s」→ %s %s：不报', (input, locale, to) => {
      expect(run(input, locale, with_(translate(to)))).toEqual([]);
    });

    it('没说目标语言的不报', () => {
      expect(run('翻译这段英文', 'zh', with_(translate('zh-Hans')))).toEqual([]);
      expect(run('translate my English notes', 'en', with_(translate('fr')))).toEqual([]);
    });

    it('新建的快捷操作没有翻译这一步：要报', () => {
      const wf = quick('n', [
        ['in.text', { text: 'x' }],
        ['text.toPdf', { pageSize: 'a4', fontSize: 12 }],
      ]);
      expect(run('翻译成英文再转 PDF', 'zh', with_(wf))).toEqual(['param-language']);
    });
  });

  describe('证件照底色', () => {
    const idPhoto = (background: string) =>
      quick('id', [
        ['in.photos', { source: 'library', min: 1, max: 1 }],
        ['image.idPhoto', { spec: 'us-passport', maxKB: 240, background }],
      ]);

    it.each([
      ['换成蓝底', 'zh', 'white'],
      ['blue background', 'en', 'keep'],
      ['fond blanc', 'fr', 'blue'],
    ] as const)('「%s」写错：要报', (input, locale, background) => {
      expect(run(input, locale, with_(idPhoto(background)))).toEqual(['param-background']);
    });

    it.each([
      ['换成蓝底', 'zh', 'blue'],
      ['blue background', 'en', 'blue'],
      ['fond blanc', 'fr', 'white'],
      ['换成蓝底', 'zh', 'custom'],
    ] as const)('「%s」→ %s %s：不报', (input, locale, background) => {
      expect(run(input, locale, with_(idPhoto(background)))).toEqual([]);
    });

    it('页面的「蓝色背景」和证件照没关系：不报', () => {
      expect(run('蓝色背景', 'zh', with_(compress({ maxKB: 300 })))).toEqual([]);
    });
  });

  describe('像素、倍速、页数、分辨率', () => {
    const resize = (params: object) =>
      quick('r', [
        ['in.photos', { source: 'library', min: 1, max: 5 }],
        ['image.resize', params],
      ]);
    const speed = (factor: number) =>
      quick('s', [
        ['in.videos', { source: 'library', min: 1, max: 1 }],
        ['video.speed', { factor }],
      ]);
    const split = (params: object) =>
      quick('sp', [
        ['in.files', { accept: 'pdf', min: 1, max: 1 }],
        ['pdf.split', params],
      ]);
    const select = (params: object) =>
      quick('se', [
        ['in.files', { accept: 'pdf', min: 1, max: 1 }],
        ['pdf.selectPages', params],
      ]);
    const video = (params: object) =>
      quick('v', [
        ['in.videos', { source: 'library', min: 1, max: 1 }],
        ['video.compress', params],
      ]);

    it('像素', () => {
      const wrong = resize({ mode: 'longEdge', px: 1600 });
      expect(run('长边 1080 像素', 'zh', with_(wrong))).toEqual(['param-pixels']);
      expect(run('long edge 1080 px', 'en', with_(wrong))).toEqual(['param-pixels']);
      expect(run('1080 pixels', 'fr', with_(wrong))).toEqual(['param-pixels']);
      expect(run('长边 1600 像素', 'zh', with_(wrong))).toEqual([]);
      expect(
        run('resize to 1920x1080', 'en', with_(resize({ mode: 'longEdge', px: 1920 }))),
      ).toEqual([]);
      // 按百分比缩放：说的像素没有落下来。
      expect(run('1080 px', 'en', with_(resize({ mode: 'percent', percent: 50 })))).toEqual([
        'param-pixels',
      ]);
      // 证件照的尺寸由规格定。
      const photo = quick('id', [
        ['in.photos', { source: 'library', min: 1, max: 1 }],
        ['image.idPhoto', { spec: 'us-passport', maxKB: 240 }],
      ]);
      expect(run('600×600 的证件照', 'zh', with_(photo))).toEqual([]);
      // 打印尺寸不是像素。
      expect(run('10x15 cm', 'en', with_(wrong))).toEqual([]);
    });

    it('倍速', () => {
      expect(run('两倍速', 'zh', with_(speed(1.5)))).toEqual(['param-speed']);
      expect(run('2x speed', 'en', with_(speed(1.5)))).toEqual(['param-speed']);
      expect(run('vitesse x2', 'fr', with_(speed(1.5)))).toEqual(['param-speed']);
      expect(run('1.5 倍速', 'zh', with_(speed(1.5)))).toEqual([]);
      expect(run('2x speed', 'en', with_(speed(2)))).toEqual([]);
      expect(run('两倍速', 'zh', with_(compress({ maxKB: 300 })))).toEqual([]);
    });

    it('页数', () => {
      const every3 = split({ mode: 'every', n: 3 });
      expect(run('每 5 页拆一份', 'zh', with_(every3))).toEqual(['param-pages']);
      expect(run('split every 5 pages', 'en', with_(every3))).toEqual(['param-pages']);
      expect(run('toutes les 5 pages', 'fr', with_(every3))).toEqual(['param-pages']);
      expect(run('每 3 页拆一份', 'zh', with_(every3))).toEqual([]);
      expect(run('第 2 到 5 页', 'zh', with_(select({ rule: 'range', range: '2-5' })))).toEqual([]);
      expect(run('第 2 到 5 页', 'zh', with_(select({ rule: 'range', range: '1-3' })))).toEqual([
        'param-pages',
      ]);
      expect(run('pages 2-5', 'en', with_(select({ rule: 'odd' })))).toEqual(['param-pages']);
      expect(run('第 1 页', 'zh', with_(select({ rule: 'first' })))).toEqual([]);
    });

    it('分辨率', () => {
      expect(run('压到 720p', 'zh', with_(video({ by: 'quality', quality: '1080p' })))).toEqual([
        'param-resolution',
      ]);
      expect(run('compress to 720p', 'en', with_(video({ by: 'size', maxMB: 20 })))).toEqual([
        'param-resolution',
      ]);
      expect(
        run('compresser en 720p', 'fr', with_(video({ by: 'quality', quality: '720p' }))),
      ).toEqual([]);
    });
  });
});

describe('在 Hermes 上能跑', () => {
  it('不用后行断言和 Unicode 属性类（同 route.ts）', () => {
    const source = readFileSync(new URL('./tool-check.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\(\?<[!=]/);
    expect(source).not.toMatch(/\\p\{/);
  });

  it('紧跟在别的数后面的不算一个数', () => {
    const before = workspace({});
    const pdf = quick('p', [
      ['in.photos', { source: 'library', min: 1, max: 5 }],
      [
        'pdf.fromImages',
        { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 3 },
      ],
    ]);
    const after = workspace({ tools: [pdf] });
    const codes = (input: string) =>
      checkRequestParams(input, 'zh', before, after).map((i) => i.code);
    expect(codes('压到 2MB')).toEqual(['param-size']);
    expect(codes('压到 1.2.3MB')).toEqual([]);
  });

  it('名字里的标点不算：全角、中文、ASCII 都一样，是同一张表', () => {
    const config = workspace({
      tables: [table('a', [text('title')], '读书，笔记'), table('b', [text('x')], '读书 笔记！')],
      home: [addButton('add', 'a'), stat('total', 'b')],
    });
    expect(codes(check(config))).toContain('duplicate-table');
  });
});
