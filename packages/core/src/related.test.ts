import { describe, expect, it } from 'vitest';

import {
  aggregateRecords,
  filterRecords,
  formatRef,
  recordValue,
  scheduleStatusOf,
  sortRecords,
  type DataRecord,
} from './data';
import { computeRecords, expandCollection, relatedCollectionIds } from './related';
import type { Collection, Field, WorkspaceConfig } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';

const workspace = (locale: 'en') => fromV33(v33Fixture(`default-${locale}`));

// 查找、汇总、上一条（D-287–D-289）：值只在本机由记录算出来，配置里只有结构。

const NOW = new Date(2026, 9, 29, 10);

let seq = 0;
const rec = (collectionId: string, id: string, values: Record<string, unknown>): DataRecord => ({
  id,
  collectionId,
  values,
  createdAt: NOW.getTime() - 1_000_000 + ++seq,
  updatedAt: 0,
});

const jobs: Collection = {
  id: 'jobs',
  name: 'Jobs',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'rate', name: 'Rate', type: 'money', currency: 'EUR' },
  ],
};
const shifts: Collection = {
  id: 'shifts',
  name: 'Shifts',
  fields: [
    { id: 'job', name: 'Job', type: 'link', table: 'jobs' },
    { id: 'hours', name: 'Hours', type: 'number', decimals: 1 },
    { id: 'rate', name: 'Rate', type: 'lookup', via: 'job', field: 'rate' },
    { id: 'pay', name: 'Pay', type: 'formula', expression: '{hours} * {rate}', currency: 'EUR' },
  ],
};

const habits: Collection = {
  id: 'habits',
  name: 'Habits',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    {
      id: 'streak',
      name: 'Streak',
      type: 'rollup',
      table: 'checkins',
      via: 'habit',
      aggregate: 'streak',
      days: { date: 'date', skip: { field: 'status', option: 'skip' } },
    },
    {
      id: 'last',
      name: 'Last time',
      type: 'rollup',
      table: 'checkins',
      via: 'habit',
      aggregate: 'latest',
      field: 'date',
    },
    {
      id: 'times',
      name: 'Times',
      type: 'rollup',
      table: 'checkins',
      via: 'habit',
      aggregate: 'count',
      filter: [{ field: 'date', op: 'inPeriod', value: 'thisWeek' }],
    },
  ],
};
const checkins: Collection = {
  id: 'checkins',
  name: 'Check-ins',
  fields: [
    { id: 'habit', name: 'Habit', type: 'link', table: 'habits' },
    { id: 'date', name: 'Date', type: 'date' },
    {
      id: 'status',
      name: 'Status',
      type: 'choice',
      options: [
        { id: 'done', label: 'Done' },
        { id: 'skip', label: 'Skipped' },
      ],
    },
  ],
};

