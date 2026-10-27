import { z } from 'zod';

import { formatNumber } from '../field-values';
import { boundedText } from '../schema-primitives';
import {
  defineField,
  fieldBase,
  isNumber,
  numberWithUnit,
  readNumber,
  writeNumber,
  type FieldDefinitionOf,
} from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('number'),
  decimals: z.number().int().min(0).max(4).optional(),
  unit: boundedText(1, 10).optional(),
  default: z.number().finite().optional(),
});

/** 数字，可以有小数位和单位。 */
export const numberField: FieldDefinitionOf<'number', typeof schema> = defineField({
  type: 'number',
  schema,
  label: ['数字', 'number'],
  read: readNumber,
  write: (f, input) => writeNumber(input, f.decimals ?? 4),
  format: (f, v, locale) => numberWithUnit(v as number, f, locale),
  csv: (_f, v) => String(v),
  formatAmount: (f, n, locale) => numberWithUnit(n, f, locale),
  print: {
    numeric: true,
    total: { rank: 2, format: (f, sum, locale) => formatNumber(sum, f.decimals, locale) },
  },
  formula: 'number',
  numeric: true,
  filter: { is: isNumber, compare: 'number' },
  titleRank: 4,
  convertGroup: 'number',
  ai: { doc: '{decimals? 0-4, unit?, default?}' },
  example: { id: 'weight', name: 'Weight', type: 'number', decimals: 1, unit: 'kg' },
  exampleValue: 2.5,
});
