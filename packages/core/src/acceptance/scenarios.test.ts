import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import { createDefaultWorkspace } from '../defaults';
import { sampleOps } from '../samples';
import type { Locale, WorkspaceConfig } from '../schema';
import { createStarterWorkspace } from '../starter';
import { templateOps } from '../templates';
import { registry } from '../test-helpers';
import { checkTools } from '../tool-check';
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
  dropBlock,
  fieldIn,
  form,
  link,
  money,
  navTo,
  number,
  records,
  reminder,
  runAction,
  scanInto,
  tableIn,
  text,
  toolIn,
  type Json,
} from './fixtures';
import { SCENARIOS, nextAsk, scoreScenario, type Scenario } from './index';

// 三件事：正例（配置走校验器，合格），多种实现（同一需求别的建法也算过），反例（缺这项就不过，证明它真在查）。
// 每个场景第一种建法是完整的（可选项也过），后面的只要合格。

const app = (...ops: object[]) => buildConfig([...ops, navTo('app')]);

const fromTemplate = (template: Parameters<typeof templateOps>[0], locale: Locale = 'en') => {
  const base = createDefaultWorkspace(locale);
  const prepared = prepareOps(base, templateOps(template, base, locale), {
    registry,
    locale,
    now: new Date(0),
  });
  if (!prepared.ok) throw new Error(prepared.issues.join('\n'));
  return prepared.after;
};

const fromSample = (sample: Parameters<typeof sampleOps>[0], locale: Locale = 'en') => {
  const base = createStarterWorkspace(locale, registry);
  const ops = sampleOps(sample, base, locale);
  if (!ops.ok) throw new Error(ops.message);
  const prepared = prepareOps(base, ops.ops, { registry, locale, now: new Date(0) });
  if (!prepared.ok) throw new Error(prepared.issues.join('\n'));
  return prepared.after;
};

// ---- 打卡 ----

const simpleButton = () =>
  app(
    addTable('checkins', [date()]),
    addPage('app', [
      button('check-in', { do: 'create', table: 'checkins' }),
      number('days', 'checkins', { aggregate: 'distinctDays' }),
      records('list', 'history', 'checkins', 'date'),
    ]),
  );

const simpleChecklist = () =>
  app(
    addTable('days', [text('name'), { id: 'done', name: 'done', type: 'checkbox' }]),
    addPage('app', [
      form('add', 'days', ['name']),
      records('checklist', 'check', 'days', 'name', {
        tools: [{ as: 'check', do: 'toggle', table: 'days', field: 'done' }],
      }),
      number('count', 'days', {
        aggregate: 'count',
        filter: [{ field: 'done', op: 'is', value: true }],
      }),
    ]),
  );

const streaksTables = () => [
  addTable('habits', [
    text('name', { required: true }),
    { id: 'plan', name: 'plan', type: 'schedule', default: { repeat: 'daily' } },
  ]),
  addTable('checkins', [link('habit', 'habits'), date()]),
];
const tapToCheckIn = {
  as: 'tap',
  label: 'Done',
  do: 'create',
  table: 'checkins',
  values: { habit: '$row' },
};
const nineAtNight = (extra: object = {}) =>
  addTool(
    reminder('nine', { each: { table: 'habits', field: 'plan' }, at: '21:00' }, 'page:app', {
      done: { do: 'create', table: 'checkins', values: { habit: '$row' } },
      ...extra,
    }),
  );

const streaksRollup = () =>
  app(
    ...streaksTables(),
    addField('habits', {
      id: 'streak',
      name: 'streak',
      type: 'rollup',
      table: 'checkins',
      via: 'habit',
      aggregate: 'streak',
    }),
    addPage('app', [
      form('add-habit', 'habits', ['name']),
      records('tiles', 'circles', 'habits', 'name', {
        show: { trailing: 'streak' },
        tools: [tapToCheckIn],
      }),
    ]),
    nineAtNight({ unless: { table: 'checkins', within: 'day', link: 'habit' } }),
  );

const streaksNumber = () =>
  app(
    ...streaksTables(),
    addPage('app', [
      button('add-habit', { do: 'create', table: 'habits', ask: 'all' }),
      records('tiles', 'circles', 'habits', 'name', { tools: [tapToCheckIn] }),
      number('streak', 'checkins', { aggregate: 'streak', group: { by: 'habit' } }),
    ]),
    nineAtNight(),
  );

const weeklyNumbers = () =>
  app(
    addTable('runs', [date(), text('note')]),
    addPage('app', [
      button('log', { do: 'create', table: 'runs' }),
      number('this-week', 'runs', {
        aggregate: 'count',
        goal: 3,
        filter: [{ field: 'date', op: 'inPeriod', value: 'thisWeek' }],
      }),
      number('weeks', 'runs', { aggregate: 'streak', days: { unit: 'week', perUnit: 3 } }),
    ]),
  );

