import { z } from 'zod';

import { formatMoney } from '../field-values';
import { CURRENCY_OPTION } from '../money-currency';
import { IdSchema } from '../schema-primitives';
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
  /** 每一笔单独选货币（D-429）：同一张表里的单选字段，选项 ID 是小写的货币代码；没选时用 currency。 */
  currencyField: IdSchema.optional(),
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
  check: (f, { collection }) => {
    if (f.currencyField === undefined) return [];
    const at = `${collection.id}.${f.id}`;
    const source = collection.fields.find((x) => x.id === f.currencyField);
    if (source?.type !== 'choice')
      return [
        {
          code: 'data',
          message: `${at}: currencyField ${f.currencyField} must be a choice field of ${collection.id}`,
        },
      ];
    const bad = source.options.filter((o) => !CURRENCY_OPTION.test(o.id)).map((o) => o.id);
    return bad.length > 0
      ? [
          {
            code: 'data',
            message: `${at}: every option id of ${source.id} must be a lowercase currency code like usd; not ${bad.join(', ')}`,
          },
        ]
      : [];
  },
  ai: {
    doc: '{currency: ISO code like "CNY"/"USD", currencyField?: id of a choice field of this table whose option ids are lowercase currency codes (usd, eur), labels the codes in capitals, so each entry picks its own currency; currency is used when none is picked, default?}',
  },
  example: { id: 'amount', name: 'Amount', type: 'money', currency: 'USD' },
  exampleValue: 12.5,
});
