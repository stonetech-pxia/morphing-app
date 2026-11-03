import { describe, expect, it } from 'vitest';

import { LEAF_COMPONENTS } from '../components';
import { chartComponent } from '../components/chart';
import { formComponent } from '../components/form';
import { NumberSourceSchema } from '../components/number';
import { TrailingFormatSchema } from '../components/records';
import { createDefaultWorkspace } from '../defaults';
import { FIELDS } from '../fields';
import { scheduleField } from '../fields/schedule';
import { RECORD_TOOL_KINDS, TOOL_USE_AS } from '../record-ops-schema';
import {
  AGGREGATES,
  ConditionSchema,
  GROUP_UNITS,
  PERIODS,
  RECORD_LOOKS,
  ReminderSchema,
  ReminderWhenSchema,
  STREAK_UNITS,
} from '../schema';
import { BUILTIN_TOOLS } from '../tools';
import { CORE_ACTIONS } from '../registry';
import { registry } from '../test-helpers';
import { CAPABILITIES, viewOf } from './capabilities';
import {
  addField,
  addPage,
  addTable,
  addTool,
  blockIn,
  buildConfig,
  button,
  changed,
  chart,
  choice,
  date,
  form,
  link,
  money,
  navTo,
  number,
  quickAction,
  records,
  reminder,
  runAction,
  scanInto,
  text,
} from './fixtures';

const IDS = new Set(CAPABILITIES.map((c) => c.id));

/** 这几样东西配置里有，但不是个人记录能力：摆样子或者属于文件那边，单列出来，新外观不会悄悄漏掉。 */
const NOT_RECORD_LOOKS = new Set([
  'header',
  'text',
  'notice',
  'image',
  'divider',
  'spacer',
  'entry',
  'picker',
  'files',
  'library',
  'packages',
  'action',
]);
/** 写块放在 write.look.*，别的在 read.look.*。 */
const WRITE_LOOKS = new Set(['form', 'button']);
/** 提醒上的键：基本信息、when 和 opens 另有能力。 */
const REMINDER_PLAIN_KEYS = new Set([
  'id',
  'kind',
  'package',
  'preset',
  'title',
  'enabled',
  'when',
  'opens',
]);
const NUMBER_SOURCE_PLAIN_KEYS = new Set([
  'table',
  'aggregate',
  'field',
  'filter',
  'days',
  'group',
]);
const SCHEDULE_PLAIN_KEYS = new Set(['id', 'name', 'required', 'type', 'default']);