const weeklyRing = () =>
  app(
    addTable('habits', [
      text('name', { required: true }),
      { id: 'goal', name: 'goal', type: 'number' },
    ]),
    addTable('checkins', [link('habit', 'habits'), date()]),
    addField('habits', {
      id: 'week',
      name: 'week',
      type: 'rollup',
      table: 'checkins',
      via: 'habit',
      aggregate: 'count',
      filter: [{ field: 'date', op: 'inPeriod', value: 'thisWeek' }],
    }),
    addPage('app', [
      form('add', 'habits', ['name', 'goal']),
      records('list', 'list', 'habits', 'name', {
        show: { trailing: 'week', format: { kind: 'progress', goal: 'goal' } },
        tools: [
          {
            as: 'button',
            label: 'Log',
            do: 'create',
            table: 'checkins',
            values: { habit: '$row' },
          },
        ],
      }),
    ]),
  );

// ---- 日历 ----

const moodForm = () =>
  app(
    addTable('moods', [date(), choice('mood', ['good', 'bad']), text('note')]),
    addPage('app', [
      form('add', 'moods', ['mood', 'note']),
      records('calendar', 'month', 'moods', 'mood', {
        source: { group: { unit: 'day' } },
        show: { color: 'mood' },
      }),
    ]),
  );

const moodButtons = () =>
  app(
    addTable('moods', [choice('mood', ['good', 'bad'])]),
    addPage('app', [
      button('good', { do: 'create', table: 'moods', values: { mood: 'good' } }),
      button('bad', { do: 'create', table: 'moods', values: { mood: 'bad' } }),
      records('calendar', 'month', 'moods', 'mood', {
        source: { group: { unit: 'day', by: 'createdAt' } },
        show: { color: 'mood' },
      }),
    ]),
  );

const medsEach = () =>
  app(
    addTable('meds', [
      text('name', { required: true }),
      { id: 'plan', name: 'plan', type: 'schedule', default: { repeat: 'daily' } },
    ]),
    addTable('doses', [link('med', 'meds'), date()]),
    addPage('app', [
      form('add', 'meds', ['name']),
      records('list', 'meds', 'meds', 'name', {
        tools: [
          { as: 'button', label: 'Taken', do: 'create', table: 'doses', values: { med: '$row' } },
        ],
      }),
      records('calendar', 'month', 'doses', 'med', { source: { group: { unit: 'day' } } }),
    ]),
    addTool(
      reminder('morning', { each: { table: 'meds', field: 'plan' }, at: '08:00' }, 'page:app', {
        done: { do: 'create', table: 'doses', values: { med: '$row' } },
        unless: { table: 'doses', within: 'day', link: 'med' },
      }),
    ),
  );

const medsButton = () =>
  app(
    addTable('doses', [date()]),
    addPage('app', [
      button('taken', { do: 'create', table: 'doses' }),
      records('calendar', 'month', 'doses', 'date', { source: { group: { unit: 'day' } } }),
    ]),
    addTool(reminder('morning', { every: 'day', at: '08:00' }, 'page:app')),
  );

// ---- 待办 ----

const todoChecklist = () =>
  app(
    addTable('tasks', [
      text('title', { required: true }),
      { id: 'done', name: 'done', type: 'checkbox' },
    ]),
    addPage('app', [
      form('add', 'tasks', ['title']),
      records('checklist', 'check', 'tasks', 'title', {
        source: { sort: { field: 'done', direction: 'asc' } },
        tools: [{ as: 'check', do: 'toggle', table: 'tasks', field: 'done' }],
      }),
    ]),
  );

const todoStatus = () =>
  app(
    addTable('tasks', [text('title'), choice('status', ['open', 'finished'], { default: 'open' })]),
    addPage('app', [
      button('add', { do: 'create', table: 'tasks', ask: 'all' }),
      records('list', 'list', 'tasks', 'title', {
        source: { filter: [{ field: 'status', op: 'isNot', value: 'finished' }] },
        tools: [
          {
            as: 'button',
            label: 'Done',
            do: 'set',
            table: 'tasks',
            field: 'status',
            value: 'finished',
          },
        ],
      }),
    ]),
  );

/** 真实结果：完成表，列表上的按钮新建一条完成记录，一次性任务完成后从 due 列表消失。 */
const todoCompletions = (extra: { done?: object; source?: object } = {}) =>
  app(
    addTable('tasks', [
      text('title', { required: true }),
      { id: 'plan', name: 'plan', type: 'schedule', default: { repeat: 'once' } },
    ]),
    addTable('completions', [link('task', 'tasks', { required: true }), date()]),
    addField('tasks', {
      id: 'last',
      name: 'last',
      type: 'rollup',
      table: 'completions',
      via: 'task',
      aggregate: 'latest',
      field: 'date',
    }),
    { op: 'updateData', table: 'tasks', field: 'plan', changes: { lastDone: 'last' } },
    addPage('app', [
      form('add', 'tasks', ['title']),
      records('list', 'list', 'tasks', 'title', {
        source: extra.source ?? { filter: [{ field: 'plan', op: 'due', value: 'today' }] },
        tools: [
          {
            as: 'button',
            label: 'Done',
            do: 'create',
            table: 'completions',
            ...(extra.done ?? { values: { task: '$row' } }),
          },
        ],
      }),
    ]),
  );

