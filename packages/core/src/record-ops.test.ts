import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { prepareRecordValues, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import {
  MAX_SET_ALL,
  createInput,
  rowUpdateInput,
  setAllChanges,
  shownRowAction,
  type RowAction,
} from './record-ops';
import type { Collection, WorkspaceConfig } from './schema';
import { apply, registry } from './test-helpers';

// 一键记录操作（D-297–D-301）。
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
    { id: 'habit', name: 'Habit', type: 'link', collectionId: 'habits' },
    { id: 'day', name: 'Day', type: 'date' },
  ],
};

const base = () =>
  apply(createDefaultWorkspace('en'), [
    ...[habits, water, shifts, packing, habitList, linkedCheckins].map((collection) => ({
      op: 'addCollection' as const,
      collection,
    })),
  ]);

const button = (action: unknown, id = 'b1') => ({
  op: 'addComponent',
  pageId: 'home',
  component: { id, type: 'button', props: { label: 'Go', variant: 'filled', action } },
});
const list = (collectionId: string, rowActions: unknown, id = 'l1') => ({
  op: 'addComponent',
  pageId: 'home',
  component: {
    id,
    type: 'recordList',
    props: {
      collectionId,
      display: 'list',
      titleField: collectionId === 'packing' ? 'item' : 'createdAt',
      limit: 30,
      rowActions,
    },
  },
});

function problems(ops: unknown[], config: WorkspaceConfig = base()): string {
  const r = prepareOps(config, ops, { registry, locale: 'en', now });
  return r.ok ? '' : r.issues.join('\n');
}

