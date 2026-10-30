import { z } from 'zod';

import { formatNumber } from '../field-values';
import {
  DaysSchema,
  IdSchema,
  SEQUENCE_AGGREGATES,
  boundedText,
  filterSchema,
} from '../schema-primitives';
import { isSequenceAggregate, sequenceText } from '../sequence-text';
import { defineField, isNumber, readNumber, type FieldDefinitionOf } from './define';

/** 汇总的算法：计数、求和、平均、最小、最大、最近一条的值，以及按日子算的那几种（D-284）。 */
export const ROLLUP_AGGREGATES = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'latest',
  ...SEQUENCE_AGGREGATES,
] as const;

const schema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
  type: z.literal('rollup'),
  table: IdSchema,
  via: IdSchema,
  aggregate: z.enum(ROLLUP_AGGREGATES),
  field: IdSchema.optional(),
  // v33 的 period 迁移成这里末尾的一条 inPeriod，所以最多 6 条（M3）。
  filter: filterSchema(6).optional(),
  days: DaysSchema.optional(),
});

/**
 * D-288：汇总。统计另一张表（table）里引用字段 via 指向这条记录的那些记录（可以再按 filter 筛，
 * 时间段也写在 filter 里），不存进记录、不能填。计数和按日子算的值是数字（连续天数显示「3 天」）；求和、平均、
 * 最小、最大和 latest 按 field 的类型显示（related.ts 的 expandCollection），latest 不写 field 时取日期。
 * 按日子算的参数在 days 里（和数字块共用一种写法）。
 */
export const rollupField: FieldDefinitionOf<'rollup', typeof schema> = defineField({
  type: 'rollup',
  schema,
  label: ['汇总', 'summary of linked entries'],
  read: readNumber,
  format: (f, v, locale) =>
    isSequenceAggregate(f.aggregate)
      ? sequenceText(f.aggregate, f.days?.unit, v as number, locale)
      : formatNumber(v as number, undefined, locale),
  formula: 'number',
  numeric: true,
  inForm: false,
  filter: { is: isNumber, compare: 'number' },
  ai: {
    doc: '{table, via, aggregate: "count"|"sum"|"avg"|"min"|"max"|"latest"|"streak"|"daysSince"|"avgInterval"|"distinctDays", field?, filter? (≤6; a period is an inPeriod condition), days? {date?, unit?, perUnit?, skip? {field, option}}} (computed: sums up the entries of `table` whose link field `via` picks this entry; rule 46)',
  },
  example: {
    id: 'children',
    name: 'Children',
    type: 'rollup',
    table: 'expenses',
    via: 'parent',
    aggregate: 'sum',
    field: 'weight',
  },
});