const todoistCompletions = () =>
  app(
    addTable('projects', [text('name', { required: true })]),
    addTable('tasks', [
      text('title', { required: true }),
      { id: 'plan', name: 'plan', type: 'schedule', default: { repeat: 'once' } },
      link('project', 'projects'),
    ]),
    addTable('completions', [link('task', 'tasks', { required: true }), date()]),
    addField('tasks', {
      id: 'last',
      name: 'last',
      type: 'rollup',
      table: 'completions',
      via: 'task',
      aggregate: 'latest',
      field: 'date',
    }),
    { op: 'updateData', table: 'tasks', field: 'plan', changes: { lastDone: 'last' } },
    addPage('app', [
      form('add', 'tasks', ['title', 'plan', 'project']),
      button('add-project', { do: 'create', table: 'projects', ask: 'all' }),
      records('list', 'today', 'tasks', 'title', {
        source: { filter: [{ field: 'plan', op: 'due', value: 'today' }] },
        tools: [
          {
            as: 'button',
            label: 'Done',
            do: 'create',
            table: 'completions',
            values: { task: '$row' },
          },
        ],
      }),
    ]),
    addTool(
      reminder('due', { each: { table: 'tasks', field: 'plan' }, at: '09:00' }, 'page:app', {
        done: { do: 'create', table: 'completions', values: { task: '$row' } },
      }),
    ),
  );

const todoistDate = () =>
  app(
    addTable('tasks', [
      text('title', { required: true }),
      { id: 'finished', name: 'finished', type: 'date' },
      { id: 'plan', name: 'plan', type: 'schedule', lastDone: 'finished' },
      choice('project', ['home', 'work']),
    ]),
    addPage('app', [
      form('add', 'tasks', ['title', 'plan', 'project']),
      records('list', 'all', 'tasks', 'title', {
        source: { sort: { field: 'plan', direction: 'asc' }, group: { by: 'project' } },
        tools: [
          {
            as: 'button',
            label: 'Done',
            do: 'set',
            table: 'tasks',
            field: 'finished',
            value: 'today',
          },
        ],
      }),
    ]),
    addTool(reminder('daily', { every: 'day', at: '09:00' }, 'page:app')),
  );

const dragTool = (table: string, field: string) => ({
  as: 'drag',
  do: 'set',
  table,
  field,
  value: '$group',
});

const boardChoice = () =>
  app(
    addTable('cards', [
      text('title', { required: true }),
      choice('status', ['todo', 'doing', 'done'], { default: 'todo' }),
    ]),
    addPage('app', [
      records('board', 'board', 'cards', 'title', {
        source: { group: { by: 'status' } },
        tools: [
          dragTool('cards', 'status'),
          { as: 'addHere', do: 'create', table: 'cards', ask: 'all', values: '$here' },
        ],
      }),
    ]),
  );

const boardLink = () =>
  app(
    addTable('columns', [text('name', { required: true })]),
    addTable('cards', [text('title', { required: true }), link('column', 'columns')]),
    addPage('app', [
      form('add-column', 'columns', ['name']),
      form('add-card', 'cards', ['title', 'column']),
      records('board', 'board', 'cards', 'title', {
        source: { group: { by: 'column' } },
        tools: [dragTool('cards', 'column')],
      }),
    ]),
  );

// ---- 记账 ----

const ledgerChoice = () =>
  app(
    addTable('expenses', [money(), choice('category', ['food', 'rent']), date(), text('note')]),
    addPage('app', [
      form('add', 'expenses', ['amount', 'category', 'note']),
      number('per-category', 'expenses', {
        aggregate: 'sum',
        field: 'amount',
        group: { by: 'category' },
      }),
      chart('per-month', 'expenses', 'bar', {
        aggregate: 'sum',
        field: 'amount',
        group: { unit: 'month' },
      }),
      records('list', 'list', 'expenses', 'note'),
    ]),
  );

const ledgerLink = () =>
  app(
    addTable('categories', [text('name', { required: true })]),
    addTable('expenses', [money(), link('category', 'categories'), date()]),
    addField('categories', {
      id: 'month',
      name: 'month',
      type: 'rollup',
      table: 'expenses',
      via: 'category',
      aggregate: 'sum',
      field: 'amount',
      filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
    }),
    addPage('app', [
      button('add-category', { do: 'create', table: 'categories', ask: 'all' }),
      button('add', { do: 'create', table: 'expenses', ask: 'all' }),
      records('list', 'categories', 'categories', 'name', { show: { trailing: 'month' } }),
    ]),
  );

const budgetFormula = () =>
  app(
    addTable('categories', [text('name', { required: true }), money('target')]),
    addTable('expenses', [money(), link('category', 'categories'), date()]),
    addField('categories', {
      id: 'spent',
      name: 'spent',
      type: 'rollup',
      table: 'expenses',
      via: 'category',
      aggregate: 'sum',
      field: 'amount',
    }),
    addField('categories', {
      id: 'left',
      name: 'left',
      type: 'formula',
      expression: '{target} - {spent}',
    }),
    addPage('app', [
      form('add-category', 'categories', ['name', 'target']),
      form('add', 'expenses', ['amount', 'category']),
      records('list', 'categories', 'categories', 'name', { show: { trailing: 'left' } }),
    ]),
  );

