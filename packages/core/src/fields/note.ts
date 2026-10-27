import { z } from 'zod';

import { defineField, fieldBase, isText, type FieldDefinitionOf } from './define';

const schema = z.strictObject({ ...fieldBase, type: z.literal('note') });

/** 长文本（最多 5000 字，可以换行）。 */
export const noteField: FieldDefinitionOf<'note', typeof schema> = defineField({
  type: 'note',
  schema,
  label: ['长文本', 'long text'],
  read: (_f, raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  write: (_f, input) => {
    if (typeof input !== 'string') return { issue: 'invalid' };
    const s = input.replace(/\s+$/, '');
    return s.length > 5000 ? { issue: 'tooLong' } : { value: s };
  },
  format: (_f, v) => String(v),
  filter: { is: isText, contains: true },
  titleRank: 2,
  convertGroup: 'text',
  ai: { doc: '(long text)' },
  example: { id: 'body', name: 'Notes', type: 'note' },
  exampleValue: 'Two\nlines',
});
