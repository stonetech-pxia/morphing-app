import { z } from 'zod';

import { defineField, fieldBase, isNumber, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('rating'),
  default: z.number().int().min(1).max(5).optional(),
});

const isStars = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

/** 评分：1 到 5 颗星。 */
export const ratingField: FieldDefinitionOf<'rating', typeof schema> = defineField({
  type: 'rating',
  schema,
  label: ['评分', 'rating'],
  read: (_f, raw) => (isStars(raw) ? raw : undefined),
  write: (_f, input) => {
    const n = typeof input === 'number' ? input : Number(input);
    return isStars(n) ? { value: n } : { issue: 'invalid' };
  },
  format: (_f, v) => '★'.repeat(v as number) + '☆'.repeat(5 - (v as number)),
  csv: (_f, v) => String(v),
  formula: 'number',
  numeric: true,
  filter: { is: isNumber, compare: 'number' },
  ai: { doc: '(1-5) {default?}' },
  example: { id: 'stars', name: 'Rating', type: 'rating' },
  exampleValue: 4,
});