const budgetGoal = () =>
  app(
    addTable('expenses', [money(), choice('category', ['food', 'rent']), date()]),
    addPage('app', [
      form('add', 'expenses', ['amount', 'category']),
      number('food', 'expenses', {
        aggregate: 'sum',
        field: 'amount',
        goal: 500,
        filter: [
          { field: 'category', op: 'is', value: 'food' },
          { field: 'date', op: 'inPeriod', value: 'thisMonth' },
        ],
      }),
    ]),
  );

/** 真实结果：目标是独立的一张表，和支出用同一套单选分类，有添加入口。 */
const budgetTable = (budgets = ['food', 'rent']) =>
  app(
    addTable('expenses', [money(), choice('category', ['food', 'rent']), date()]),
    addTable('budgets', [choice('category', budgets), money('budget')]),
    addPage('app', [
      form('add', 'expenses', ['amount', 'category']),
      form('add-budget', 'budgets', ['category', 'budget']),
      number('left', 'budgets', {
        aggregate: 'sum',
        field: 'budget',
        minus: { table: 'expenses', aggregate: 'sum', field: 'amount' },
      }),
    ]),
  );

/** 零基预算（真实结果 S2-06）：目标来自另一张分配表。 */
const budgetAllocations = () =>
  app(
    addTable('categories', [text('name', { required: true })]),
    addTable('allocations', [money(), link('category', 'categories'), date('month')]),
    addTable('expenses', [money(), link('category', 'categories'), date()]),
    addField('categories', {
      id: 'allocated',
      name: 'allocated',
      type: 'rollup',
      table: 'allocations',
      via: 'category',
      aggregate: 'sum',
      field: 'amount',
    }),
    addField('categories', {
      id: 'spent',
      name: 'spent',
      type: 'rollup',
      table: 'expenses',
      via: 'category',
      aggregate: 'sum',
      field: 'amount',
    }),
    addField('categories', {
      id: 'left',
      name: 'left',
      type: 'formula',
      expression: '{allocated} - {spent}',
    }),
    addPage('app', [
      form('add-category', 'categories', ['name']),
      form('assign', 'allocations', ['amount', 'category']),
      form('add', 'expenses', ['amount', 'category']),
      records('list', 'categories', 'categories', 'name', { show: { trailing: 'left' } }),
    ]),
  );

// ---- 文件进记录 ----

const receiptTable = () =>
  addTable('claims', [
    money(),
    choice('category', ['food', 'travel']),
    date(),
    { id: 'photo', name: 'photo', type: 'file' },
  ]);

const receiptScan = () =>
  app(
    receiptTable(),
    addTool(scanInto('scan-receipt', 'claims')),
    addPage('app', [
      runAction('run-scan', 'scan-receipt'),
      records('list', 'list', 'claims', 'amount'),
      chart('per-month', 'claims', 'bar', {
        aggregate: 'sum',
        field: 'amount',
        group: { unit: 'month' },
      }),
    ]),
  );

const receiptForm = () =>
  app(
    receiptTable(),
    addPage('app', [
      form('add', 'claims', ['amount', 'category', 'photo']),
      records('list', 'list', 'claims', 'amount'),
    ]),
  );

const contractScan = () =>
  app(
    addTable('contracts', [
      text('name', { required: true }),
      { id: 'ends', name: 'ends', type: 'date' },
      { id: 'scan', name: 'scan', type: 'file' },
    ]),
    addTool(scanInto('scan-contract', 'contracts')),
    addPage('app', [
      runAction('run-scan', 'scan-contract'),
      records('list', 'list', 'contracts', 'name'),
    ]),
    addTool(
      reminder(
        'expiring',
        { before: { table: 'contracts', field: 'ends' }, days: 30, at: '09:00' },
        'page:app',
      ),
    ),
  );

// ---- 表：每个场景的建法和反例 ----

interface Plan {
  /** 第一种是完整的（可选项也过）。 */
  builds: Record<string, () => WorkspaceConfig>;
  /** 要求 → 在第一种建法上去掉这一项。 */
  without: Record<string, (c: Json) => void>;
}

