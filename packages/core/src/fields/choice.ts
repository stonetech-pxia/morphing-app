import { z } from 'zod';

import { IdSchema, boundedText } from '../schema-primitives';
import { defineField, fieldBase, type FieldDefinitionOf } from './define';

export const ChoiceOptionSchema = z.strictObject({ id: IdSchema, label: boundedText(1, 40) });

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('choice'),
  options: z.array(ChoiceOptionSchema).min(1).max(50),
  default: IdSchema.optional(),
});

const isOption = (f: { options: { id: string }[] }, v: unknown) =>
  typeof v === 'string' && f.options.some((o) => o.id === v);

/** 单选：值是选项 ID；按选项顺序排序，统计可以按它分组（D-248）。 */
export const choiceField: FieldDefinitionOf<'choice', typeof schema> = defineField({
  type: 'choice',
  schema,
  label: ['单选', 'choice'],
  read: (f, raw) => (isOption(f, raw) ? (raw as string) : undefined),
  write: (f, input) => (isOption(f, input) ? { value: input as string } : { issue: 'invalid' }),
  format: (f, v) => f.options.find((o) => o.id === v)?.label ?? '',
  filter: { is: isOption },
  sort: (f, v) => f.options.findIndex((o) => o.id === v),
  titleRank: 3,
  check: (f, { collection }) => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const o of f.options) (seen.has(o.id) ? dup : seen).add(o.id);
    return [
      ...[...dup].map((id) => ({
        code: 'duplicate',
        message: `option ${id} in ${collection.id}.${f.id}`,
      })),
      ...(f.default !== undefined && !f.options.some((o) => o.id === f.default)
        ? [
            {
              code: 'data',
              message: `${collection.id}.${f.id}: default ${f.default} is not an option`,
            },
          ]
        : []),
    ];
  },
  ai: { doc: '{options: [{id, label}] (1-50), default?: optionId}' },
  example: {
    id: 'category',
    name: 'Category',
    type: 'choice',
    options: [
      { id: 'food', label: 'Food' },
      { id: 'other', label: 'Other' },
    ],
  },
  exampleValue: 'food',
});
