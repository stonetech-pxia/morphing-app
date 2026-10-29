import { z } from 'zod';

import { FieldRefSchema, IdSchema, boundedText } from '../schema-primitives';
import { defineField, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
  type: z.literal('previous'),
  fieldId: IdSchema,
  dateField: FieldRefSchema.optional(),
  groupBy: IdSchema.optional(),
});

/**
 * D-289：上一条。同一张表里、同一组（groupBy：一个单选或引用字段，不写就是整张表）、按日期
 * （dateField，默认第一个日期字段，再没有就是第一个日期时间字段、创建时间）排在这条之前、fieldId 有值的
 * 那一条的 fieldId。不存进记录、不能填；按 fieldId 的类型显示，进公式算差值（两次加油之间的里程）。
 */
export const previousField: FieldDefinitionOf<'previous', typeof schema> = defineField({
  type: 'previous',
  schema,
  label: ['上一条的值', 'value of the previous entry'],
  read: () => undefined,
  format: () => '',
  inForm: false,
  filter: { is: () => false, emptyOnly: true },
  sort: false,
  ai: {
    doc: '{fieldId, dateField?, groupBy?} (computed: the value of fieldId on the entry just before this one by date in the same table, or in the same group when groupBy names a choice or link field; rule 47)',
  },
  example: { id: 'before', name: 'Before', type: 'previous', fieldId: 'weight' },
});
