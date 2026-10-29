import { describe, expect, it } from 'vitest';

import { chartSeries } from './chart';
import {
  aggregateRecords,
  filterRecords,
  formatRef,
  formatValue,
  prepareRecordValues,
  readValue,
  recordValue,
  recordsToCsv,
  sortRecords,
  type DataRecord,
} from './data';
import { fieldDefinition } from './fields';
import { evaluateFormula, parseFormula } from './formula';
import { recordsToHtml } from './html';
import { applyOps } from './ops';
import type { Collection, Field, WorkspaceConfig } from './schema';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 时间、日期时间、时长字段（D-279）和公式升级（D-280、D-281）。

const shifts: Collection = {
  id: 'shifts',
  name: '工时',
  fields: [
    { id: 'start', name: '上班', type: 'time' },
    { id: 'end', name: '下班', type: 'time' },
    { id: 'in', name: '打卡', type: 'datetime', default: 'now' },
    { id: 'out', name: '离开', type: 'datetime' },
    { id: 'break', name: '休息', type: 'duration' },
    { id: 'rate', name: '时薪', type: 'money', currency: 'CNY' },
    { id: 'worked', name: '工时', type: 'formula', expression: 'hours({start}, {end})' },
    {
      id: 'pay',
      name: '工资',
      type: 'formula',
      expression: 'round(({worked} - {break} / 60) * {rate}, 1)',
      currency: 'CNY',
    },
  ],
};

const NOW = new Date(2026, 9, 29, 23, 59);

let seq = 0;
function record(values: Record<string, unknown>, createdAt = NOW.getTime()): DataRecord {
  seq++;
  return { id: `r${seq}`, collectionId: 'shifts', values, createdAt, updatedAt: createdAt };
}

const field = (id: string) => shifts.fields.find((f) => f.id === id)!;
const write = (id: string, input: unknown) => {
  const prepared = prepareRecordValues(shifts, { [id]: input }, {}, NOW);
  return prepared.ok ? prepared.values[id] : 'invalid';
};