describe('完整性守护：schema 和登记表多一种东西，能力表少一个就失败', () => {
  const missing = (expected: string[]) => expected.filter((id) => !IDS.has(id));

  it('每种字段类型', () => {
    expect(missing(FIELDS.map((f) => `field.${f.type}`))).toEqual([]);
  });

  it('日程字段的每个选项', () => {
    const keys = Object.keys(scheduleField.schema.shape).filter((k) => !SCHEDULE_PLAIN_KEYS.has(k));
    expect(missing(keys.map((k) => `field.schedule.${k}`))).toEqual([]);
  });

  it('每种一键记录工具和出现方式', () => {
    expect(missing(RECORD_TOOL_KINDS.map((k) => `write.do.${k}`))).toEqual([]);
    expect(missing(TOOL_USE_AS.map((k) => `write.as.${k}`))).toEqual([]);
  });

  it('每种外观都分过类，读写块都有能力', () => {
    const looks = LEAF_COMPONENTS.map((c) => c.look as string);
    const record = looks.filter((l) => !NOT_RECORD_LOOKS.has(l));
    expect(
      missing(record.map((l) => (WRITE_LOOKS.has(l) ? `write.look.${l}` : `read.look.${l}`))),
    ).toEqual([]);
    expect(record).toEqual(expect.arrayContaining([...RECORD_LOOKS, 'number', 'chart']));
    // 读表、写记录的外观不能被划到「不是记录能力」里（action 只是运行快捷操作，out.addRecord 有自己的能力）。
    for (const c of LEAF_COMPONENTS)
      if (c.reads === 'table' || c.writes) expect(NOT_RECORD_LOOKS.has(c.look)).toBe(false);
  });

  it('每种聚合、筛选条件、时间段、分组单位、连续的单位', () => {
    expect(missing(AGGREGATES.map((a) => `read.aggregate.${a}`))).toEqual([]);
    expect(missing(ConditionSchema.shape.op.options.map((o) => `read.op.${o}`))).toEqual([]);
    expect(missing(PERIODS.map((p) => `read.period.${p}`))).toEqual([]);
    expect(missing(GROUP_UNITS.map((u) => `read.group.unit.${u}`))).toEqual([]);
    expect(missing(STREAK_UNITS.map((u) => `read.streak.unit.${u}`))).toEqual([]);
  });

  it('每种图表、表单方式、右侧格式', () => {
    const kinds = chartComponent.schema.shape.show.shape.kind.options;
    expect(missing(kinds.map((k: string) => `read.chart.${k}`))).toEqual([]);
    const modes = formComponent.schema.shape.show.shape.mode.options;
    expect(missing(modes.map((k: string) => `write.form.${k}`))).toEqual([]);
    const formats = TrailingFormatSchema.options.map((o) => o.shape.kind.value as string);
    expect(missing(formats.map((k) => `read.format.${k}`))).toEqual([]);
  });

  it('数字块的每个选项', () => {
    const keys = Object.keys(NumberSourceSchema.shape).filter(
      (k) => !NUMBER_SOURCE_PLAIN_KEYS.has(k),
    );
    expect(missing(keys.map((k) => `read.number.${k}`))).toEqual([]);
  });

  it('每种提醒时间和提醒上的选项', () => {
    const whens = ReminderWhenSchema.options.map((o) => {
      const shape = o.shape as Record<string, { value?: string }>;
      if (shape.every) return shape.every.value === 'day' ? 'everyDay' : 'everyWeek';
      return Object.keys(shape)[0]!;
    });
    expect(whens.sort()).toEqual(['after', 'before', 'each', 'everyDay', 'everyWeek']);
    expect(missing(whens.map((w) => `remind.when.${w}`))).toEqual([]);
    const keys = Object.keys(ReminderSchema.shape).filter((k) => !REMINDER_PLAIN_KEYS.has(k));
    expect(missing(keys.map((k) => `remind.${k}`))).toEqual([]);
  });

  it('每个读写数据表的动作', () => {
    const actions = [...BUILTIN_TOOLS.flatMap((t) => t.actions), ...CORE_ACTIONS].filter((a) =>
      a.fields.some((f) => f.kind === 'collection'),
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      const writes = a.fields.some((f) => f.kind === 'collection' && f.receives);
      expect(IDS).toContain(`${writes ? 'write' : 'read'}.action.${a.id}`);
    }
  });

  it('能力 ID 不重复', () => {
    expect(IDS.size).toBe(CAPABILITIES.length);
  });
});

