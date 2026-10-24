import { describe, expect, it } from 'vitest';

import { evaluateFormula, parseFormula } from './formula';

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
      `{a}${' + 1'.repeat(60)}`,
    ]) {
      expect(parseFormula(bad).ok, bad).toBe(false);
    }
  });
});
