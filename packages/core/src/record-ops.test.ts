import { describe, expect, it } from 'vitest';

import { prepareRecordValues, type DataRecord } from './data';
import {
  MAX_SET_ALL,
  createInput,
  createPrefill,
  rowUpdateInput,
  setAllChanges,
  shownRowAction,
  type RecordTool,
  type ToolUse,
} from './record-ops';
import type { Collection, WorkspaceConfig } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';

// 一键记录工具（D-300–D-304，v34 就地的工具）。
process.env.TZ = 'Europe/Paris';

const now = new Date(2026, 9, 29, 18, 5);

const habits: Collection = {
  id: 'checkins',
  name: 'Check-ins',
  fields: [
    {
      id: 'habit',
      name: 'Habit',
      type: 'choice',
      required: true,
      options: [
        { id: 'run', label: 'Run' },
        { id: 'read', label: 'Read' },
      ],
    },
    { id: 'day', name: 'Day', type: 'date', required: true },
    { id: 'note', name: 'Note', type: 'text' },
  ],
};
const water: Collection = {
  id: 'water',
  name: 'Water',
  fields: [
    { id: 'glasses', name: 'Glasses', type: 'number' },
    { id: 'day', name: 'Day', type: 'date', default: 'today' },
  ],
};
const shifts: Collection = {
  id: 'shifts',
  name: 'Shifts',
  fields: [
    { id: 'start', name: 'Start', type: 'datetime' },
    { id: 'end', name: 'End', type: 'datetime' },
    { id: 'clock', name: 'Clock', type: 'time' },
    { id: 'break', name: 'Break', type: 'duration' },
    { id: 'pay', name: 'Pay', type: 'money', currency: 'EUR' },
    { id: 'hours', name: 'Hours', type: 'formula', expression: '{break} * 2' },
  ],
};
const packing: Collection = {
  id: 'packing',
  name: 'Packing',
  fields: [
    { id: 'item', name: 'Item', type: 'text' },
    { id: 'packed', name: 'Packed', type: 'checkbox' },
    {
      id: 'bag',
      name: 'Bag',
      type: 'choice',
      options: [
        { id: 'carry', label: 'Carry-on' },
        { id: 'hold', label: 'Hold' },
      ],
    },
  ],
};
const habitList: Collection = {
  id: 'habits',
  name: 'Habits',
  fields: [{ id: 'name', name: 'Name', type: 'text' }],
};
const linkedCheckins: Collection = {
  id: 'logs',
  name: 'Logs',
  fields: [
    { id: 'habit', name: 'Habit', type: 'link', table: 'habits' },
    { id: 'day', name: 'Day', type: 'date' },
  ],
};

const TABLES = [habits, water, shifts, packing, habitList, linkedCheckins];

const base = (): WorkspaceConfig => {
  const config = fromV33(v33Fixture('default-en'));
  config.data.tables.push(...structuredClone(TABLES));
  return config;
};

const button = (tool: unknown, id = 'b1') => ({
  id,
  look: 'button',
  show: { label: 'Go', variant: 'filled' },
  tools: [tool],
});
const list = (table: string, tools: unknown[], id = 'l1', look = 'list') => ({
  id,
  look,
  source: { table, limit: 30 },
  show: { title: table === 'packing' ? 'item' : 'createdAt' },
  tools,
});

/** 把块放到首页（或者 page 指定的页面）上，返回校验问题的文字。 */
function problems(blocks: unknown[], config: WorkspaceConfig = base(), pageId = 'home'): string {
  const copy = structuredClone(config);
  copy.containers.pages.find((p) => p.id === pageId)!.blocks.push(...(blocks as never[]));
  const r = validateWorkspace(copy, registry);
  return r.ok ? '' : r.issues.map((i) => i.message).join('\n');
}