const fuel: Collection = {
  id: 'fuel',
  name: 'Fuel',
  fields: [
    {
      id: 'car',
      name: 'Car',
      type: 'choice',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    { id: 'date', name: 'Date', type: 'date' },
    { id: 'odo', name: 'Odometer', type: 'number', unit: 'km' },
    { id: 'prev', name: 'Last', type: 'previous', field: 'odo', within: 'car' },
    { id: 'km', name: 'Distance', type: 'formula', expression: '{odo} - {prev}', unit: 'km' },
  ],
};

const ALL = [jobs, shifts, habits, checkins, fuel];

function compute(
  collectionId: string,
  data: Record<string, DataRecord[]>,
  collections: readonly Collection[] = ALL,
) {
  const records = new Map(Object.entries(data));
  const collection = collections.find((c) => c.id === collectionId)!;
  return {
    view: expandCollection(collections, collection),
    records: computeRecords(collections, collectionId, records, NOW),
  };
}

describe('lookup (D-287)', () => {
  const data = {
    jobs: [rec('jobs', 'j1', { name: 'Café', rate: 12.5 }), rec('jobs', 'j2', { name: 'Shop' })],
    shifts: [
      rec('shifts', 's1', { job: 'j1', hours: 4 }),
      rec('shifts', 's2', { job: 'j2', hours: 3 }),
      rec('shifts', 's3', { hours: 2 }),
      rec('shifts', 's4', { job: 'gone', hours: 5 }),
    ],
  };

  it('shows the linked entry’s value as that field shows it, and formulas use it', () => {
    const { view, records } = compute('shifts', data);
    const s1 = records.find((r) => r.id === 's1')!;
    expect(view.fields.find((f) => f.id === 'rate')?.type).toBe('money');
    expect(formatRef(s1, view, 'rate', 'en')).toBe('€12.50');
    expect(recordValue(s1, view, 'pay', NOW)).toBe(50);
    expect(formatRef(s1, view, 'pay', 'fr')).toContain('50,00');
  });

  it('is empty when there is no link, the linked entry is gone or has no value', () => {
    const { view, records } = compute('shifts', data);
    for (const id of ['s2', 's3', 's4']) {
      const r = records.find((x) => x.id === id)!;
      expect(recordValue(r, view, 'rate')).toBeUndefined();
      expect(recordValue(r, view, 'pay')).toBeUndefined();
      expect(formatRef(r, view, 'rate', 'zh')).toBe('');
    }
  });

  it('never keeps a stale stored value under its id', () => {
    const stale = { ...data, shifts: [rec('shifts', 's9', { hours: 1, rate: 999 })] };
    const { view, records } = compute('shifts', stale);
    expect(recordValue(records[0]!, view, 'rate')).toBeUndefined();
  });

  it('filters, sorts and sums like the field it shows', () => {
    const { view, records } = compute('shifts', data);
    const paid = filterRecords(records, view, [{ field: 'rate', op: 'gt', value: 10 }], NOW);
    expect(paid.map((r) => r.id)).toEqual(['s1']);
    expect(sortRecords(records, view, { field: 'rate', direction: 'asc' })[0]!.id).toBe('s1');
    expect(aggregateRecords(records, view, 'sum', 'pay')).toBe(50);
  });

  it('does not change the input records', () => {
    const input = [rec('shifts', 's1', { job: 'j1', hours: 4 })];
    compute('shifts', { jobs: data.jobs, shifts: input });
    expect(input[0]!.values).toEqual({ job: 'j1', hours: 4 });
  });
});

describe('rollup (D-288)', () => {
  const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
  const data = {
    habits: [
      rec('habits', 'run', { name: 'Run' }),
      rec('habits', 'read', { name: 'Read' }),
      rec('habits', 'new', { name: 'New' }),
    ],
    checkins: [
      // 跑步：26、27（跳过）、28、29 → 连续 4 天里 3 天做到、1 天跳过，当前连续 3。
      rec('checkins', 'c1', { habit: 'run', date: day(26), status: 'done' }),
      rec('checkins', 'c2', { habit: 'run', date: day(27), status: 'skip' }),
      rec('checkins', 'c3', { habit: 'run', date: day(28), status: 'done' }),
      rec('checkins', 'c4', { habit: 'run', date: day(29), status: 'done' }),
      // 读书：20、21，之后断了。
      rec('checkins', 'c5', { habit: 'read', date: day(20), status: 'done' }),
      rec('checkins', 'c6', { habit: 'read', date: day(21), status: 'done' }),
      // 引用了已删除的习惯、没有引用：都不算进任何一个习惯。
      rec('checkins', 'c7', { habit: 'gone', date: day(29), status: 'done' }),
      rec('checkins', 'c8', { date: day(29), status: 'done' }),
    ],
  };

  it('streak, latest and count per linked entry', () => {
    const { view, records } = compute('habits', data);
    const get = (id: string, f: string) =>
      recordValue(
        records.find((r) => r.id === id)!,
        view,
        f,
      );
    expect(get('run', 'streak')).toBe(3);
    expect(get('read', 'streak')).toBe(0);
    expect(get('run', 'last')).toBe(day(29));
    expect(get('read', 'last')).toBe(day(21));
    // 本周（周一 26 号起）。
    expect(get('run', 'times')).toBe(4);
    expect(get('read', 'times')).toBe(0);
    const run = records.find((r) => r.id === 'run')!;
    expect(formatRef(run, view, 'streak', 'en')).toBe('3 days');
    expect(formatRef(run, view, 'streak', 'fr')).toBe('3 jours');
    expect(view.fields.find((f) => f.id === 'last')?.type).toBe('date');
  });

  it('with no linked entries: count 0, streak 0, no latest', () => {
    const { view, records } = compute('habits', data);
    const fresh = records.find((r) => r.id === 'new')!;
    expect(recordValue(fresh, view, 'times')).toBe(0);
    expect(recordValue(fresh, view, 'streak')).toBe(0);
    expect(recordValue(fresh, view, 'last')).toBeUndefined();
    expect(formatRef(fresh, view, 'last', 'en')).toBe('');
    expect(formatRef(fresh, view, 'streak', 'en')).toBe('0 days');
  });

  it('with no records at all (new user)', () => {
    const { view, records } = compute('habits', {});
    expect(records).toEqual([]);
    expect(view.fields.map((f) => f.id)).toEqual(['name', 'streak', 'last', 'times']);
  });

  it('can be filtered and sorted by its value', () => {
    const { view, records } = compute('habits', data);
    const going = filterRecords(records, view, [{ field: 'streak', op: 'gt', value: 0 }], NOW);
    expect(going.map((r) => r.id)).toEqual(['run']);
    const byLast = sortRecords(records, view, { field: 'last', direction: 'desc' });
    expect(byLast.map((r) => r.id)).toEqual(['run', 'read', 'new']);
  });

  it('sum of money per client, sum of a signed quantity for stock, avg, filtered', () => {
    const clients: Collection = {
      id: 'clients',
      name: 'Clients',
      fields: [
        { id: 'name', name: 'Name', type: 'text' },
        {
          id: 'total',
          name: 'Total',
          type: 'rollup',
          table: 'orders',
          via: 'client',
          aggregate: 'sum',
          field: 'amount',
        },
        {
          id: 'paid',
          name: 'Paid',
          type: 'rollup',
          table: 'orders',
          via: 'client',
          aggregate: 'sum',
          field: 'amount',
          filter: [{ field: 'paid', op: 'is', value: true }],
        },
        {
          id: 'avg',
          name: 'Average',
          type: 'rollup',
          table: 'orders',
          via: 'client',
          aggregate: 'avg',
          field: 'amount',
        },
      ],
    };
    const orders: Collection = {
      id: 'orders',
      name: 'Orders',
      fields: [
        { id: 'client', name: 'Client', type: 'link', table: 'clients' },
        { id: 'amount', name: 'Amount', type: 'money', currency: 'CNY' },
        { id: 'paid', name: 'Paid', type: 'checkbox' },
      ],
    };
    const { view, records } = compute(
      'clients',
      {
        clients: [rec('clients', 'k1', { name: 'A' }), rec('clients', 'k2', { name: 'B' })],
        orders: [
          rec('orders', 'o1', { client: 'k1', amount: 100, paid: true }),
          rec('orders', 'o2', { client: 'k1', amount: 50.5, paid: false }),
        ],
      },
      [clients, orders],
    );
    const k1 = records.find((r) => r.id === 'k1')!;
    const k2 = records.find((r) => r.id === 'k2')!;
    expect(recordValue(k1, view, 'total')).toBe(150.5);
    expect(recordValue(k1, view, 'paid')).toBe(100);
    expect(formatRef(k1, view, 'total', 'zh')).toContain('150.50');
    expect(recordValue(k2, view, 'total')).toBe(0);
    expect(recordValue(k2, view, 'avg')).toBeUndefined();
  });

  it('uses the day start of the calendar (D-286) for days', () => {
    const late: Collection = {
      ...checkins,
      fields: [...checkins.fields, { id: 'at', name: 'At', type: 'datetime' }],
    };
    const h: Collection = {
      ...habits,
      fields: [
        {
          id: 'days',
          name: 'Days',
          type: 'rollup',
          table: 'checkins',
          via: 'habit',
          aggregate: 'distinctDays',
          days: { date: 'at' },
        },
      ],
    };
    const records = new Map(
      Object.entries({
        habits: [rec('habits', 'run', {})],
        checkins: [
          rec('checkins', 'c1', { habit: 'run', at: '2026-10-28T23:30' }),
          rec('checkins', 'c2', { habit: 'run', at: '2026-10-29T01:30' }),
        ],
      }),
    );
    const view = expandCollection([h, late], h);
    const at = (dayStartHour: number) =>
      recordValue(
        computeRecords([h, late], 'habits', records, NOW, {
          dayStartHour,
          weekStart: 'monday',
          twoWeekStart: '2026-01-05',
        })[0]!,
        view,
        'days',
      );
    expect(at(0)).toBe(2);
    expect(at(2)).toBe(1);
  });
});

describe('previous (D-289)', () => {
  it('takes the value of the entry before, by date, in the same group', () => {
    const data = {
      fuel: [
        rec('fuel', 'f3', { car: 'a', date: '2026-10-20', odo: 1500 }),
        rec('fuel', 'f1', { car: 'a', date: '2026-10-01', odo: 1000 }),
        rec('fuel', 'f2', { car: 'b', date: '2026-10-05', odo: 300 }),
        rec('fuel', 'f4', { car: 'a', date: '2026-10-25' }),
        rec('fuel', 'f5', { car: 'a', date: '2026-10-28', odo: 1900 }),
        rec('fuel', 'f6', { car: 'a', odo: 9999 }),
      ],
    };
    const { view, records } = compute('fuel', data);
    const get = (id: string, f: string) =>
      recordValue(
        records.find((r) => r.id === id)!,
        view,
        f,
      );
    expect(get('f1', 'prev')).toBeUndefined();
    expect(get('f3', 'prev')).toBe(1000);
    expect(get('f3', 'km')).toBe(500);
    // 中间那条没有里程：用再往前一条有值的。
    expect(get('f5', 'prev')).toBe(1500);
    // 另一辆车自己算。
    expect(get('f2', 'prev')).toBeUndefined();
    // 没有日期的不排进去。
    expect(get('f6', 'prev')).toBeUndefined();
    expect(
      formatRef(
        records.find((r) => r.id === 'f3')!,
        view,
        'prev',
        'en',
      ),
    ).toBe('1,000 km');
  });

  it('without within uses the whole table, ordered by the first date field', () => {
    const weight: Collection = {
      id: 'weight',
      name: 'Weight',
      fields: [
        { id: 'at', name: 'At', type: 'datetime' },
        { id: 'kg', name: 'kg', type: 'number', decimals: 1 },
        { id: 'before', name: 'Before', type: 'previous', field: 'kg' },
        {
          id: 'change',
          name: 'Change',
          type: 'formula',
          expression: '{kg} - {before}',
          decimals: 1,
        },
      ],
    };
    const { view, records } = compute(
      'weight',
      {
        weight: [
          rec('weight', 'w2', { at: '2026-10-02T08:00', kg: 70.2 }),
          rec('weight', 'w1', { at: '2026-10-01T21:00', kg: 70.6 }),
          rec('weight', 'w0', { at: '2026-10-01T07:00', kg: 71 }),
        ],
      },
      [weight],
    );
    const get = (id: string) =>
      recordValue(
        records.find((r) => r.id === id)!,
        view,
        'change',
      );
    expect(get('w0')).toBeUndefined();
    expect(get('w1')).toBe(-0.4);
    expect(get('w2')).toBe(-0.4);
  });
});

describe('what has to be loaded', () => {
  it('lists the tables a table needs for its computed fields', () => {
    expect(relatedCollectionIds(ALL, shifts).sort()).toEqual(['jobs', 'shifts']);
    expect(relatedCollectionIds(ALL, habits).sort()).toEqual(['checkins', 'habits']);
    expect(relatedCollectionIds(ALL, fuel)).toEqual(['fuel']);
    expect(relatedCollectionIds(ALL, jobs)).toEqual(['jobs']);
  });

  it('follows lookups of lookups', () => {
    const tips: Collection = {
      id: 'tips',
      name: 'Tips',
      fields: [
        { id: 'shift', name: 'Shift', type: 'link', table: 'shifts' },
        { id: 'rate', name: 'Rate', type: 'lookup', via: 'shift', field: 'rate' },
      ],
    };
    expect(relatedCollectionIds([...ALL, tips], tips).sort()).toEqual(['jobs', 'shifts', 'tips']);
    const records = computeRecords(
      [...ALL, tips],
      'tips',
      new Map(
        Object.entries({
          jobs: [rec('jobs', 'j1', { rate: 9 })],
          shifts: [rec('shifts', 's1', { job: 'j1' })],
          tips: [rec('tips', 't1', { shift: 's1' })],
        }),
      ),
      NOW,
    );
    const view = expandCollection([...ALL, tips], tips);
    expect(formatRef(records[0]!, view, 'rate', 'en')).toBe('€9.00');
  });
});

describe('checks (D-290)', () => {
  const config = (collections: Collection[]): WorkspaceConfig => {
    const c = workspace('en');
    return { ...c, data: { ...c.data, tables: collections } };
  };
  const problems = (collections: Collection[]) => {
    const r = validateWorkspace(config(collections), registry);
    return r.ok ? [] : r.issues.map((i) => i.message);
  };
  const withField = (c: Collection, field: Field): Collection => ({
    ...c,
    fields: [...c.fields, field],
  });

  it('accepts the examples above', () => {
    expect(problems(ALL)).toEqual([]);
  });

  it('lookup: via must be a link field, field a field of the linked table', () => {
    expect(
      problems([
        jobs,
        withField(shifts, {
          id: 'x',
          name: 'X',
          type: 'lookup',
          via: 'hours',
          field: 'rate',
        }),
      ]),
    ).toEqual(['shifts.x: via hours must be a link field of shifts']);
    expect(
      problems([
        jobs,
        withField(shifts, {
          id: 'x',
          name: 'X',
          type: 'lookup',
          via: 'job',
          field: 'nope',
        }),
      ]),
    ).toEqual(['shifts.x: nope is not a field of jobs (fields: name, rate)']);
  });

  it('rollup: the link must point back at this table; sum needs a number field', () => {
    const bad = withField(jobs, {
      id: 'x',
      name: 'X',
      type: 'rollup',
      table: 'checkins',
      via: 'habit',
      aggregate: 'count',
    });
    expect(problems([bad, shifts, habits, checkins])).toEqual([
      'jobs.x: checkins.habit links to habits, not to jobs; a rollup counts the entries of checkins whose link field points at this table',
    ]);
    const sum = withField(jobs, {
      id: 'x',
      name: 'X',
      type: 'rollup',
      table: 'shifts',
      via: 'job',
      aggregate: 'sum',
      field: 'job',
    });
    expect(problems([sum, shifts])).toEqual([
      'jobs.x: sum needs field set to a number, money, rating, duration or formula field of shifts',
    ]);
    const filtered = withField(jobs, {
      id: 'x',
      name: 'X',
      type: 'rollup',
      table: 'shifts',
      via: 'job',
      aggregate: 'count',
      filter: [{ field: 'hours', op: 'contains', value: 'a' }],
    });
    expect(problems([filtered, shifts])).toEqual([
      'jobs.x: filter on hours: contains needs a text field',
    ]);
  });

  it('rollup: the day parameters live in days; unit, perUnit and skip are for streak only', () => {
    const rollup = (extra: Record<string, unknown>): Field =>
      ({ id: 'x', name: 'X', type: 'rollup', table: 'checkins', via: 'habit', ...extra }) as Field;
    const others = [shifts, jobs, checkins];
    expect(
      problems([
        withField(habits, rollup({ aggregate: 'count', days: { unit: 'week' } })),
        ...others,
      ]),
    ).toEqual(['habits.x: days.unit, days.perUnit and days.skip only apply to aggregate "streak"']);
    expect(
      problems([
        withField(
          habits,
          rollup({ aggregate: 'streak', days: { skip: { field: 'date', option: 'x' } } }),
        ),
        ...others,
      ]),
    ).toEqual(['habits.x: days.skip.field date must be a choice field of checkins']);
    expect(
      problems([
        withField(
          habits,
          rollup({ aggregate: 'streak', days: { skip: { field: 'status', option: 'x' } } }),
        ),
        ...others,
      ]),
    ).toEqual(['habits.x: days.skip.option must be an option id of status: done, skip']);
    expect(
      problems([
        withField(habits, rollup({ aggregate: 'distinctDays', days: { date: 'habit' } })),
        ...others,
      ]),
    ).toEqual([
      'habits.x: days.date habit must be a date or datetime field of checkins or "createdAt"',
    ]);
    // v33 的 period 迁移成 filter 里的一条 inPeriod：汇总字段没有 period 这个键了。
    expect(
      problems([withField(habits, rollup({ aggregate: 'count', period: 'thisWeek' })), ...others]),
    ).not.toEqual([]);
  });

  it('rollup date: days.date, else the first date, else the first datetime, else createdAt', () => {
    const logs = (fields: Field[]): Collection => ({
      id: 'logs',
      name: 'Logs',
      fields: [{ id: 'habit', name: 'Habit', type: 'link', table: 'habits' }, ...fields],
    });
    const latest = (source: Collection, days?: Record<string, unknown>) => {
      const h: Collection = {
        id: 'habits',
        name: 'Habits',
        fields: [
          { id: 'name', name: 'Name', type: 'text' },
          {
            id: 'last',
            name: 'Last',
            type: 'rollup',
            table: 'logs',
            via: 'habit',
            aggregate: 'latest',
            ...(days ? { days } : {}),
          } as Field,
        ],
      };
      const records = new Map([
        ['habits', [rec('habits', 'h1', { name: 'Run' })]],
        ['logs', [rec('logs', 'l1', { habit: 'h1', at: '2026-10-20T08:00', day: '2026-10-21' })]],
      ]);
      return computeRecords([h, source], 'habits', records, NOW)[0]!.values.last;
    };
    const at: Field = { id: 'at', name: 'At', type: 'datetime' };
    const day: Field = { id: 'day', name: 'Day', type: 'date' };
    expect(latest(logs([at, day]))).toBe('2026-10-21');
    expect(latest(logs([at]))).toBe('2026-10-20T08:00');
    expect(latest(logs([at, day]), { date: 'at' })).toBe('2026-10-20T08:00');
    expect(latest(logs([]))).toMatch(/^2026-/);
  });

  it('pay from a looked-up rate is a valid formula', () => {
    expect(problems([jobs, shifts])).toEqual([]);
    const text = withField(shifts, {
      id: 'x',
      name: 'X',
      type: 'lookup',
      via: 'job',
      field: 'name',
    });
    const bad = withField(text, {
      id: 'y',
      name: 'Y',
      type: 'formula',
      expression: '{x} * 2',
    });
    expect(problems([jobs, bad])).toEqual([
      'shifts.y: formula uses x, which is not a number, money, rating, duration, date, time, datetime or formula field',
    ]);
  });

  it('no loops: a field can never come back to itself', () => {
    const a: Collection = {
      id: 'a',
      name: 'A',
      fields: [
        { id: 'b', name: 'B', type: 'link', table: 'b' },
        { id: 'x', name: 'X', type: 'lookup', via: 'b', field: 'y' },
      ],
    };
    const b: Collection = {
      id: 'b',
      name: 'B',
      fields: [
        { id: 'a', name: 'A', type: 'link', table: 'a' },
        { id: 'y', name: 'Y', type: 'lookup', via: 'a', field: 'x' },
      ],
    };
    expect(problems([a, b])).toEqual([
      'a.x: uses itself through a.x → b.y → a.x; a lookup, rollup or previous field can never come back to itself',
      'b.y: uses itself through b.y → a.x → b.y; a lookup, rollup or previous field can never come back to itself',
    ]);
    // 计算的时候也不会死循环。
    const records = computeRecords(
      [a, b],
      'a',
      new Map([
        ['a', [rec('a', 'r1', { b: 'r2' })]],
        ['b', [rec('b', 'r2', { a: 'r1' })]],
      ]),
      NOW,
    );
    expect(recordValue(records[0]!, expandCollection([a, b], a), 'x')).toBeUndefined();
  });

  it('at most 3 levels of lookups, rollups and previous fields on top of each other', () => {
    // t1.v ← t2.l (1) ← t3.l (2) ← t4.l (3) ← t5.l (4)
    const chain: Collection[] = [
      { id: 't1', name: 'T1', fields: [{ id: 'v', name: 'V', type: 'number' }] },
    ];
    for (let i = 2; i <= 5; i++)
      chain.push({
        id: `t${i}`,
        name: `T${i}`,
        fields: [
          { id: 'up', name: 'Up', type: 'link', table: `t${i - 1}` },
          { id: 'l', name: 'L', type: 'lookup', via: 'up', field: i === 2 ? 'v' : 'l' },
        ],
      });
    expect(problems(chain.slice(0, 4))).toEqual([]);
    expect(problems(chain)).toEqual([
      't5.l: lookups, rollups and previous fields can build on each other at most 3 levels deep; here it is 4 (t5.l → t4.l → t3.l → t2.l); look the value up from a table closer to it',
    ]);
  });

  it('previous: field in this table, within a choice or link field', () => {
    const bad = withField(fuel, {
      id: 'x',
      name: 'X',
      type: 'previous',
      field: 'odo',
      within: 'odo',
    });
    expect(problems([bad])).toEqual(['fuel.x: within odo must be a choice or link field of fuel']);
  });

  it('can’t be in a form', () => {
    const c = config([jobs, shifts]);
    const form = {
      id: 'form',
      look: 'form',
      show: { mode: 'inline' },
      tools: [{ as: 'submit', label: 'Add', do: 'create', table: 'shifts', ask: ['rate'] }],
    };
    const pages = c.containers.pages;
    const r = validateWorkspace(
      {
        ...c,
        containers: { pages: [{ ...pages[0]!, blocks: [form as never] }, ...pages.slice(1)] },
      },
      registry,
    );
    expect(r.ok ? [] : r.issues.map((i) => i.message)).toContain(
      'form: form field rate is a lookup field and cannot be filled in a form',
    );
  });
});

describe('many records', () => {
  it('computes 5,000 check-ins over 50 habits quickly, with one index per table', () => {
    const habitRecords = Array.from({ length: 50 }, (_, i) =>
      rec('habits', `h${i}`, { name: `H${i}` }),
    );
    const checkinRecords = Array.from({ length: 5000 }, (_, i) =>
      rec('checkins', `c${i}`, {
        habit: `h${i % 50}`,
        date: `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
        status: 'done',
      }),
    );
    const records = new Map([
      ['habits', habitRecords],
      ['checkins', checkinRecords],
    ]);
    const start = performance.now();
    const out = computeRecords(ALL, 'habits', records, NOW);
    const ms = performance.now() - start;
    expect(out).toHaveLength(50);
    expect(recordValue(out[0]!, expandCollection(ALL, habits), 'last')).toMatch(/^2026-/);
    expect(ms).toBeLessThan(1000);
    // 每条打卡算「上一条」也要按表建索引：5000 条一次排序，不是每条扫一遍。
    const fuelRecords = Array.from({ length: 5000 }, (_, i) =>
      rec('fuel', `f${i}`, {
        car: i % 2 ? 'a' : 'b',
        date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
        odo: i,
      }),
    );
    const t2 = performance.now();
    computeRecords(ALL, 'fuel', new Map([['fuel', fuelRecords]]), NOW);
    expect(performance.now() - t2).toBeLessThan(1000);
  });
});

describe('a schedule counting from a rollup (D-288 + D-293)', () => {
  const chores: Collection = {
    id: 'chores',
    name: 'Chores',
    fields: [
      { id: 'name', name: 'Name', type: 'text' },
      {
        id: 'logged',
        name: 'Logged',
        type: 'rollup',
        table: 'done',
        via: 'chore',
        aggregate: 'count',
        days: { date: 'date' },
      },
      { id: 'plan', name: 'Plan', type: 'schedule', lastDone: 'logged' },
    ],
  };
  const doneLog: Collection = {
    id: 'done',
    name: 'Done',
    fields: [
      { id: 'chore', name: 'Chore', type: 'link', table: 'chores' },
      { id: 'date', name: 'Date', type: 'date' },
    ],
  };
  const threeAWeek = { repeat: 'times', per: 'week', count: 3 };
  const status = (days: string[]) => {
    const records = new Map([
      ['chores', [rec('chores', 'c1', { name: 'Gym', plan: threeAWeek })]],
      ['done', days.map((date, i) => rec('done', `d${i}`, { chore: 'c1', date }))],
    ]);
    const [row] = computeRecords([chores, doneLog], 'chores', records, NOW);
    const view = expandCollection([chores, doneLog], chores);
    const plan = chores.fields.find((f) => f.id === 'plan') as Extract<Field, { type: 'schedule' }>;
    return scheduleStatusOf(row!, view, plan, NOW);
  };

  it('is a valid lastDone source', () => {
    const base = workspace('en');
    const config = { ...base, data: { tables: [chores, doneLog] } } as WorkspaceConfig;
    expect(validateWorkspace(config, registry).ok).toBe(true);
  });

  it('knows how many days of this week are done, not just the latest one', () => {
    // 2026-10-29 是周四：周一、周二做了，还差一次；周一到周三都做了，这周够了。
    expect(status(['2026-10-26', '2026-10-27'])?.dueToday).toBe(true);
    expect(status(['2026-10-26', '2026-10-27', '2026-10-28'])?.dueToday).toBe(false);
  });
});