describe('time fields (D-279)', () => {
  it('time stores HH:mm and accepts what people type', () => {
    expect(write('start', '8:05')).toBe('08:05');
    expect(write('start', '08:05')).toBe('08:05');
    expect(write('start', '8：05')).toBe('08:05');
    expect(write('start', '23:59:30')).toBe('23:59');
    for (const bad of ['24:00', '8:60', '8', '8:5', 'noon', 480])
      expect(write('start', bad)).toBe('invalid');
    expect(write('start', '')).toBeUndefined();
  });

  it('datetime stores local YYYY-MM-DDTHH:mm, new entries start at now', () => {
    expect(write('in', '2026-10-29 8:30')).toBe('2026-10-29T08:30');
    expect(write('in', '2026-10-29T08:30:12')).toBe('2026-10-29T08:30');
    for (const bad of ['2026-10-29', '2026-02-30 08:00', '2026-10-29 25:00', 'yesterday'])
      expect(write('in', bad)).toBe('invalid');
    const fresh = prepareRecordValues(shifts, {}, null, new Date(2026, 9, 29, 7, 3));
    expect(fresh.ok && fresh.values.in).toBe('2026-10-29T07:03');
    // 没有 default 的不填。
    expect(fresh.ok && 'out' in fresh.values).toBe(false);
  });

  it('duration stores whole minutes, typed as h:mm or minutes', () => {
    expect(write('break', '1:30')).toBe(90);
    expect(write('break', ':45')).toBe(45);
    expect(write('break', '2:')).toBe(120);
    expect(write('break', '90')).toBe(90);
    expect(write('break', 30.4)).toBe(30);
    for (const bad of ['1:75', '-5', -5, ':', '1h30', 2_000_000])
      expect(write('break', bad)).toBe('invalid');
  });

  it('shows the same way in every language, French dates in French order', () => {
    expect(formatValue(field('start'), '08:30', 'fr')).toBe('08:30');
    expect(formatValue(field('in'), '2026-10-29T08:30', 'en')).toBe('2026-10-29 08:30');
    expect(formatValue(field('in'), '2026-10-29T08:30', 'zh')).toBe('2026-10-29 08:30');
    expect(formatValue(field('in'), '2026-10-29T08:30', 'fr')).toBe('29/10/2026 08:30');
    expect(formatValue(field('break'), 90, 'fr')).toBe('1:30');
    expect(formatValue(field('break'), 5, 'en')).toBe('0:05');
    expect(formatValue(field('break'), 2475, 'zh')).toBe('41:15');
  });

  it('reads nothing when the stored value no longer fits (restored an older version)', () => {
    // 字段以前是别的类型：值留着，只是不显示。
    expect(readValue(field('start'), '2026-10-29T08:30')).toBeUndefined();
    expect(readValue(field('start'), 480)).toBeUndefined();
    expect(readValue(field('in'), '2026-10-29')).toBeUndefined();
    expect(readValue(field('in'), '08:30')).toBeUndefined();
    expect(readValue(field('break'), '1:30')).toBeUndefined();
    expect(readValue(field('break'), -1)).toBeUndefined();
    const old = record({ start: 'x', end: 7, in: '2026-10-29', break: 'a' });
    for (const id of ['start', 'end', 'in', 'break', 'worked', 'pay'])
      expect(formatRef(old, shifts, id, 'en')).toBe('');
  });

  it('exports CSV in a machine-readable way', () => {
    const r = record({ start: '22:00', end: '06:00', in: '2026-10-29T22:00', break: 30, rate: 20 });
    const csv = recordsToCsv(shifts, [r], 'fr');
    expect(csv.split('\r\n')[1]).toMatch(/^22:00,06:00,2026-10-29 22:00,,0:30,20.00,8,150,/);
  });

  it('filters datetime by its local day', () => {
    const late = record({ in: '2026-10-29T23:30' });
    const early = record({ in: '2026-10-29T00:10' });
    const before = record({ in: '2026-10-28T23:59' });
    const all = [late, early, before];
    const ids = (filter: Parameters<typeof filterRecords>[2]) =>
      filterRecords(all, shifts, filter, NOW).map((r) => r.id);
    expect(ids([{ field: 'in', op: 'inPeriod', value: 'today' }])).toEqual([late.id, early.id]);
    expect(ids([{ field: 'in', op: 'gt', value: '2026-10-28' }])).toEqual([late.id, early.id]);
    expect(ids([{ field: 'in', op: 'lt', value: '2026-10-29' }])).toEqual([before.id]);
    expect(ids([{ field: 'in', op: 'is', value: '2026-10-29' }])).toEqual([late.id, early.id]);
    expect(ids([{ field: 'in', op: 'is', value: '2026-10-29T00:10' }])).toEqual([early.id]);
    expect(ids([{ field: 'in', op: 'isNot', value: '2026-10-29' }])).toEqual([before.id]);
  });

  it('filters time with HH:mm and duration with minutes', () => {
    const a = record({ start: '07:45', break: 20 });
    const b = record({ start: '09:15', break: 60 });
    expect(
      filterRecords([a, b], shifts, [{ field: 'start', op: 'gt', value: '09:00' }], NOW),
    ).toEqual([b]);
    expect(filterRecords([a, b], shifts, [{ field: 'break', op: 'lt', value: 30 }], NOW)).toEqual([
      a,
    ]);
  });

  it('sorts by time of day, datetime and duration', () => {
    const a = record({ start: '10:00', in: '2026-10-29T08:00', break: 5 }, 1);
    const b = record({ start: '09:00', in: '2026-10-28T23:00', break: 60 }, 2);
    const c = record({}, 3);
    const order = (field: string) =>
      sortRecords([a, b, c], shifts, { field, direction: 'asc' }).map((r) => r.id);
    expect(order('start')).toEqual([b.id, a.id, c.id]);
    expect(order('in')).toEqual([b.id, a.id, c.id]);
    expect(order('break')).toEqual([a.id, b.id, c.id]);
  });

  it('sums and averages durations, shown as h:mm', () => {
    const list = [record({ break: 30 }), record({ break: 45 }), record({})];
    expect(aggregateRecords(list, shifts, 'sum', 'break')).toBe(75);
    expect(aggregateRecords(list, shifts, 'avg', 'break')).toBe(37.5);
    const shown = fieldDefinition('duration').formatAmount!(field('break'), 37.5, 'en');
    expect(shown).toBe('0:38');
  });

  it('charts by the day of a datetime field', () => {
    const series = chartSeries(
      [
        record({ in: '2026-10-29T23:30', break: 30 }),
        record({ in: '2026-10-28T08:00', break: 15 }),
        record({ in: '2026-10-28T09:00', break: 15 }),
      ],
      shifts,
      { aggregate: 'sum', fieldId: 'break', group: 'day', periods: 3 },
      NOW,
      '—',
    );
    expect(series.map((p) => [p.key, p.value])).toEqual([
      ['2026-10-27', 0],
      ['2026-10-28', 30],
      ['2026-10-29', 30],
    ]);
  });

  it('prints durations as a right-aligned column with a total', () => {
    const html = recordsToHtml(shifts, [record({ break: 90 }), record({ break: 45 })], {
      template: 'receipt',
      title: 'Shifts',
      fields: ['start', 'break'],
      pageSize: 'a4',
      locale: 'en',
      now: NOW,
    });
    expect(html).toContain('<td class="num">1:30</td>');
    expect(html).toContain('2:15');
  });
});