describe('checking record tools', () => {
  it('accepts the typical set-ups', () => {
    expect(
      problems([
        // 一键打卡、喝水 +1、上班、旅行清单一键清空、打开新记录表单。
        button({ do: 'create', table: 'checkins', values: { habit: 'run', day: 'today' } }),
        button({ do: 'create', table: 'water', values: { glasses: 1 } }, 'b2'),
        button({ do: 'create', table: 'shifts', values: { start: 'now' } }, 'b3'),
        button(
          {
            do: 'setAll',
            table: 'packing',
            filter: [{ field: 'bag', op: 'is', value: 'carry' }],
            field: 'packed',
            value: false,
          },
          'b4',
        ),
        button({ do: 'create', table: 'checkins', ask: 'all' }, 'b5'),
        // 下班（结束为空时）、+1、标记、打卡这一行的习惯、打开这一条。
        list('shifts', [
          {
            as: 'button',
            label: 'Clock out',
            do: 'set',
            table: 'shifts',
            field: 'end',
            value: 'now',
            when: [{ field: 'end', op: 'isEmpty' }],
          },
          {
            as: 'button',
            label: '+15 min',
            do: 'increment',
            table: 'shifts',
            field: 'break',
            by: 15,
          },
          { as: 'button', label: 'Edit', opens: 'record' },
          { as: 'addHere', do: 'create', table: 'shifts', ask: 'all', values: '$here' },
        ]),
        list(
          'packing',
          [{ as: 'check', do: 'toggle', table: 'packing', field: 'packed' }],
          'l2',
          'checklist',
        ),
        list(
          'habits',
          [
            {
              as: 'tap',
              label: 'Done',
              do: 'create',
              table: 'logs',
              values: { habit: '$row', day: 'today' },
            },
          ],
          'l3',
          'tiles',
        ),
      ]),
    ).toBe('');
  });

  it('text is never preset: it is the user’s content (D-042)', () => {
    expect(
      problems([
        button({
          do: 'create',
          table: 'checkins',
          values: { habit: 'run', day: 'today', note: 'x' },
        }),
      ]),
    ).toMatch(/checkins\.note is a text field and can't be set by a button/);
    // 结构上就不允许任意文字（不是 ID 的写法）。
    expect(
      problems([button({ do: 'create', table: 'water', values: { glasses: 'Two glasses!' } })]),
    ).not.toBe('');
  });

  it('values must match the field type, with messages the AI can act on', () => {
    const p = problems([
      button({ do: 'create', table: 'checkins', values: { habit: 'swim', day: 'now' } }),
    ]);
    expect(p).toMatch(
      /checkins\.habit is a choice field; the value must be one of its option ids \(run, read\)/,
    );
    expect(p).toMatch(/checkins\.day is a date field, so the value must be "today" or null/);
    const set = (field: string, value: unknown) =>
      problems([
        list('shifts', [{ as: 'button', label: 'X', do: 'set', table: 'shifts', field, value }]),
      ]);
    expect(set('clock', 'today')).toMatch(
      /shifts\.clock is a time field, so the value must be "now" or null/,
    );
    expect(set('hours', 3)).toMatch(/hours is a formula field and can't be set/);
    expect(set('gone', 1)).toMatch(/gone is not a field of shifts \(fields: start, end/);
    expect(set('pay', '$row')).toMatch(
      /"\$row" only works on a link field, but shifts\.pay is a money field/,
    );
    expect(problems([button({ do: 'create', table: 'nope' })])).toMatch(
      /data table nope does not exist/,
    );
  });

  it('increment only works on number, money and duration; toggle only on a checkbox', () => {
    const one = (tool: Record<string, unknown>) =>
      problems([list('packing', [{ as: 'button', label: 'X', table: 'packing', ...tool }])]);
    expect(one({ do: 'increment', field: 'packed', by: 1 })).toMatch(
      /increment needs a number or money or duration field, but packing\.packed is checkbox/,
    );
    expect(one({ do: 'toggle', field: 'bag' })).toMatch(/toggle needs a checkbox field/);
    expect(
      problems([
        list('shifts', [
          { as: 'button', label: '0', do: 'increment', table: 'shifts', field: 'pay', by: 0 },
        ]),
      ]),
    ).not.toBe('');
  });

  it('a create that would leave a required field empty is rejected', () => {
    expect(
      problems([button({ do: 'create', table: 'checkins', values: { habit: 'run' } })]),
    ).toMatch(
      /required field day would be empty; preset it, make it not required, or add ask: "all"/,
    );
  });

  it('create with ask "all" opens the form with the presets, so required fields may stay empty', () => {
    expect(
      problems([
        button({ do: 'create', table: 'checkins', values: { habit: 'run' }, ask: 'all' }),
        list('habits', [
          {
            as: 'button',
            label: 'Log',
            do: 'create',
            table: 'logs',
            values: { habit: '$row' },
            ask: 'all',
          },
        ]),
      ]),
    ).toBe('');
    // 预设的值照样检查。
    expect(
      problems([
        button({ do: 'create', table: 'checkins', values: { habit: 'swim' }, ask: 'all' }),
      ]),
    ).toMatch(/must be one of its option ids/);
  });

  it('ask: [fields] and smartDate only work in a form block', () => {
    expect(problems([button({ do: 'create', table: 'shifts', ask: ['start'] })])).toMatch(
      /ask: \[fields\] only works in a form block; use ask: "all"/,
    );
    expect(
      problems([
        button({
          do: 'create',
          table: 'shifts',
          ask: 'all',
          smartDate: { from: 'pay', to: 'start' },
        }),
      ]),
    ).toMatch(/smartDate only works in a form block/);
    const form = (smartDate: unknown) => ({
      id: 'f1',
      look: 'form',
      show: { mode: 'inline' },
      tools: [
        { as: 'submit', label: 'Add', do: 'create', table: 'packing', ask: ['item'], smartDate },
      ],
    });
    expect(problems([form({ from: 'item', to: 'bag' })])).toMatch(
      /smartDate\.to bag must be a date, datetime or schedule field of packing/,
    );
    expect(problems([form({ from: 'bag', to: 'bag' })])).toMatch(
      /smartDate\.from bag must be a text field listed in ask/,
    );
  });

  it('"$row" is only for a create on each entry, on a link to the block’s table', () => {
    expect(problems([button({ do: 'create', table: 'logs', values: { habit: '$row' } })])).toMatch(
      /link field logs\.habit can't be preset/,
    );
    expect(
      problems([
        list('water', [
          { as: 'button', label: 'Log', do: 'create', table: 'logs', values: { habit: '$row' } },
        ]),
      ]),
    ).toMatch(/must point at water/);
  });

  it('"$record" works on a page for one entry, for a link to that table', () => {
    const withPage = base();
    withPage.containers.pages.push({ id: 'habit', title: 'Habit', of: 'habits', blocks: [] });
    const log = button({ do: 'create', table: 'logs', values: { habit: '$record', day: 'today' } });
    expect(problems([log], withPage, 'habit')).toBe('');
    expect(problems([log])).toMatch(/"\$record" only works on a page for one entry/);
  });

  it('setAll filters and button conditions are checked like block filters', () => {
    expect(
      problems([
        button({
          do: 'setAll',
          table: 'packing',
          filter: [{ field: 'bag', op: 'is', value: 'boot' }],
          field: 'packed',
          value: false,
        }),
      ]),
    ).toMatch(/filter on bag: value does not match/);
    expect(
      problems([
        list('shifts', [
          {
            as: 'button',
            label: 'Out',
            do: 'set',
            table: 'shifts',
            field: 'end',
            value: 'now',
            when: [{ field: 'nope', op: 'isEmpty' }],
          },
        ]),
      ]),
    ).toMatch(/list l1 button "Out" when: filter field nope/);
  });

  it('a done button on a schedule’s last-done date must not hide once it is set', () => {
    // 每周的事点过一次就不再有按钮，下周没法完成（真搭 Todoist 样板时 AI 写过）。
    const todos = base();
    todos.data.tables.push({
      id: 'todos',
      name: 'To-dos',
      fields: [
        { id: 'title', name: 'Title', type: 'text', required: true },
        { id: 'done', name: 'Done on', type: 'date' },
        {
          id: 'plan',
          name: 'Plan',
          type: 'schedule',
          default: { repeat: 'once' },
          lastDone: 'done',
        },
      ],
    });
    const done = (when?: unknown) =>
      list('todos', [
        {
          as: 'button',
          label: 'Done',
          do: 'set',
          table: 'todos',
          field: 'done',
          value: 'today',
          ...(when ? { when } : {}),
        },
      ]);
    expect(problems([done([{ field: 'done', op: 'isEmpty' }])], todos)).toMatch(
      /button "Done": done is the last-done date of plan.*drop the when/,
    );
    expect(problems([done()], todos)).toBe('');
  });

  it('labels: a button or tap on each entry needs one (≤20); a form submit may have 30', () => {
    const set = { do: 'toggle', table: 'packing', field: 'packed' };
    expect(problems([list('packing', [{ as: 'button', ...set }])])).toMatch(/needs a label/);
    expect(
      problems([list('packing', [{ as: 'button', label: 'A label that is too long', ...set }])]),
    ).toMatch(/label can be at most 20 characters/);
    const form = (label: string) => ({
      id: 'f1',
      look: 'form',
      show: { mode: 'inline' },
      tools: [{ as: 'submit', label, do: 'create', table: 'packing', ask: ['item'] }],
    });
    expect(problems([form('Add it to the packing list')])).toBe('');
  });

  it('when only applies to a button or tap on each entry', () => {
    expect(
      problems([
        button({
          do: 'create',
          table: 'water',
          values: { glasses: 1 },
          when: [{ field: 'glasses', op: 'isEmpty' }],
        }),
      ]),
    ).toMatch(/when only applies to a button or tap/);
  });

  it('each look takes only its own kinds of tools, and how many (registry metadata)', () => {
    // 按钮上不能 toggle（没有「这一条」），列表上不能 setAll。
    expect(problems([button({ do: 'toggle', table: 'packing', field: 'packed' })])).toMatch(
      /a button block can't have a toggle tool \(allowed: create, setAll\)/,
    );
    expect(
      problems([
        list('packing', [
          {
            as: 'button',
            label: 'All',
            do: 'setAll',
            table: 'packing',
            field: 'packed',
            value: false,
          },
        ]),
      ]),
    ).toMatch(/a list block can't have a setAll tool/);
    // 列表上没有 check、drag。
    expect(
      problems([
        list('packing', [{ as: 'check', do: 'toggle', table: 'packing', field: 'packed' }]),
      ]),
    ).toMatch(/as "check" doesn't fit a list block/);
    // 每一条右边最多 3 个按钮；就地添加最多 1 个。
    const b = (label: string) => ({
      as: 'button',
      label,
      do: 'toggle',
      table: 'packing',
      field: 'packed',
    });
    expect(problems([list('packing', [b('a'), b('b'), b('c'), b('d')])])).toMatch(
      /at most 3 tools as "button" \(now 4\)/,
    );
    const here = { as: 'addHere', do: 'create', table: 'packing', ask: 'all', values: '$here' };
    expect(problems([list('packing', [here, here])])).toMatch(/at most 1 tool as "addHere"/);
  });

  it('a checklist has exactly one check toggling a checkbox; a board drags into its group field', () => {
    expect(
      problems([
        list(
          'packing',
          [{ as: 'button', label: 'Pack', do: 'toggle', table: 'packing', field: 'packed' }],
          'c1',
          'checklist',
        ),
      ]),
    ).toMatch(/a checklist needs exactly one tool \{as: "check"/);
    expect(
      problems([
        list(
          'packing',
          [{ as: 'check', do: 'set', table: 'packing', field: 'packed', value: true }],
          'c1',
          'checklist',
        ),
      ]),
    ).toMatch(/the check of a checklist is \{do: "toggle"/);
    const board = (tool: unknown) => ({
      id: 'k1',
      look: 'board',
      source: { table: 'packing', limit: 30, group: { by: 'bag' } },
      show: { title: 'item' },
      tools: [tool],
    });
    expect(
      problems([board({ as: 'drag', do: 'set', table: 'packing', field: 'bag', value: '$group' })]),
    ).toBe('');
    expect(
      problems([board({ as: 'drag', do: 'set', table: 'packing', field: 'packed', value: true })]),
    ).toMatch(
      /dragging a card to another column is \{as: "drag", do: "set", table, field: bag, value: "\$group"\}/,
    );
    // $group 只给拖动。
    expect(
      problems([
        board({
          as: 'button',
          label: 'X',
          do: 'set',
          table: 'packing',
          field: 'bag',
          value: '$group',
        }),
      ]),
    ).toMatch(/"\$group" .* only works in a board's/);
  });

  it('addHere is a create in the block’s table with values "$here"; "$here" is only for addHere', () => {
    expect(
      problems([list('packing', [{ as: 'addHere', do: 'create', table: 'packing', ask: 'all' }])]),
    ).toMatch(/addHere adds an entry right in this section/);
    expect(
      problems([button({ do: 'create', table: 'packing', ask: 'all', values: '$here' })]),
    ).toMatch(/values "\$here" only works with as: "addHere"/);
  });

  it('a row button that opens an entry opens its editor or a page for one entry of that table', () => {
    const withPage = base();
    withPage.containers.pages.push({ id: 'shift', title: 'Shift', of: 'shifts', blocks: [] });
    const open = (opens: string, table = 'shifts') =>
      list(table, [{ as: 'button', label: 'Open', opens }]);
    expect(problems([open('record')], withPage)).toBe('');
    expect(problems([open('shift')], withPage)).toBe('');
    expect(problems([open('home')], withPage)).toMatch(
      /opens home must be a page for one entry of shifts/,
    );
    expect(problems([open('nope')], withPage)).toMatch(/opens nope is not a page/);
  });
});

describe('relation rule 12: a tool on a block writes the block’s own table', () => {
  it('rejects a check that toggles a field of another table', () => {
    const todos = base();
    todos.data.tables.push({
      id: 'todos',
      name: 'To-dos',
      fields: [
        { id: 'title', name: 'Title', type: 'text' },
        { id: 'done', name: 'Done', type: 'checkbox' },
      ],
    });
    expect(
      problems(
        [
          list(
            'todos',
            [{ as: 'check', do: 'toggle', table: 'packing', field: 'packed' }],
            'c1',
            'checklist',
          ),
        ],
        todos,
      ),
    ).toMatch(
      /toggle changes this entry \("\$row", an entry of todos\), so table must be todos, not packing/,
    );
    expect(
      problems(
        [
          list(
            'todos',
            [{ as: 'check', do: 'toggle', table: 'todos', field: 'done' }],
            'c1',
            'checklist',
          ),
        ],
        todos,
      ),
    ).toBe('');
  });

  it('set and increment act on this entry, so their table is the source table', () => {
    expect(
      problems([
        list('water', [
          { as: 'button', label: '+1', do: 'increment', table: 'shifts', field: 'pay', by: 1 },
        ]),
      ]),
    ).toMatch(/so table must be water, not shifts/);
  });

  it('a create in another table is allowed only when it links back to this entry', () => {
    expect(
      problems([
        list(
          'habits',
          [
            {
              as: 'tap',
              label: 'Run',
              do: 'create',
              table: 'checkins',
              values: { habit: 'run', day: 'today' },
            },
          ],
          'l1',
          'tiles',
        ),
      ]),
    ).toMatch(/creates an entry in checkins, but this block shows habits/);
    expect(
      problems([
        list(
          'habits',
          [{ as: 'tap', label: 'Done', do: 'create', table: 'logs', values: { habit: '$row' } }],
          'l1',
          'tiles',
        ),
      ]),
    ).toBe('');
  });

  it('on a page for one entry, a block may create in another table linked to "$record"', () => {
    const withPage = base();
    withPage.containers.pages.push({ id: 'habit', title: 'Habit', of: 'habits', blocks: [] });
    const block = list('water', [
      {
        as: 'button',
        label: 'Log',
        do: 'create',
        table: 'logs',
        values: { habit: '$record' },
        ask: 'all',
      },
    ]);
    expect(problems([block], withPage, 'habit')).toBe('');
  });

  it('a button or a form has no source: it writes its own table', () => {
    expect(problems([button({ do: 'create', table: 'water', values: { glasses: 1 } })])).toBe('');
    expect(
      problems([
        {
          id: 'f1',
          look: 'form',
          show: { mode: 'sheet' },
          tools: [{ as: 'submit', label: 'Add', do: 'create', table: 'packing', ask: ['item'] }],
        },
      ]),
    ).toBe('');
  });
});

describe('Q6: the "add" button prefills its preset values', () => {
  it('a v33 recordForm in button mode keeps its values and v34 prefills them', () => {
    const config = fromV33({
      ...v33Fixture('default-en'),
      collections: [
        {
          id: 'checkins',
          name: 'Check-ins',
          fields: [
            { id: 'habit', name: 'Habit', type: 'choice', options: [{ id: 'run', label: 'Run' }] },
            { id: 'day', name: 'Day', type: 'date' },
          ],
        },
      ],
      pages: [
        {
          id: 'home',
          title: 'Home',
          components: [
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: 'checkins',
                fieldIds: ['habit'],
                submitLabel: 'Log a run',
                mode: 'button',
                values: { habit: 'run', day: 'today' },
              },
            },
          ],
        },
      ],
    });
    expect(validateWorkspace(config, registry).ok).toBe(true);
    const block = config.containers.pages[0]!.blocks[0] as { look: string; tools: RecordTool[] };
    expect(block.look).toBe('button');
    const tool = block.tools[0]!;
    if (tool.do !== 'create') throw new Error('expected a create');
    // v33 的按钮模式打开的是空表单（忽略 values）；v34 先填好。
    expect(createPrefill(tool, { config, now })).toEqual({ habit: 'run', day: '2026-10-29' });
  });

  it('prefills nothing for "$here" (the app fills the section values) or a missing table', () => {
    const config = base();
    expect(
      createPrefill({ do: 'create', table: 'water', ask: 'all', values: '$here' }, { config, now }),
    ).toEqual({});
    expect(
      createPrefill({ do: 'create', table: 'gone', ask: 'all', values: { x: 1 } }, { config, now }),
    ).toEqual({});
  });
});

describe('running record actions', () => {
  const record = (values: Record<string, unknown>, id = 'r1abcdef'): DataRecord => ({
    id,
    collectionId: 'x',
    values,
    createdAt: 0,
    updatedAt: 0,
  });

  it('create fills today, now, options and numbers; the rest gets form defaults', () => {
    const input = createInput(habits, { habit: 'run', day: 'today' }, { now });
    expect(input).toEqual({ habit: 'run', day: '2026-10-29' });
    const prepared = prepareRecordValues(
      water,
      createInput(water, { glasses: 1 }, { now }),
      null,
      now,
    );
    expect(prepared).toEqual({ ok: true, values: { glasses: 1, day: '2026-10-29' } });
    expect(createInput(shifts, { start: 'now' }, { now })).toEqual({ start: '2026-10-29T18:05' });
    // 一天从凌晨 4 点开始时，凌晨 2 点打卡算前一天（D-286）。
    const late = new Date(2026, 9, 30, 2, 0);
    expect(
      createInput(
        habits,
        { day: 'today' },
        { now: late, cal: { dayStartHour: 4, weekStart: 'monday' } },
      ),
    ).toEqual({ day: '2026-10-29' });
    // 「这一条」（$row）和记录页的那一条（$record）。
    expect(createInput(linkedCheckins, { habit: '$row' }, { now, rowId: 'h1abcdef' })).toEqual({
      habit: 'h1abcdef',
    });
  });

  it('set now, set null, toggle and increment', () => {
    expect(
      rowUpdateInput({ do: 'set', table: 'x', field: 'end', value: 'now' }, shifts, {}, { now }),
    ).toEqual({
      end: '2026-10-29T18:05',
    });
    expect(
      rowUpdateInput({ do: 'set', table: 'x', field: 'clock', value: 'now' }, shifts, {}, { now }),
    ).toEqual({
      clock: '18:05',
    });
    expect(
      rowUpdateInput({ do: 'set', table: 'x', field: 'end', value: null }, shifts, {}, { now }),
    ).toEqual({
      end: '',
    });
    expect(
      rowUpdateInput({ do: 'toggle', table: 'x', field: 'packed' }, packing, {}, { now }),
    ).toEqual({
      packed: true,
    });
    expect(
      rowUpdateInput(
        { do: 'toggle', table: 'x', field: 'packed' },
        packing,
        { packed: true },
        { now },
      ),
    ).toEqual({ packed: false });
    const inc = (fieldId: string, by: number, values: Record<string, unknown>) =>
      rowUpdateInput({ do: 'increment', table: 'shifts', field: fieldId, by }, shifts, values, {
        now,
      });
    // 空的从 0 开始；金额两位小数；时长不会减成负数。
    expect(inc('pay', 0.1, {})).toEqual({ pay: 0.1 });
    expect(inc('pay', 0.2, { pay: 0.1 })).toEqual({ pay: 0.3 });
    expect(inc('break', -15, { break: 10 })).toEqual({ break: 0 });
    expect(
      rowUpdateInput(
        { do: 'increment', table: 'x', field: 'glasses', by: 1 },
        water,
        { glasses: 7 },
        { now },
      ),
    ).toEqual({ glasses: 8 });
    // 字段已经不在了（旧配置）：什么也不做。
    expect(
      rowUpdateInput({ do: 'toggle', table: 'x', field: 'gone' }, packing, {}, { now }),
    ).toBeNull();
  });

  it('a row shows the first button whose conditions match', () => {
    const actions: ToolUse[] = [
      { as: 'addHere', do: 'create', table: 'shifts', ask: 'all', values: '$here' },
      {
        as: 'button',
        label: 'Clock out',
        do: 'set',
        table: 'shifts',
        field: 'end',
        value: 'now',
        when: [{ field: 'end', op: 'isEmpty' }],
      },
      { as: 'button', label: 'Edit', opens: 'record', when: [{ field: 'end', op: 'isNotEmpty' }] },
    ];
    expect(shownRowAction(actions, record({ start: '2026-10-29T09:00' }), shifts, now)?.label).toBe(
      'Clock out',
    );
    expect(
      shownRowAction(
        actions,
        record({ start: '2026-10-29T09:00', end: '2026-10-29T17:00' }),
        shifts,
        now,
      )?.label,
    ).toBe('Edit');
    expect(
      shownRowAction([actions[1]!], record({ end: '2026-10-29T17:00' }), shifts, now),
    ).toBeUndefined();
    expect(shownRowAction(undefined, record({}), shifts, now)).toBeUndefined();
  });

  it('setAll only changes the matching entries whose value differs, and keeps the old values for undo', () => {
    const records = [
      record({ item: 'Passport', packed: true, bag: 'carry' }, 'p1aaaaaa'),
      record({ item: 'Charger', packed: false, bag: 'carry' }, 'p2aaaaaa'),
      record({ item: 'Boots', packed: true, bag: 'hold' }, 'p3aaaaaa'),
      record({ item: 'Socks', bag: 'carry' }, 'p4aaaaaa'),
    ];
    const changes = setAllChanges(
      {
        do: 'setAll',
        table: 'packing',
        filter: [{ field: 'bag', op: 'is', value: 'carry' }],
        field: 'packed',
        value: false,
      },
      packing,
      packing,
      records,
      { now },
    );
    expect(changes).toEqual([
      {
        id: 'p1aaaaaa',
        before: { item: 'Passport', packed: true, bag: 'carry' },
        after: { item: 'Passport', packed: false, bag: 'carry' },
      },
    ]);
    // 不写筛选：整张表。
    expect(
      setAllChanges(
        { do: 'setAll', table: 'packing', field: 'packed', value: true },
        packing,
        packing,
        records,
        { now },
      ).map((c) => c.id),
    ).toEqual(['p2aaaaaa', 'p4aaaaaa']);
  });

  it('setAll has a cap the app enforces before asking', () => {
    expect(MAX_SET_ALL).toBe(200);
  });
});
