import { z } from 'zod';

import { boundedText } from '../schema-primitives';
import { defineField, fieldBase, isText, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('text'),
  default: boundedText(1, 200).optional(),
});

/** 一行文字（最多 200 字）。 */
export const textField: FieldDefinitionOf<'text', typeof schema> = defineField({
  type: 'text',
  schema,
  label: ['文字', 'text'],
  read: (_f, raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  write: (_f, input) => {
    if (typeof input !== 'string') return { issue: 'invalid' };
    const s = input.trim();
    return s.length > 200 ? { issue: 'tooLong' } : { value: s };
  },
  format: (_f, v) => String(v),
  filter: { is: isText, contains: true },
  titleRank: 1,
  convertGroup: 'text',
  ai: { doc: '{default?} (≤200 chars)' },
  example: { id: 'title', name: 'Title', type: 'text', required: true },
  exampleValue: 'Lunch',
});