describe('formula functions (D-280)', () => {
  const calc = (text: string, values: Record<string, number | undefined> = {}) => {
    const parsed = parseFormula(text);
    if (!parsed.ok) throw new Error(parsed.error);
    return evaluateFormula(parsed.node, (f) => values[f]);
  };

  it('has min, max, round and abs', () => {
    expect(calc('min({a}, {b}, 3)', { a: 5, b: 4 })).toBe(3);
    expect(calc('max({a}, 0)', { a: -2 })).toBe(0);
    expect(calc('round({a})', { a: 2.5 })).toBe(3);
    expect(calc('round({a}, 2)', { a: 1.005 })).toBe(1.01);
    expect(calc('round({a}, 1)', { a: -2.25 })).toBe(-2.3);
    expect(calc('abs({a} - {b})', { a: 3, b: 10 })).toBe(7);
    expect(calc('MAX({a}, 1)', { a: 0 })).toBe(1);
    expect(calc('min({a}, 1)', {})).toBeUndefined();
  });

  it('checks how many parts each function gets', () => {
    for (const bad of [
      'min({a})',
      'abs({a}, 1)',
      'round()',
      'round({a}, 1, 2)',
      'max {a}',
      'hours({a})',
    ])
      expect(parseFormula(bad).ok, bad).toBe(false);
  });

  it('allows up to 500 characters', () => {
    expect(parseFormula(`{a}${' + 1'.repeat(124)}`).ok).toBe(true);
    expect(parseFormula(`{a}${' + 1'.repeat(125)}`).ok).toBe(false);
  });
});

