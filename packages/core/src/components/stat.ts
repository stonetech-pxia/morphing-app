import { z } from 'zod';

import { boundedText, ConditionSchema, IdSchema } from '../schema-base';
import { defineComponent } from './define';

/**
 * 统计：对一张表（可筛选）计数或求和、平均、最小、最大。
 * groupBy（D-248）：按一个单选字段分组，每个选项一行（没选的记录另算一行）。
 */
export const statComponent = defineComponent({
  type: 'stat',
  props: z.strictObject({
    collectionId: IdSchema,
    aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']),
    fieldId: IdSchema.optional(),
    filter: z.array(ConditionSchema).max(5).optional(),
    label: boundedText(1, 40),
    groupBy: IdSchema.optional(),
  }),
  refs: {
    collectionId: { to: 'collection' },
    filter: { to: 'filter' },
    groupBy: { to: 'field', types: ['choice'] },
  },
});