/** 一份什么都用上的配置：证明每个谓词都能成立，没有写死成假。 */
function everything() {
  const periods = [
    'today',
    'thisWeek',
    'thisMonth',
    'thisYear',
    'last7days',
    'last30days',
    'last14days',
    'last90days',
    'last365days',
    'thisTwoWeeks',
    'thisHalfMonth',
  ];
  return buildConfig([
    addTable('groups', [text('name', { required: true })]),
    addTable('items', [
      text('title'),
      { id: 'body', name: 'body', type: 'note' },
      { id: 'qty', name: 'qty', type: 'number' },
      money(),
      { id: 'done', name: 'done', type: 'checkbox' },
      date(),
      { id: 'at', name: 'at', type: 'datetime' },
      { id: 'clock', name: 'clock', type: 'time' },
      { id: 'mins', name: 'mins', type: 'duration' },
      choice('status', ['a', 'b', 'skip'], { default: 'a' }),
      { id: 'stars', name: 'stars', type: 'rating' },
      { id: 'photo', name: 'photo', type: 'file' },
      link('group', 'groups'),
      { id: 'twice', name: 'twice', type: 'formula', expression: '{qty} * 2' },
      { id: 'group-name', name: 'group-name', type: 'lookup', via: 'group', field: 'name' },
      { id: 'before', name: 'before', type: 'previous', field: 'qty' },
      {
        id: 'plan',
        name: 'plan',
        type: 'schedule',
        default: { repeat: 'daily' },
        lastDone: 'date',
        countEarly: true,
      },
    ]),
    {
      op: 'updateData',
      table: 'items',
      changes: { readAttachments: true },
    },
    addField('groups', {
      id: 'all',
      name: 'all',
      type: 'rollup',
      table: 'items',
      via: 'group',
      aggregate: 'latest',
    }),
    addTool(scanInto('scan-item', 'items')),
    addTool(
      quickAction('print-items', [
        ['in.records', { collectionId: 'items', period: 'thisMonth' }],
        ['print.records', { template: 'table', title: 'Items', fields: ['title'], pageSize: 'a4' }],
        ['out.share', {}],
      ]),
    ),
    addPage(
      'item',
      [
        form('add-in-item', 'groups', ['name']),
        form('link-in-item', 'items', ['title'], { values: { group: '$record' } }),
      ],
      { of: 'groups' },
    ),
    addPage('writes', [
      form('add', 'items', ['title', 'photo'], {
        smartDate: { from: 'title', to: 'date' },
      }),
      { ...form('sheet', 'items', ['title']), show: { mode: 'sheet' } },
      button('all', { do: 'create', table: 'items', ask: 'all' }),
      button('quick', {
        do: 'create',
        table: 'items',
        values: { at: 'now', status: 'b' },
      }),
      button('bulk', { do: 'setAll', table: 'items', field: 'status', value: 'a' }),
      runAction('run-scan', 'scan-item'),
      records('list', 'rows', 'items', 'title', {
        source: { sort: { field: 'date', direction: 'desc' } },
        show: {
          trailing: 'at',
          format: { kind: 'elapsed' },
        },
        tools: [
          { as: 'button', label: 'Set', do: 'set', table: 'items', field: 'date', value: 'today' },
          {
            as: 'button',
            label: 'Add',
            do: 'increment',
            table: 'items',
            field: 'qty',
            by: 1,
            when: [{ field: 'qty', op: 'lt', value: 5 }],
          },
          { as: 'addHere', do: 'create', table: 'items', ask: 'all', values: '$here' },
          { as: 'button', label: 'Open', opens: 'record' },
        ],
      }),
      records('list', 'by-group-list', 'groups', 'name', {
        opens: 'item',
        tools: [
          {
            as: 'button',
            label: 'Add',
            do: 'create',
            table: 'items',
            ask: 'all',
            values: { group: '$row' },
          },
        ],
      }),
    ]),
    addPage('views', [
      records('cards', 'cards', 'items', 'title', {
        source: { filter: [{ field: 'title', op: 'contains', value: 'x' }] },
        show: { trailing: 'qty', format: { kind: 'progress', goal: 10 } },
      }),
      records('checklist', 'check', 'items', 'title', {
        source: { group: { by: 'status', showEmpty: true } },
        tools: [{ as: 'check', do: 'toggle', table: 'items', field: 'done' }],
      }),
      records('tiles', 'tiles', 'items', 'title', {
        tools: [{ as: 'tap', label: 'Tap', do: 'increment', table: 'items', field: 'qty', by: 1 }],
      }),
      records('board', 'board', 'items', 'title', {
        source: {
          group: { by: 'group', filter: [{ field: 'name', op: 'isNotEmpty' }] },
        },
        tools: [{ as: 'drag', do: 'set', table: 'items', field: 'group', value: '$group' }],
      }),
      records('calendar', 'cal', 'items', 'title', {
        source: { group: { unit: 'day' } },
        show: { color: 'status' },
      }),
      records('list', 'by-week', 'items', 'title', {
        source: {
          group: { unit: 'week' },
          filter: [{ field: 'plan', op: 'due', value: 'today' }],
        },
      }),
      records('list', 'by-schedule', 'items', 'title', { source: { group: { by: 'plan' } } }),
      number('n-goal', 'items', {
        aggregate: 'count',
        goal: 5,
        filter: [{ field: 'status', op: 'is', value: 'a' }],
      }),
      number('n-compare', 'items', {
        aggregate: 'sum',
        field: 'amount',
        compare: 'previous',
        filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
      }),
      number('n-minus', 'items', {
        aggregate: 'sum',
        field: 'amount',
        minus: { table: 'items', aggregate: 'sum', field: 'qty' },
      }),
      number('n-avg', 'items', { aggregate: 'avg', field: 'qty', group: { by: 'status' } }),
      number('n-min', 'items', { aggregate: 'min', field: 'qty', group: { by: 'group' } }),
      number('n-max', 'items', { aggregate: 'max', field: 'qty' }),
      number('n-streak', 'items', {
        aggregate: 'streak',
        days: { unit: 'week', perUnit: 2, skip: { field: 'status', option: 'skip' } },
      }),
      number('n-streak-day', 'items', { aggregate: 'streak', days: { unit: 'day' } }),
      number('n-streak-month', 'items', { aggregate: 'streak', days: { unit: 'month' } }),
      number('n-since', 'items', { aggregate: 'daysSince' }),
      number('n-interval', 'items', { aggregate: 'avgInterval' }),
      number('n-days', 'items', { aggregate: 'distinctDays' }),
      chart('c-bar', 'items', 'bar', {
        aggregate: 'sum',
        field: 'amount',
        group: { unit: 'month', last: 6 },
      }),
      chart('c-line', 'items', 'line', { aggregate: 'count', group: { unit: 'day' } }),
      chart('c-pie', 'items', 'pie', { aggregate: 'count', group: { by: 'status' } }),
    ]),
    addPage(
      'periods',
      periods.map((value) =>
        number(`p-${value.toLowerCase()}`, 'items', {
          aggregate: 'count',
          filter: [{ field: 'date', op: 'inPeriod', value }],
        }),
      ),
    ),
    addPage('ops', [
      number('o-not', 'items', {
        aggregate: 'count',
        filter: [
          { field: 'status', op: 'isNot', value: 'b' },
          { field: 'qty', op: 'gt', value: 0 },
          { field: 'body', op: 'isEmpty' },
        ],
      }),
    ]),
    addTool(reminder('r-day', { every: 'day', at: '09:00' }, 'page:views')),
    addTool(reminder('r-week', { every: 'week', days: [1], at: '09:00' }, 'page:views')),
    addTool(
      reminder(
        'r-before',
        { before: { table: 'items', field: 'date' }, days: 1, at: '09:00' },
        'page:views',
      ),
    ),
    addTool(
      reminder('r-each', { each: { table: 'items', field: 'plan' }, at: '09:00' }, 'page:views', {
        done: { do: 'set', table: 'items', field: 'date', value: 'today' },
        snoozeMinutes: 10,
        unless: { table: 'items', within: 'day' },
      }),
    ),
    addTool(reminder('r-after', { after: { table: 'items' }, minutes: 5 }, 'page:views')),
    navTo('writes', 'views', 'periods'),
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'to-ops',
        look: 'entry',
        show: { title: 'ops', icon: 'star' },
        opens: 'page:ops',
      },
    },
  ]);
}