const PLANS: Record<string, Plan> = {
  'habit-simple': {
    builds: { 按钮: simpleButton, 清单打勾: simpleChecklist },
    without: {
      'one-tap': (c) => (blockIn(c, 'check-in').tools[0].ask = 'all'),
      'days-count': (c) => dropBlock(c, 'days'),
      history: (c) => dropBlock(c, 'history'),
    },
  },
  'habit-streaks': {
    builds: { 汇总字段: streaksRollup, 数字块: streaksNumber },
    without: {
      circles: (c) => (blockIn(c, 'circles').look = 'cards'),
      'tap-checks-in': (c) => delete blockIn(c, 'circles').tools,
      streak: (c) => delete blockIn(c, 'circles').show.trailing,
      'reminder-time': (c) => (toolIn(c, 'nine').when.at = '08:00'),
      'done-on-notification': (c) => delete toolIn(c, 'nine').done,
      'no-nag': (c) => delete toolIn(c, 'nine').unless,
    },
  },
  'habit-weekly-goal': {
    builds: { 数字块: weeklyNumbers, 进度环: weeklyRing },
    without: {
      log: (c) => delete fieldIn(c, 'runs', 'date').default,
      'weekly-progress': (c) => {
        dropBlock(c, 'this-week');
        dropBlock(c, 'weeks');
      },
      'weekly-streak': (c) => dropBlock(c, 'weeks'),
    },
  },
  'calendar-mood': {
    builds: { 表单: moodForm, 每种心情一个按钮: moodButtons },
    without: {
      'log-mood': (c) => (blockIn(c, 'add').tools[0].ask = ['note']),
      'month-calendar': (c) => (blockIn(c, 'month').look = 'list'),
      'day-filled': (c) => delete fieldIn(c, 'moods', 'date').default,
      'mood-color': (c) => delete blockIn(c, 'month').show.color,
      'day-note': (c) => (blockIn(c, 'add').tools[0].ask = ['mood']),
    },
  },
  'calendar-medication': {
    builds: { 每种药一条: medsEach, 一个按钮: medsButton },
    without: {
      'one-tap-log': (c) => (blockIn(c, 'meds').tools[0].ask = 'all'),
      'month-calendar': (c) => dropBlock(c, 'month'),
      'reminder-time': (c) => (toolIn(c, 'morning').when.at = '09:00'),
      'done-on-notification': (c) => delete toolIn(c, 'morning').done,
      'no-nag': (c) => delete toolIn(c, 'morning').unless,
    },
  },
  'todo-simple': {
    builds: { 清单: todoChecklist, 按钮改状态: todoStatus, 完成表: () => todoCompletions() },
    without: {
      'add-task': (c) => dropBlock(c, 'add'),
      'check-off': (c) => delete blockIn(c, 'check').tools,
      'hide-done': (c) => delete blockIn(c, 'check').source.sort,
    },
  },
  'todo-todoist': {
    builds: { 完成表: todoistCompletions, 完成日期: todoistDate },
    without: {
      'add-task': (c) => dropBlock(c, 'add'),
      projects: (c) => dropBlock(c, 'add-project'),
      'once-or-repeat': (c) => (blockIn(c, 'add').tools[0].ask = ['title', 'project']),
      'today-view': (c) => delete blockIn(c, 'today').source.filter,
      'done-reschedules': (c) => delete fieldIn(c, 'tasks', 'plan').lastDone,
      reminder: (c) => (toolIn(c, 'due').enabled = false),
      'done-on-notification': (c) => delete toolIn(c, 'due').done,
    },
  },
  'todo-board': {
    builds: { 单选: boardChoice, 引用: boardLink },
    without: {
      board: (c) => (blockIn(c, 'board').look = 'list'),
      drag: (c) => (blockIn(c, 'board').tools = blockIn(c, 'board').tools.slice(1)),
      'add-card': (c) => (blockIn(c, 'board').tools = blockIn(c, 'board').tools.slice(0, 1)),
      'new-card-column': (c) => {
        delete fieldIn(c, 'cards', 'status').default;
        const board = blockIn(c, 'board');
        board.tools = board.tools.slice(0, 1);
        c.containers.pages.at(-1).blocks.push(form('add', 'cards', ['title']));
      },
    },
  },
  'money-ledger': {
    builds: { 单选: ledgerChoice, 引用和汇总: ledgerLink },
    without: {
      log: (c) => (blockIn(c, 'add').tools[0].ask = ['amount', 'note']),
      'by-category': (c) => dropBlock(c, 'per-category'),
      'by-month': (c) => dropBlock(c, 'per-month'),
      entries: (c) => dropBlock(c, 'list'),
    },
  },
  'money-budget': {
    builds: {
      公式: budgetFormula,
      数字块目标: budgetGoal,
      零基预算: budgetAllocations,
      目标表: () => budgetTable(),
    },
    without: {
      'log-spend': (c) => (blockIn(c, 'add').tools[0].ask = ['amount']),
      targets: (c) => {
        const t = tableIn(c, 'categories');
        t.fields = t.fields.filter((f: Json) => f.id !== 'target');
      },
      remaining: (c) => (blockIn(c, 'categories').show.trailing = 'spent'),
    },
  },
  'file-receipt': {
    builds: {
      扫描: receiptScan,
      表单选文件: receiptForm,
      样板: () => fromSample('expense-helper'),
    },
    without: {
      capture: (c) => dropBlock(c, 'run-scan'),
      'amount-category': (c) => {
        const t = tableIn(c, 'claims');
        t.fields = t.fields.filter((f: Json) => f.id !== 'category');
      },
      view: (c) => dropBlock(c, 'list'),
      camera: (c) => (toolIn(c, 'scan-receipt').steps[0].params.source = 'library'),
      monthly: (c) => dropBlock(c, 'per-month'),
    },
  },
  'file-contract': {
    builds: { 扫描: contractScan, 模版: () => fromTemplate('contract') },
    without: {
      capture: (c) => dropBlock(c, 'run-scan'),
      details: (c) => {
        const t = tableIn(c, 'contracts');
        t.fields = t.fields.filter((f: Json) => f.id !== 'name');
        blockIn(c, 'list').show.title = 'ends';
      },
      browse: (c) => dropBlock(c, 'list'),
      scanner: (c) => (toolIn(c, 'scan-contract').steps[0].params.source = 'library'),
      'expiry-reminder': (c) => (toolIn(c, 'expiring').enabled = false),
    },
  },
};

