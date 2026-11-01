import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { recordValue } from './data';
import { createDefaultWorkspace } from './defaults';
import { evaluateFormula, parseFormula } from './formula';
import { registry } from './test-helpers';

const calc = (text: string, values: Record<string, number | undefined> = {}) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluateFormula(parsed.node, (f) => values[f]);
};

describe('parseFormula / evaluateFormula (D-188)', () => {
  it('does + - * / with the usual precedence, parentheses and minus signs', () => {
    expect(calc('{price} * {qty}', { price: 12.5, qty: 3 })).toBe(37.5);
    expect(calc('{a} + {b} * 2', { a: 1, b: 3 })).toBe(7);
    expect(calc('({a} + {b}) * 2', { a: 1, b: 3 })).toBe(8);
    expect(calc('{a} - {b} - 1', { a: 10, b: 3 })).toBe(6);
    expect(calc('-{a} / 4', { a: 10 })).toBe(-2.5);
    expect(calc('{price} × {qty} ÷ 2', { price: 4, qty: 3 })).toBe(6);
    expect(calc('{a} * 1.08', { a: 100 })).toBeCloseTo(108);
  });

  it('lists the fields it uses, once each', () => {
    const parsed = parseFormula('{a} * {b} + {a}');
    expect(parsed.ok && parsed.refs).toEqual(['a', 'b']);
  });

  it('has no value when a field is empty or it divides by zero', () => {
    expect(calc('{a} * {b}', { a: 2 })).toBeUndefined();
    expect(calc('{a} / {b}', { a: 2, b: 0 })).toBeUndefined();
  });

  it('rejects anything that is not arithmetic on fields', () => {
    for (const bad of [
      '',
      '12 * 3',
      '{a} +',
      '({a}',
      '{a})',
      '{a} ** 2',
      'Math.max({a}, 1)',
      '{a}; alert(1)',
      '{A B}',
      '{a',
      `${'('.repeat(30)}{a}${')'.repeat(30)}`,
      `{a}${' + 1'.repeat(130)}`,
    ]) {
      expect(parseFormula(bad).ok, bad).toBe(false);
    }
  });
});

describe('if(compare, a, b) (D-246)', () => {
  it('picks the second or third part by a comparison', () => {
    // 满 100 打九折。
    const discount = 'if({total} >= 100, {total} * 0.9, {total})';
    expect(calc(discount, { total: 120 })).toBeCloseTo(108);
    expect(calc(discount, { total: 100 })).toBeCloseTo(90);
    expect(calc(discount, { total: 80 })).toBe(80);
    expect(calc('if({a} = 0.3, 1, 0)', { a: 0.1 + 0.2 })).toBe(1);
    expect(calc('if({a} < {b}, {b} - {a}, 0)', { a: 2, b: 5 })).toBe(3);
    expect(calc('if({a} > 2, 1, 0) + if({a} <= 2, 10, 0)', { a: 2 })).toBe(10);
    // 中文输入法的逗号和 ≥ 也认。
    expect(calc('if({a} ≥ 1， 1， 0)', { a: 1 })).toBe(1);
  });

  it('can be nested within the usual nesting limit', () => {
    const grade = 'if({score} >= 90, 3, if({score} >= 60, 2, 1))';
    expect([95, 60, 10].map((score) => calc(grade, { score }))).toEqual([3, 2, 1]);
    const deep = `${'if({a} > 0, '.repeat(21)}1${', 0)'.repeat(21)}`;
    expect(parseFormula(deep).ok).toBe(false);
  });

  it('has no value when either side of the comparison is empty', () => {
    expect(calc('if({a} > 1, 1, 0)', {})).toBeUndefined();
    // 没选中的那一边空着没关系。
    expect(calc('if({a} > 1, 1, {b})', { a: 5 })).toBe(1);
  });

  it('allows comparisons only as the first part of if, and no other words', () => {
    for (const bad of [
      '{a} > 1',
      'if({a}, 1, 0)',
      'if({a} > 1, 1)',
      'if({a} > 1, 1, 0, 2)',
      'if {a} > 1, 1, 0',
      'if({a} == 1, 1, 0)',
      'if({a} > 1 > 0, 1, 0)',
      'sqrt({a})',
      'IFS({a} > 1, 1, 0)',
      'if({a} > 1, {b} > 2, 0)',
    ]) {
      expect(parseFormula(bad).ok, bad).toBe(false);
    }
    const parsed = parseFormula('if({a} > {b}, {c}, {a})');
    expect(parsed.ok && parsed.refs).toEqual(['a', 'b', 'c']);
  });
});