describe('time in formulas (D-280)', () => {
  const at = (values: Record<string, unknown>, id: string) =>
    recordValue(record(values), shifts, id, NOW);

  it('hours and minutes between two times, past midnight adds 24 hours', () => {
    expect(at({ start: '09:00', end: '17:30' }, 'worked')).toBe(8.5);
    expect(at({ start: '22:00', end: '06:00' }, 'worked')).toBe(8);
    expect(at({ start: '08:00', end: '08:00' }, 'worked')).toBe(0);
    expect(at({ start: '09:00' }, 'worked')).toBeUndefined();
  });

  it('hours between two datetimes can span days and be negative', () => {
    const table: Collection = {
      ...shifts,
      fields: [
        ...shifts.fields,
        { id: 'span', name: 'Span', type: 'formula', expression: 'minutes({in}, {out})' },
        { id: 'ago', name: 'Ago', type: 'formula', expression: 'days({in}, today)' },
      ],
    };
    const r = record({ in: '2026-10-28T22:00', out: '2026-10-29T06:30' });
    expect(recordValue(r, table, 'span', NOW)).toBe(510);
    expect(recordValue(r, table, 'ago', NOW)).toBe(1);
    const back = record({ in: '2026-10-29T06:30', out: '2026-10-28T22:00' });
    expect(recordValue(back, table, 'span', NOW)).toBe(-510);
  });

  it('a formula can use another formula and a duration (minutes)', () => {
    // (8 − 0.5) × 20 = 150
    expect(at({ start: '09:00', end: '17:00', break: 30, rate: 20 }, 'pay')).toBe(150);
    expect(at({ start: '09:00', end: '17:00', rate: 20 }, 'pay')).toBeUndefined();
  });

  it('has no value for a loop left in an old config', () => {
    const table: Collection = {
      ...shifts,
      fields: [
        { id: 'a', name: 'A', type: 'formula', expression: '{b} + 1' },
        { id: 'b', name: 'B', type: 'formula', expression: '{a} + 1' },
      ],
    };
    expect(recordValue(record({}), table, 'a', NOW)).toBeUndefined();
  });
});

describe('checking time formulas (D-280, D-281)', () => {
  const withTable = (collection: Collection): WorkspaceConfig => {
    const result = applyOps(workspace(), [{ op: 'addCollection', collection }], {
      registry,
      locale: 'zh',
    });
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };
  const problems = (...extra: Field[]) => {
    const r = validateWorkspace(
      withTable({ ...shifts, fields: [...shifts.fields, ...extra] }),
      registry,
    );
    return r.ok ? [] : r.issues.map((i) => i.message);
  };
  const formula = (id: string, expression: string): Field => ({
    id,
    name: id,
    type: 'formula',
    expression,
  });

  it('accepts the work-hours table', () => {
    expect(problems()).toEqual([]);
    expect(problems(formula('late', 'if({start} > {end}, 1, 0)'))).toEqual([]);
  });

  it('rejects times that are added, mixed or left as the result', () => {
    expect(problems(formula('x', '{start} + 1'))[0]).toMatch(/\+ needs a number, not a time/);
    expect(problems(formula('x', 'hours({start}, {out})'))[0]).toMatch(
      /hours\(\) needs a time, not a datetime/,
    );
    expect(problems(formula('x', 'hours({break}, {end})'))[0]).toMatch(
      /hours\(\) needs two times or two datetimes, not a number/,
    );
    expect(problems(formula('x', 'days({start}, today)'))[0]).toMatch(
      /days\(\) needs a date or datetime, not a time/,
    );
    expect(problems(formula('x', 'if({start} > 9, 1, 0)'))[0]).toMatch(
      /the comparison needs a time, not a number/,
    );
    expect(problems(formula('x', 'max({start}, 1)'))[0]).toMatch(/max\(\) needs a number/);
  });

  it('names the loop when formulas use each other', () => {
    const found = problems(formula('a', '{b} + 1'), formula('b', '{c} * 2'), formula('c', '{a}'));
    expect(found).toContain(
      'shifts.a: formula uses itself through a → b → c → a; a formula can use other formulas but never one that comes back to it',
    );
    expect(problems(formula('self', '{self} + 1'))).toContain(
      'shifts.self: formula uses itself through self → self; a formula can use other formulas but never one that comes back to it',
    );
  });

  it('filters a time with HH:mm only', () => {
    const c = withTable(shifts);
    const page = c.pages[0]!;
    const list = {
      id: 'list',
      type: 'recordList',
      props: {
        collectionId: 'shifts',
        display: 'list',
        titleField: 'start',
        limit: 5,
        filter: [{ field: 'start', op: 'gt', value: '9:00' }],
      },
    };
    const config = {
      ...c,
      pages: [{ ...page, components: [...page.components, list] }, ...c.pages.slice(1)],
    } as WorkspaceConfig;
    const r = validateWorkspace(config, registry);
    expect(r.ok ? [] : r.issues.map((i) => i.message)).toEqual([
      'list: filter on start: gt needs a number or date field and a matching value',
    ]);
  });
});