const score = (s: Scenario, config: WorkspaceConfig) => scoreScenario(s, config, registry);
const passOf = (s: Scenario, config: WorkspaceConfig, id: string) =>
  score(s, config).requirements.find((r) => r.id === id)!.pass;

describe('场景表', () => {
  it('12 个以内，五类都有，语言轮换', () => {
    expect(SCENARIOS.length).toBeLessThanOrEqual(12);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(new Set(SCENARIOS.map((s) => s.category))).toEqual(
      new Set(['habit', 'calendar', 'todo', 'money', 'fileToRecord']),
    );
    expect(new Set(SCENARIOS.map((s) => s.locale))).toEqual(new Set(['zh', 'en', 'fr']));
  });

  it('每项要求有三种语言的一句话，每个场景有 core 项', () => {
    for (const s of SCENARIOS) {
      expect(s.requirements.some((r) => r.core)).toBe(true);
      for (const r of s.requirements)
        for (const locale of ['zh', 'en', 'fr'] as const)
          expect(r.ask[locale].length, `${s.id}/${r.id}/${locale}`).toBeGreaterThan(4);
    }
  });

  it('每个场景都有至少 2 种建法，每项要求都有反例', () => {
    for (const s of SCENARIOS) {
      const plan = PLANS[s.id]!;
      expect(Object.keys(plan.builds).length, s.id).toBeGreaterThanOrEqual(2);
      expect(Object.keys(plan.without).sort(), s.id).toEqual(
        s.requirements.map((r) => r.id).sort(),
      );
    }
  });
});

