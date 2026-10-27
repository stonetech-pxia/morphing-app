import { z } from 'zod';

import { FILE_ID } from '../field-values';
import { t } from '../messages';
import { IdSchema } from '../schema-primitives';
import { defineField, fieldBase, isText, type FieldDefinitionOf } from './define';

const schema = z.strictObject({ ...fieldBase, type: z.literal('link'), collectionId: IdSchema });

const isRecordId = (v: unknown): v is string => typeof v === 'string' && FILE_ID.test(v);

/**
 * D-250：引用另一张表（也可以是自己）的一条记录；值是那条记录的 ID，列表里显示它的标题字段。
 * 被引用的记录删掉了时显示「已删除的记录」；只能看有没有选，不能按它排序。
 */
export const linkField: FieldDefinitionOf<'link', typeof schema> = defineField({
  type: 'link',
  schema,
  label: ['引用', 'link to another table'],
  read: (_f, raw) => (isRecordId(raw) ? raw : undefined),
  write: (_f, input) => (isRecordId(input) ? { value: input } : { issue: 'invalid' }),
  format: (f, v, locale, links) =>
    links ? (links(f.collectionId, v as string) ?? t(locale, 'linkDeleted')) : '',
  filter: { is: isText, emptyOnly: true },
  sort: false,
  // D-250：引用的表要存在。
  check: (f, { config, collection }) =>
    config.collections.some((c) => c.id === f.collectionId)
      ? []
      : [
          {
            code: 'data',
            message: `${collection.id}.${f.id}: links to missing table ${f.collectionId}`,
          },
        ],
  ai: {
    doc: "{collectionId} (picks one entry of another table, or of the same table; lists show that entry's first text field)",
    docAfter: 'formula',
  },
  example: { id: 'parent', name: 'Parent', type: 'link', collectionId: 'expenses' },
  exampleValue: 'r1',
});
