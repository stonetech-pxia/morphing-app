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
  numeric: true,
  inForm: false,
  filter: { is: isNumber, compare: 'number' },
  check: (f, { collection }) =>
    formulaProblems(f.expression, collection).map((problem) => ({
      code: 'data',
      message: `${collection.id}.${f.id}: ${problem}`,
    })),
  ai: {
    doc: '{expression, decimals? 0-4, unit?, currency?} (computed, never typed in: + - * / and parentheses over {fieldId} of number, money or rating fields of the same table, e.g. "{price} * {qty}"; no required/default)',
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

function formulaProblems(expression: string, collection: Collection): string[] {
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
      problems.push(`formula uses ${id}, which is not a number, money, rating or date field`);
  }
  if (problems.length > 0) return problems;
  const type = formulaType(parsed.node, (id) => (kind(id) === 'date' ? 'date' : 'number'));
  if (typeof type !== 'string') return [`formula "${expression}": ${type.error}`];
  if (type !== 'number')
    return [`formula "${expression}" gives a date; use days(from, to) to get a number`];
  return [];
}
