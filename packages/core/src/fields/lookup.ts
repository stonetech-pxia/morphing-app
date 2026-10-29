import { z } from 'zod';

import { IdSchema, boundedText } from '../schema-primitives';
import { defineField, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  id: IdSchema,
  name: boundedText(1, 40),
  type: z.literal('lookup'),
  linkField: IdSchema,
  fieldId: IdSchema,
});

/**
 * D-287：查找。从这条记录的引用字段（linkField）指向的那条记录取 fieldId 的值，不存进记录、不能填。
 * 显示、筛选、排序、公式、统计都按那个字段的类型（related.ts 的 expandCollection 把它换成那种字段）；
 * 没有引用、被引用的记录删掉了、或者那个字段没有值时为空。这里的回调只在定义对不上时用（只能看有没有值）。
 */
export const lookupField: FieldDefinitionOf<'lookup', typeof schema> = defineField({
  type: 'lookup',
  schema,
  label: ['查找', 'value from a linked entry'],
  read: () => undefined,
  format: () => '',
  inForm: false,
  filter: { is: () => false, emptyOnly: true },
  sort: false,
  ai: {
    doc: '{linkField, fieldId} (computed, never typed in: the value of field fieldId of the entry that the link field linkField of this table picks, shown, filtered, sorted and usable in formulas and stats like that field; rule 46)',
  },
  example: {
    id: 'looked',
    name: 'Looked up',
    type: 'lookup',
    linkField: 'parent',
    fieldId: 'weight',
  },
});