describe('每个谓词', () => {
  it('在什么都用上的配置上都成立', () => {
    const v = viewOf(everything(), registry);
    expect(CAPABILITIES.filter((c) => !c.test(v)).map((c) => c.id)).toEqual([]);
  });

  it('在新配置上都不成立', () => {
    const v = viewOf(createDefaultWorkspace('en'), registry);
    expect(CAPABILITIES.filter((c) => c.test(v)).map((c) => c.id)).toEqual([]);
  });

  it('藏起来的块、进不去的页面、关掉的提醒都不算', () => {
    const has = (config: object, id: string) =>
      CAPABILITIES.find((c) => c.id === id)!.test(viewOf(config as never, registry));
    const base = everything();
    expect(has(base, 'read.look.tiles')).toBe(true);
    expect(
      has(
        changed(base, (c) => (blockIn(c, 'tiles').hidden = true)),
        'read.look.tiles',
      ),
    ).toBe(false);
    expect(
      has(
        changed(base, (c) => {
          c.nav.bar = ['page:home', 'settings'];
          c.tools = c.tools.filter((t: { kind: string }) => t.kind !== 'reminder');
        }),
        'read.look.tiles',
      ),
    ).toBe(false);
    expect(has(base, 'remind.when.after')).toBe(true);
    expect(
      has(
        changed(base, (c) => {
          for (const t of c.tools) if (t.id === 'r-after') t.enabled = false;
        }),
        'remind.when.after',
      ),
    ).toBe(false);
  });

  it('只读，不改配置', () => {
    const config = everything();
    const before = JSON.stringify(config);
    const v = viewOf(config, registry);
    for (const c of CAPABILITIES) c.test(v);
    expect(JSON.stringify(config)).toBe(before);
  });
});
