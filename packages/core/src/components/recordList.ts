import { z } from 'zod';

import { boundedText, ConditionSchema, FieldRefSchema, IdSchema, SortSchema } from '../schema-base';
import { defineComponent } from './define';

/** 记录列表：展示某张数据表的记录；checklist 用一个 checkbox 字段直接打勾。 */
export const recordListComponent = defineComponent({
  type: 'recordList',
  props: z.strictObject({
    collectionId: IdSchema,
    display: z.enum(['list', 'cards', 'checklist']),
    titleField: FieldRefSchema,
    subtitleFields: z.array(FieldRefSchema).max(2).optional(),
    /** 显示在右侧的字段，例如金额。 */
    trailingField: FieldRefSchema.optional(),
    checkField: IdSchema.optional(),
    filter: z.array(ConditionSchema).max(5).optional(),
    sort: SortSchema.optional(),
    limit: z.number().int().min(1).max(100),
    emptyText: boundedText(1, 80).optional(),
  }),
  refs: {
    collectionId: { to: 'collection' },
    titleField: { to: 'field' },
    subtitleFields: { to: 'field', role: 'subtitleField' },
    trailingField: { to: 'field' },
    filter: { to: 'filter' },
  },
});
