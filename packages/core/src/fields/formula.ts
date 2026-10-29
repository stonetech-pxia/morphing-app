import { z } from 'zod';

import { formatMoney } from '../field-values';
import { MAX_FORMULA_LENGTH, formulaType, parseFormula } from '../formula';
import type { Collection } from '../schema';
import { IdSchema, boundedText, type Locale } from '../schema-primitives';
import { defineField, isNumber, numberWithUnit, type FieldDefinitionOf } from './define';
// 只在检查时用（运行时才取），不会在加载时互相引用。
import { fieldDefinition } from './index';

const schema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
  type: z.literal('formula'),
  expression: boundedText(1, MAX_FORMULA_LENGTH),
  decimals: z.number().int().min(0).max(4).optional(),
  unit: boundedText(1, 10).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'currency must be an ISO code like CNY')
    .optional(),
});

const show = (f: z.infer<typeof schema>, n: number, locale: Locale) =>
  f.currency ? formatMoney(n, f.currency, locale) : numberWithUnit(n, f, locale);

/**
 * D-188：公式，由同一张表的数字、金额、评分、日期字段算出来（四则运算、if、days），不存进记录、不能填。
 * 引用的字段都在这张表里、能用在公式里（定义的 formula），结果是数字（D-247）。
 * D-280 起也能用时间类字段和 min / max / round / abs；D-281 起能引用别的公式，但不能绕回自己。
 */
export const formulaField: FieldDefinitionOf<'formula', typeof schema> = defineField({
  type: 'formula',
  schema,
  label: ['公式', 'formula'],
  read: () => undefined,
  shown: (_f, raw) => (typeof raw === 'number' ? raw : undefined),
  format: (f, v, locale) => show(f, v as number, locale),
  csv: (_f, v) => String(v),
  formatAmount: (f, n, locale) => show(f, n, locale),
  formula: 'number',
  numeric: true,
  inForm: false,
  filter: { is: isNumber, compare: 'number' },
  // 查找、汇总、上一条（D-287–D-289）按它们显示的那种字段算。
  check: (f, { collection, view }) =>
    formulaProblems(f.id, f.expression, view).map((problem) => ({
      code: 'data',
      message: `${collection.id}.${f.id}: ${problem}`,
    })),
  ai: {
    doc: '{expression, decimals? 0-4, unit?, currency?} (computed, never typed in: + - * / and parentheses over {fieldId} of number, money, rating, duration or other formula fields of the same table, e.g. "{price} * {qty}"; no required/default)',
  },
  example: {
    id: 'total',
    name: 'Total',
    type: 'formula',
    expression: '{weight} * 2',
    decimals: 1,
    unit: 'kg',
  },
});

function formulaProblems(fieldId: string, expression: string, collection: Collection): string[] {
  const { fields } = collection;
  const parsed = parseFormula(expression);
  if (!parsed.ok) return [`formula "${expression}": ${parsed.error}`];
  const kind = (id: string) => {
    const ref = fields.find((f) => f.id === id);
    return ref && fieldDefinition(ref.type).formula;
  };
  const problems: string[] = [];
  for (const id of parsed.refs) {
    if (!fields.some((f) => f.id === id))
      problems.push(`formula uses ${id}, which is not a field of ${collection.id}`);
    else if (!kind(id))
      problems.push(
        `formula uses ${id}, which is not a number, money, rating, duration, date, time, datetime or formula field`,
      );
  }
  if (problems.length > 0) return problems;
  const type = formulaType(parsed.node, (id) => kind(id) ?? null);
  if (typeof type !== 'string') return [`formula "${expression}": ${type.error}`];
  if (type !== 'number')
    return [
      `formula "${expression}" gives a ${type}; use ${type === 'date' ? 'days(from, to)' : 'hours(from, to) or minutes(from, to)'} to get a number`,
    ];
  const loop = formulaLoop(fieldId, collection);
  if (loop)
    return [
      `formula uses itself through ${loop.join(' → ')}; a formula can use other formulas but never one that comes back to it`,
    ];
  return [];
}

/** D-281：从这个公式出发沿着引用的公式走，能回到自己时返回那一圈（字段 ID），否则 null。 */
function formulaLoop(start: string, collection: Collection): string[] | null {
  const refsOf = (id: string): string[] => {
    const f = collection.fields.find((x) => x.id === id);
    if (f?.type !== 'formula') return [];
    const parsed = parseFormula(f.expression);
    return parsed.ok ? parsed.refs : [];
  };
  const seen = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    for (const next of refsOf(id)) {
      if (next === start) return [...path, next];
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [start]);
}