describe('checking record actions', () => {
  it('accepts the typical set-ups', () => {
    expect(
      problems([
        // 一键打卡、喝水 +1、上班、旅行清单一键清空、打开新记录表单。
        button({ do: 'create', collectionId: 'checkins', values: { habit: 'run', day: 'today' } }),
        button({ do: 'create', collectionId: 'water', values: { glasses: 1 } }, 'b2'),
        button({ do: 'create', collectionId: 'shifts', values: { start: 'now' } }, 'b3'),
        button(
          {
            do: 'setAll',
            collectionId: 'packing',
            filter: [{ field: 'bag', op: 'is', value: 'carry' }],
            fieldId: 'packed',
            value: false,
          },
          'b4',
        ),
        button({ do: 'open', collectionId: 'checkins' }, 'b5'),
        // 下班（结束为空时）、+1、标记、打卡这一行的习惯。
        list('shifts', [
          {
            label: 'Clock out',
            do: 'set',
            fieldId: 'end',
            value: 'now',
            when: [{ field: 'end', op: 'isEmpty' }],
          },
          { label: '+15 min', do: 'increment', fieldId: 'break', by: 15 },
        ]),
        list('packing', [{ label: 'Packed', do: 'toggle', fieldId: 'packed' }], 'l2'),
        list(
          'habits',
          [
            {
              label: 'Done',
              do: 'create',
              collectionId: 'logs',
              values: { habit: 'row', day: 'today' },
            },
          ],
          'l3',
        ),
      ]),
    ).toBe('');
  });

  it('a button has exactly one of target or action', () => {
    expect(
      problems([
        {
          op: 'addComponent',
          pageId: 'home',
          component: { id: 'b', type: 'button', props: { label: 'Go', variant: 'filled' } },
        },
      ]),
    ).toMatch(/needs exactly one of target .* or action/);
    expect(
      problems([
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'b',
            type: 'button',
            props: {
              label: 'Go',
              variant: 'filled',
              target: 'settings',
              action: { do: 'open', collectionId: 'water' },
            },
          },
        },
      ]),
    ).toMatch(/exactly one/);
  });

  it('text is never preset: it is the user’s content (D-042)', () => {
    expect(
      problems([
        button({
          do: 'create',
          collectionId: 'checkins',
          values: { habit: 'run', day: 'today', note: 'x' },
        }),
      ]),
    ).toMatch(/checkins\.note is a text field and can't be set by a button/);
    // 结构上就不允许任意文字（不是 ID 的写法）。
    expect(
      problems([
        button({ do: 'create', collectionId: 'water', values: { glasses: 'Two glasses!' } }),
      ]),
    ).not.toBe('');
  });

  it('values must match the field type, with messages the AI can act on', () => {
    const p = problems([
      button({ do: 'create', collectionId: 'checkins', values: { habit: 'swim', day: 'now' } }),
    ]);
    expect(p).toMatch(
      /checkins\.habit is a choice field; the value must be one of its option ids \(run, read\)/,
    );
    expect(p).toMatch(/checkins\.day is a date field, so the value must be "today" or null/);
    expect(
      problems([list('shifts', [{ label: 'Out', do: 'set', fieldId: 'clock', value: 'today' }])]),
    ).toMatch(/shifts\.clock is a time field, so the value must be "now" or null/);
    expect(
      problems([list('shifts', [{ label: 'Pay', do: 'set', fieldId: 'hours', value: 3 }])]),
    ).toMatch(/hours is a formula field and can't be set/);
    expect(problems([button({ do: 'create', collectionId: 'nope' })])).toMatch(
      /data table nope does not exist/,
    );
    expect(
      problems([list('shifts', [{ label: 'X', do: 'set', fieldId: 'gone', value: 1 }])]),
    ).toMatch(/gone is not a field of shifts \(fields: start, end/);
  });

  it('increment only works on number, money and duration; toggle only on a checkbox', () => {
    expect(
      problems([list('packing', [{ label: '+1', do: 'increment', fieldId: 'packed', by: 1 }])]),
    ).toMatch(
      /increment needs a number or money or duration field, but packing\.packed is checkbox/,
    );
    expect(problems([list('packing', [{ label: 'T', do: 'toggle', fieldId: 'bag' }])])).toMatch(
      /toggle needs a checkbox field/,
    );
    expect(
      problems([list('shifts', [{ label: '0', do: 'increment', fieldId: 'pay', by: 0 }])]),
    ).not.toBe('');
  });

  it('a create that would leave a required field empty is rejected', () => {
    expect(
      problems([button({ do: 'create', collectionId: 'checkins', values: { habit: 'run' } })]),
    ).toMatch(
      /required field day would be empty; preset it, make it not required, or use do "open"/,
    );
  });

  it('"row" is only for a row button’s create, on a link to the list’s table', () => {
    expect(
      problems([button({ do: 'create', collectionId: 'logs', values: { habit: 'row' } })]),
    ).toMatch(/link field logs\.habit can't be preset/);
    expect(
      problems([
        list('water', [
          { label: 'Log', do: 'create', collectionId: 'logs', values: { habit: 'row' } },
        ]),
      ]),
    ).toMatch(/must point at water/);
  });

  it('setAll filters and row conditions are checked like component filters', () => {
    expect(
      problems([
        button({
          do: 'setAll',
          collectionId: 'packing',
          filter: [{ field: 'bag', op: 'is', value: 'boot' }],
          fieldId: 'packed',
          value: false,
        }),
      ]),
    ).toMatch(/filter on bag: value does not match/);
    expect(
      problems([
        list('shifts', [
          {
            label: 'Out',
            do: 'set',
            fieldId: 'end',
            value: 'now',
            when: [{ field: 'nope', op: 'isEmpty' }],
          },
        ]),
      ]),
    ).toMatch(/row button "Out" when: filter field nope/);
  });
});

describe('removing fields and tables takes the actions that used them', () => {
  const withActions = () =>
    apply(base(), [
      button({
        do: 'create',
        collectionId: 'checkins',
        values: { habit: 'run', day: 'today' },
      }) as never,
      button(
        { do: 'setAll', collectionId: 'packing', fieldId: 'packed', value: false },
        'b2',
      ) as never,
      list('shifts', [
        {
          label: 'Out',
          do: 'set',
          fieldId: 'end',
          value: 'now',
          when: [{ field: 'end', op: 'isEmpty' }],
        },
        { label: '+15', do: 'increment', fieldId: 'break', by: 15 },
      ]) as never,
    ]);
  const ids = (config: WorkspaceConfig) =>
    config.pages.find((p) => p.id === 'home')!.components.map((c) => c.id);

  it('removing a field drops the row buttons and buttons that used it, with a note', () => {
    const r = prepareOps(
      withActions(),
      [{ op: 'removeField', collectionId: 'shifts', fieldId: 'end' }],
      {
        registry,
        locale: 'en',
        now,
      },
    );
    expect(r.ok ? '' : r.issues.join()).toBe('');
    if (!r.ok) return;
    const l1 = r.after.pages[0]!.components.find((c) => c.id === 'l1');
    expect(l1?.type === 'recordList' && l1.props.rowActions?.map((a) => a.label)).toEqual(['+15']);
    expect(r.lines.join('\n')).toMatch(/Also removes 1 one-tap button that used it/);

    const r2 = prepareOps(
      withActions(),
      [{ op: 'removeField', collectionId: 'packing', fieldId: 'packed' }],
      {
        registry,
        locale: 'zh',
        now,
      },
    );
    expect(r2.ok && ids(r2.after)).not.toContain('b2');
    expect(r2.ok && r2.lines.join('\n')).toMatch(/同时移除 1 个用到它的一键按钮/);
  });

  it('a list with no row buttons left keeps showing its records', () => {
    const r = apply(withActions(), [
      { op: 'removeField', collectionId: 'shifts', fieldId: 'end' },
      { op: 'removeField', collectionId: 'shifts', fieldId: 'break' },
    ]);
    const l1 = r.pages[0]!.components.find((c) => c.id === 'l1');
    expect(l1?.type === 'recordList' && 'rowActions' in l1.props).toBe(false);
  });

  it('removing a table removes the buttons that change its entries', () => {
    const r = prepareOps(withActions(), [{ op: 'removeCollection', collectionId: 'checkins' }], {
      registry,
      locale: 'fr',
      now,
    });
    expect(r.ok && ids(r.after)).not.toContain('b1');
    expect(r.ok && r.lines.join('\n')).toMatch(/Supprime aussi 1 bouton en un geste/);
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
    // 「这一行」。
    expect(createInput(linkedCheckins, { habit: 'row' }, { now, rowId: 'h1abcdef' })).toEqual({
      habit: 'h1abcdef',
    });
  });

  it('set now, set null, toggle and increment', () => {
    expect(
      rowUpdateInput(
        { label: 'Out', do: 'set', fieldId: 'end', value: 'now' },
        shifts,
        {},
        { now },
      ),
    ).toEqual({
      end: '2026-10-29T18:05',
    });
    expect(
      rowUpdateInput(
        { label: 'At', do: 'set', fieldId: 'clock', value: 'now' },
        shifts,
        {},
        { now },
      ),
    ).toEqual({
      clock: '18:05',
    });
    expect(
      rowUpdateInput(
        { label: 'Clear', do: 'set', fieldId: 'end', value: null },
        shifts,
        {},
        { now },
      ),
    ).toEqual({
      end: '',
    });
    expect(
      rowUpdateInput({ label: 'T', do: 'toggle', fieldId: 'packed' }, packing, {}, { now }),
    ).toEqual({
      packed: true,
    });
    expect(
      rowUpdateInput(
        { label: 'T', do: 'toggle', fieldId: 'packed' },
        packing,
        { packed: true },
        { now },
      ),
    ).toEqual({ packed: false });
    const inc = (fieldId: string, by: number, values: Record<string, unknown>) =>
      rowUpdateInput({ label: '+', do: 'increment', fieldId, by }, shifts, values, { now });
    // 空的从 0 开始；金额两位小数；时长不会减成负数。
    expect(inc('pay', 0.1, {})).toEqual({ pay: 0.1 });
    expect(inc('pay', 0.2, { pay: 0.1 })).toEqual({ pay: 0.3 });
    expect(inc('break', -15, { break: 10 })).toEqual({ break: 0 });
    expect(
      rowUpdateInput(
        { label: '+1', do: 'increment', fieldId: 'glasses', by: 1 },
        water,
        { glasses: 7 },
        { now },
      ),
    ).toEqual({ glasses: 8 });
    // 字段已经不在了（旧配置）：什么也不做。
    expect(
      rowUpdateInput({ label: 'X', do: 'toggle', fieldId: 'gone' }, packing, {}, { now }),
    ).toBeNull();
  });

  it('a row shows the first button whose conditions match', () => {
    const actions: RowAction[] = [
      {
        label: 'Clock out',
        do: 'set',
        fieldId: 'end',
        value: 'now',
        when: [{ field: 'end', op: 'isEmpty' }],
      },
      { label: 'Edit', do: 'open', when: [{ field: 'end', op: 'isNotEmpty' }] },
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
      shownRowAction([actions[0]!], record({ end: '2026-10-29T17:00' }), shifts, now),
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
        collectionId: 'packing',
        filter: [{ field: 'bag', op: 'is', value: 'carry' }],
        fieldId: 'packed',
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
        { do: 'setAll', collectionId: 'packing', fieldId: 'packed', value: true },
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
