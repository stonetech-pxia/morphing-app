import { z } from 'zod';

import { boundedText, ConditionSchema, FieldRefSchema, IdSchema } from '../schema-base';
import { defineComponent } from './define';

/**
 * 图表（D-249）：一张表的记录按时间段（最近几天 / 周 / 月）或单选字段分组，柱状、折线或饼图。
 * 饼图只能按单选字段分。只有固定几种画法和聚合，没有表达式；记录只在本机读取。
 */
export const chartComponent = defineComponent({
  type: 'chart',
  props: z.strictObject({
    collectionId: IdSchema,
    kind: z.enum(['bar', 'line', 'pie']),
    aggregate: z.enum(['count', 'sum', 'avg']),
    fieldId: IdSchema.optional(),
    group: z.enum(['day', 'week', 'month', 'choice']),
    dateField: FieldRefSchema.optional(),
    choiceField: IdSchema.optional(),
    periods: z.number().int().min(2).max(31).optional(),
    filter: z.array(ConditionSchema).max(5).optional(),
    title: boundedText(1, 60),
  }),
  refs: { collectionId: { to: 'collection' }, filter: { to: 'filter' } },
});