describe('if in a formula field', () => {
  it('validates and computes on a record', () => {
    const collection = {
      id: 'orders',
      name: '订单',
      fields: [
        { id: 'total', name: '金额', type: 'money' as const, currency: 'CNY' },
        {
          id: 'pay',
          name: '实付',
          type: 'formula' as const,
          expression: 'if({total} >= 100, {total} * 0.9, {total})',
          currency: 'CNY',
        },
      ],
    };
    const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22) };
    const ok = prepareOps(
      createDefaultWorkspace('zh'),
      [{ op: 'addData', table: collection }],
      ctx,
    );
    expect(ok.ok).toBe(true);
    const record = {
      id: 'r',
      collectionId: 'orders',
      values: { total: 150 },
      createdAt: 0,
      updatedAt: 0,
    };
    expect(recordValue(record, collection, 'pay')).toBe(135);

    const bad = {
      ...collection,
      fields: [
        collection.fields[0]!,
        { ...collection.fields[1]!, expression: 'if({total} > 1, {missing}, 0)' },
      ],
    };
    const rejected = prepareOps(createDefaultWorkspace('zh'), [{ op: 'addData', table: bad }], ctx);
    expect(rejected.ok).toBe(false);
  });
});

describe('dates in formulas (D-247)', () => {
  const collection = {
    id: 'bills',
    name: '账单',
    fields: [
      { id: 'due', name: '到期日', type: 'date' as const },
      { id: 'paid', name: '付款日', type: 'date' as const },
      { id: 'amount', name: '金额', type: 'money' as const, currency: 'CNY' },
      {
        id: 'left',
        name: '还剩几天',
        type: 'formula' as const,
        expression: 'days(today, {due})',
        decimals: 0,
        unit: '天',
      },
      {
        id: 'late',
        name: '滞纳金',
        type: 'formula' as const,
        expression: 'if({paid} > {due}, days({due}, {paid}) * 5, 0)',
      },
    ],
  };
  const record = (values: Record<string, unknown>) => ({
    id: 'r',
    collectionId: 'bills',
    values,
    createdAt: 0,
    updatedAt: 0,
  });

  it('counts the days left until a date, as of the given day', () => {
    const r = record({ due: '2026-11-01' });
    expect(recordValue(r, collection, 'left', new Date(2026, 9, 22, 23, 30))).toBe(10);
    // 跨过夏令时切换（欧洲 10 月 25 日）也是整天数。
    expect(recordValue(r, collection, 'left', new Date(2026, 9, 31))).toBe(1);
    expect(
      recordValue(record({ due: '2026-10-01' }), collection, 'left', new Date(2026, 9, 22)),
    ).toBe(-21);
  });

  it('compares two dates and multiplies the days between them', () => {
    const now = new Date(2026, 9, 22);
    expect(
      recordValue(record({ due: '2026-10-10', paid: '2026-10-13' }), collection, 'late', now),
    ).toBe(15);
    expect(
      recordValue(record({ due: '2026-10-10', paid: '2026-10-09' }), collection, 'late', now),
    ).toBe(0);
  });

  it('has no value when a date field is empty', () => {
    const now = new Date(2026, 9, 22);
    expect(recordValue(record({}), collection, 'left', now)).toBeUndefined();
    expect(recordValue(record({ due: '2026-10-10' }), collection, 'late', now)).toBeUndefined();
  });

  it('a date can only go into days() or a comparison, and the result must be a number', () => {
    const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22) };
    const withFormula = (expression: string) =>
      prepareOps(
        createDefaultWorkspace('zh'),
        [
          {
            op: 'addData',
            table: {
              ...collection,
              fields: [
                ...collection.fields.slice(0, 3),
                { id: 'f', name: 'f', type: 'formula', expression },
              ],
            },
          },
        ],
        ctx,
      ).ok;
    expect(withFormula('days(today, {due})')).toBe(true);
    expect(withFormula('if({due} < today, 1, 0) * {amount}')).toBe(true);
    for (const bad of [
      '{due} + 1',
      '{due} - {paid}',
      'days({amount}, {due})',
      'if({due} > 3, 1, 0)',
      'if({amount} > 3, {due}, 0)',
      'today',
      '-{due}',
    ]) {
      expect(withFormula(bad), bad).toBe(false);
    }
  });
});
