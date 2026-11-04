import type { Collection, Field } from './schema';

// 每一笔单独选货币（D-429）：金额还是数字，货币是同一张表里一个单选字段的值，金额字段用 currencyField 指向它。
// 选项 ID 就是小写的货币代码（usd、eur）。这条记录没选时用金额字段自己的 currency。不换算：不同货币不相加。

/** 选项 ID 必须是这样才能当货币代码。 */
export const CURRENCY_OPTION = /^[a-z]{3}$/;

export const hasRecordCurrency = (f: Field | undefined): boolean =>
  f?.type === 'money' && f.currencyField !== undefined;

/** 这条记录这个金额的货币代码（大写）。 */
export function recordCurrency(
  field: Extract<Field, { type: 'money' }>,
  values: Readonly<Record<string, unknown>>,
  collection: Collection,
): string {
  if (field.currencyField === undefined) return field.currency;
  const source = collection.fields.find((f) => f.id === field.currencyField);
  const id = values[field.currencyField];
  return source?.type === 'choice' &&
    typeof id === 'string' &&
    CURRENCY_OPTION.test(id) &&
    source.options.some((o) => o.id === id)
    ? id.toUpperCase()
    : field.currency;
}

/** 显示一条记录的金额时用的字段：货币换成这条记录自己的。别的字段原样返回。 */
export function fieldForRecord<F extends Field>(
  field: F,
  values: Readonly<Record<string, unknown>>,
  collection: Collection,
): F {
  return field.type === 'money' && field.currencyField !== undefined
    ? { ...field, currency: recordCurrency(field, values, collection) }
    : field;
}
