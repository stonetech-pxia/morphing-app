import { z } from 'zod';

import { formatMoney } from '../field-values';
import {
  defineField,
  fieldBase,
  isNumber,
  readNumber,
  writeNumber,
  type FieldDefinitionOf,
} from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('money'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO code like CNY'),
  default: z.number().finite().optional(),
});

/** 金额：两位小数，按货币显示。 */
export const moneyField: FieldDefinitionOf<'money', typeof schema> = defineField({
  type: 'money',
  schema,
  label: ['金额', 'money'],
  read: readNumber,
  write: (_f, input) => writeNumber(input, 2),
  format: (f, v, locale) => formatMoney(v as number, f.currency, locale),
  csv: (_f, v) => (v as number).toFixed(2),
  formatAmount: (f, n, locale) => formatMoney(n, f.currency, locale),
  print: {
    numeric: true,
    total: { rank: 1, format: (f, sum, locale) => formatMoney(sum, f.currency, locale) },
  },
  formula: 'number',
  numeric: true,
  filter: { is: isNumber, compare: 'number' },
  titleRank: 5,
  convertGroup: 'number',
  ai: { doc: '{currency: ISO code like "CNY"/"USD", default?}' },
  example: { id: 'amount', name: 'Amount', type: 'money', currency: 'USD' },
  exampleValue: 12.5,
});
