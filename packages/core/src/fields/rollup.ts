import { z } from 'zod';

import { formatNumber } from '../field-values';
import {
  ConditionSchema,
  FieldRefSchema,
  IdSchema,
  PERIODS,
  SEQUENCE_AGGREGATES,
  STREAK_UNITS,
  boundedText,
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
  collectionId: IdSchema,
  linkField: IdSchema,
  aggregate: z.enum(ROLLUP_AGGREGATES),
  fieldId: IdSchema.optional(),
  dateField: FieldRefSchema.optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  period: z.enum(PERIODS).optional(),
  unit: z.enum(STREAK_UNITS).optional(),
  perUnit: z.number().int().min(1).max(50).optional(),
  skipField: IdSchema.optional(),
  skipOption: IdSchema.optional(),
});

/**
 * D-288：汇总。统计另一张表（collectionId）里引用字段 linkField 指向这条记录的那些记录（可以再按 filter、
 * period 筛），不存进记录、不能填。计数和按日子算的值是数字（连续天数显示「3 天」）；求和、平均、最小、最大
 * 和 latest 按 fieldId 的类型显示（related.ts 的 expandCollection），latest 不写 fieldId 时取日期。
 */
export const rollupField: FieldDefinitionOf<'rollup', typeof schema> = defineField({
  type: 'rollup',
  schema,
  label: ['汇总', 'summary of linked entries'],
  read: readNumber,
  format: (f, v, locale) =>
    isSequenceAggregate(f.aggregate)
      ? sequenceText(f.aggregate, f.unit, v as number, locale)
      : formatNumber(v as number, undefined, locale),
  formula: 'number',
  numeric: true,
  inForm: false,
  filter: { is: isNumber, compare: 'number' },
  ai: {
    doc: '{collectionId, linkField, aggregate: "count"|"sum"|"avg"|"min"|"max"|"latest"|"streak"|"daysSince"|"avgInterval"|"distinctDays", fieldId?, filter?, period?, dateField?, unit?, perUnit?, skipField? + skipOption?} (computed: sums up the entries of table collectionId whose link field linkField picks this entry; rule 46)',
  },
  example: {
    id: 'children',
    name: 'Children',
    type: 'rollup',
    collectionId: 'expenses',
    linkField: 'parent',
    aggregate: 'sum',
    fieldId: 'weight',
  },
});