describe.each(SCENARIOS.map((s) => [s.id, s] as const))('%s', (_id, s) => {
  const plan = PLANS[s.id]!;
  const [first] = Object.values(plan.builds) as [() => WorkspaceConfig];

  it('第一种建法：全部要求都过（可选项也过），没有 blocker', () => {
    const r = score(s, first());
    expect(r.requirements.filter((x) => !x.pass).map((x) => x.id)).toEqual([]);
    expect(r.qualified).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it.each(Object.entries(plan.builds).slice(1))('别的建法也合格：%s', (_name, build) => {
    const r = score(s, build());
    expect(r.missingCore).toEqual([]);
    expect(r.qualified).toBe(true);
  });

  it.each(s.requirements.map((r) => [r.id, r] as const))('缺 %s 就不过', (id, r) => {
    const config = first();
    const broken = changed(config, plan.without[id]!);
    expect(passOf(s, config, id)).toBe(true);
    expect(passOf(s, broken, id)).toBe(false);
    if (r.core) expect(score(s, broken).qualified).toBe(false);
  });

  it('新配置什么都不算过', () => {
    const r = score(s, createDefaultWorkspace(s.locale));
    expect(r.passed).toBe(0);
    expect(r.qualified).toBe(false);
  });
});

describe('todo-simple：用完成表标做完', () => {
  const s = SCENARIOS.find((x) => x.id === 'todo-simple')!;

  it('行按钮新建完成记录：能标做完；一次性任务完成后从 due 列表消失，也算藏起来', () => {
    const config = todoCompletions();
    expect(passOf(s, config, 'check-off')).toBe(true);
    expect(passOf(s, config, 'hide-done')).toBe(true);
  });

  it('列表不跟着完成记录变：能标做完，但没有藏起来', () => {
    const config = todoCompletions({ source: {} });
    expect(passOf(s, config, 'check-off')).toBe(true);
    expect(passOf(s, config, 'hide-done')).toBe(false);
  });

  it('按钮要用户选是哪一条（没有指回这一条）：不算', () => {
    const config = changed(todoCompletions(), (c) => {
      blockIn(c, 'list').tools[0].values = {};
    });
    expect(passOf(s, config, 'check-off')).toBe(false);
  });

  it('按钮要填东西（写评论也是这样连回来的）：不算', () => {
    const done = { values: { task: '$row' }, ask: 'all' };
    expect(passOf(s, todoCompletions({ done }), 'check-off')).toBe(false);
  });

  it('只有通知上的「完成」，列表上标不了：不算', () => {
    const config = changed(todoCompletions(), (c) => {
      delete blockIn(c, 'list').tools;
      c.tools.push(
        reminder('due', { each: { table: 'tasks', field: 'plan' }, at: '09:00' }, 'page:app', {
          done: { do: 'create', table: 'completions', values: { task: '$row' } },
        }),
      );
    });
    expect(passOf(s, config, 'check-off')).toBe(false);
  });

  it('按钮写的是这张表以外、没有连回来的表：不算', () => {
    const config = changed(todoCompletions(), (c) => {
      const t = tableIn(c, 'completions');
      t.fields = t.fields.map((f: Json) => (f.id === 'task' ? { ...text('task') } : f));
    });
    expect(passOf(s, config, 'check-off')).toBe(false);
  });
});

describe('money-budget：独立的目标表', () => {
  const s = SCENARIOS.find((x) => x.id === 'money-budget')!;

  it('一张表每条选分类、填金额，有添加入口：算有目标', () => {
    expect(passOf(s, budgetTable(), 'targets')).toBe(true);
  });

  it('没有目标时不过：只有支出表，什么目标都没有', () => {
    const config = app(
      addTable('expenses', [money(), choice('category', ['food', 'rent']), date()]),
      addPage('app', [form('add', 'expenses', ['amount', 'category'])]),
    );
    expect(passOf(s, config, 'targets')).toBe(false);
  });

  it('目标表加不进去（没有入口）：不算', () => {
    const config = changed(budgetTable(), (c) => dropBlock(c, 'add-budget'));
    expect(passOf(s, config, 'targets')).toBe(false);
  });

  it('目标表不分类（只有一个总额）：不算', () => {
    const config = changed(budgetTable(), (c) => {
      blockIn(c, 'add-budget').tools[0].ask = ['budget'];
    });
    expect(passOf(s, config, 'targets')).toBe(false);
  });

  it('金额填不了：不算', () => {
    const config = changed(budgetTable(), (c) => {
      blockIn(c, 'add-budget').tools[0].ask = ['category'];
    });
    expect(passOf(s, config, 'targets')).toBe(false);
  });

  it('分类和支出不是同一套：不算', () => {
    expect(passOf(s, budgetTable(['savings']), 'targets')).toBe(false);
  });
});

describe('接起来才算', () => {
  const streaks = SCENARIOS.find((s) => s.id === 'habit-streaks')!;

  it('连续天数读的不是圆块写的那张表：不算', () => {
    const config = changed(streaksNumber(), (c) => {
      tableIn(c, 'habits').fields.push({ id: 'd', name: 'd', type: 'date', default: 'today' });
      blockIn(c, 'streak').source = { table: 'habits', aggregate: 'streak' };
    });
    expect(passOf(streaks, config, 'streak')).toBe(false);
  });

  it('打卡的日子写不进去：连续天数不算', () => {
    const config = changed(streaksNumber(), (c) => {
      delete fieldIn(c, 'checkins', 'date').default;
    });
    expect(passOf(streaks, config, 'tap-checks-in')).toBe(false);
    expect(passOf(streaks, config, 'streak')).toBe(false);
  });

  it('习惯加不进去：圆块上永远没有东西，打卡不算', () => {
    const config = changed(streaksRollup(), (c) => dropBlock(c, 'add-habit'));
    expect(passOf(streaks, config, 'circles')).toBe(false);
    expect(passOf(streaks, config, 'tap-checks-in')).toBe(false);
  });

  it('提醒打开的页面看不到这张表：不算', () => {
    const config = changed(streaksRollup(), (c) => (toolIn(c, 'nine').opens = 'page:home'));
    expect(passOf(streaks, config, 'reminder-time')).toBe(false);
  });

  it('图表按日期算，日期写入口填不到：图表不算', () => {
    const s = SCENARIOS.find((x) => x.id === 'money-ledger')!;
    const config = changed(ledgerChoice(), (c) => delete fieldIn(c, 'expenses', 'date').default);
    expect(passOf(s, config, 'by-month')).toBe(false);
  });

  it('藏起来的、进不去的不算', () => {
    const s = SCENARIOS.find((x) => x.id === 'todo-board')!;
    expect(
      score(
        s,
        changed(boardChoice(), (c) => (blockIn(c, 'board').hidden = true)),
      ).qualified,
    ).toBe(false);
    expect(
      score(
        s,
        changed(boardChoice(), (c) => (c.nav.bar = ['page:home', 'settings'])),
      ).qualified,
    ).toBe(false);
  });

  it('快捷操作只在设置里：文件进不来', () => {
    const s = SCENARIOS.find((x) => x.id === 'file-receipt')!;
    const config = changed(receiptScan(), (c) => dropBlock(c, 'run-scan'));
    expect(passOf(s, config, 'capture')).toBe(false);
  });

  it('不绑定表名、字段 ID：全换掉照样过', () => {
    const rename = (json: string) =>
      json
        .replaceAll('habits', 'xiguan')
        .replaceAll('checkins', 'jilu')
        .replaceAll('"habit"', '"which"')
        .replaceAll('"streak"', '"lianxu"');
    // 聚合的值是枚举，换回来。
    const config = JSON.parse(
      rename(JSON.stringify(streaksRollup())).replaceAll(
        '"aggregate":"lianxu"',
        '"aggregate":"streak"',
      ),
    ) as WorkspaceConfig;
    const r = score(streaks, config);
    expect(r.qualified).toBe(true);
  });

  it('用户说的话按顺序：说过的先跳过', () => {
    const s = SCENARIOS.find((x) => x.id === 'todo-todoist')!;
    const r = score(s, createDefaultWorkspace('zh'));
    const first = nextAsk(s, r, new Set())!;
    expect(first.id).toBe('add-task');
    expect(first.text).toBe(s.requirements[0]!.ask.zh);
    expect(nextAsk(s, r, new Set(['add-task']))!.id).toBe('projects');
    expect(nextAsk(s, r, new Set(r.missingCore))!.id).toBe('add-task');
    expect(nextAsk(s, score(s, todoistCompletions()), new Set())).toBeNull();
  });
});

describe('工具检查：统计依赖的字段（REPORT3 读书图表的例子）', () => {
  const stat = (config: WorkspaceConfig) =>
    checkTools(config, registry).issues.filter((i) => i.code.startsWith('stat-'));
  const reading = (ask: string[], extra: object[] = []) =>
    app(
      addTable('books', [
        text('title'),
        { id: 'finished', name: 'finished', type: 'date' },
        choice('genre', ['a', 'b']),
        money('price'),
      ]),
      addPage('app', [
        form('add', 'books', ask),
        records('cards', 'covers', 'books', 'title', {
          tools: [{ as: 'button', label: 'Open', opens: 'record' }],
        }),
        ...extra,
      ]),
    );
  const noEditor = (config: WorkspaceConfig) =>
    changed(config, (c) => {
      const covers = blockIn(c, 'covers');
      covers.look = 'tiles';
      covers.tools = [
        { as: 'tap', label: 'x', do: 'set', table: 'books', field: 'genre', value: 'a' },
      ];
    });
  const byMonth = chart('per-month', 'books', 'bar', {
    aggregate: 'count',
    group: { unit: 'month', by: 'finished' },
  });

  it('按完成日期统计，写入口和编辑页都填不到：统计永远是空的，blocker', () => {
    const issues = stat(noEditor(reading(['title'], [byMonth])));
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'blocker',
        code: 'stat-input-missing',
        target: 'block:app/per-month',
      }),
    ]);
    expect(issues[0]!.message).toMatch(/books\.finished/);
  });

  it('表单不问，但能打开一条再填：不是永远空，warning', () => {
    const issues = stat(reading(['title'], [byMonth]));
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'stat-input-only-in-editor' }),
    ]);
  });

  it.each([
    ['表单问', reading(['title', 'finished'], [byMonth])],
    [
      '按钮预设',
      reading(
        ['title'],
        [
          byMonth,
          button('finish', { do: 'create', table: 'books', values: { finished: 'today' } }),
        ],
      ),
    ],
    [
      '完整表单',
      reading(['title'], [byMonth, button('full', { do: 'create', table: 'books', ask: 'all' })]),
    ],
    [
      '每一条上的按钮写',
      changed(reading(['title'], [byMonth]), (c) => {
        blockIn(c, 'covers').tools = [
          {
            as: 'button',
            label: 'Finish',
            do: 'set',
            table: 'books',
            field: 'finished',
            value: 'today',
          },
        ];
      }),
    ],
    [
      '有默认值',
      changed(reading(['title'], [byMonth]), (c) => {
        fieldIn(c, 'books', 'finished').default = 'today';
      }),
    ],
  ])('%s：没有问题', (_name, config) => {
    expect(stat(config)).toEqual([]);
  });

  it.each([
    ['求和的金额', number('n', 'books', { aggregate: 'sum', field: 'price' })],
    [
      '要有值才成立的筛选',
      number('n', 'books', {
        aggregate: 'count',
        filter: [{ field: 'finished', op: 'inPeriod', value: 'thisMonth' }],
      }),
    ],
    ['连续天数的日子', number('n', 'books', { aggregate: 'streak', days: { date: 'finished' } })],
  ])('%s填不到：blocker', (_name, block) => {
    expect(stat(noEditor(reading(['title'], [block])))).toEqual([
      expect.objectContaining({ severity: 'blocker', code: 'stat-input-missing' }),
    ]);
  });

  it('只影响分组（全在「未设置」）、空着也成立的筛选：不是空的', () => {
    const grouped = number('n', 'books', { aggregate: 'count', group: { by: 'genre' } });
    expect(stat(noEditor(reading(['title'], [grouped])))).toEqual([]);
    const unset = chart('pie', 'books', 'pie', { aggregate: 'count', group: { by: 'genre' } });
    const onlyByChoice = noEditor(reading(['title'], [unset]));
    const noTapWrite = changed(onlyByChoice, (c) => {
      blockIn(c, 'covers').tools = [
        { as: 'tap', label: 'x', do: 'set', table: 'books', field: 'title', value: null },
      ];
    });
    expect(stat(noTapWrite)).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'stat-input-unfilled' }),
    ]);
    const empty = number('n', 'books', {
      aggregate: 'count',
      filter: [{ field: 'finished', op: 'isEmpty' }],
    });
    expect(stat(noEditor(reading(['title'], [empty])))).toEqual([]);
  });

  it('样板和模版没有误报', () => {
    const configs: WorkspaceConfig[] = [];
    for (const locale of ['en', 'zh', 'fr'] as const) {
      for (const sample of [
        'expense-helper',
        'visa-docs',
        'study-helper',
        'shop-orders',
        'baby-growth',
      ] as const)
        configs.push(fromSample(sample, locale));
      for (const template of [
        'budget',
        'todo',
        'reading',
        'notes',
        'purchase',
        'bill',
        'contract',
        'reimbursement',
        'blank',
      ] as const)
        configs.push(fromTemplate(template, locale));
    }
    for (const config of configs) expect(stat(config)).toEqual([]);
  });
});
