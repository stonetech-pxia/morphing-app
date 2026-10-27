import { z } from 'zod';

import { t } from '../messages';
import { defineField, fieldBase, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('checkbox'),
  default: z.boolean().optional(),
});

/** 勾选：是或否；新记录没勾选就是否。 */
export const checkboxField: FieldDefinitionOf<'checkbox', typeof schema> = defineField({
  type: 'checkbox',
  schema,
  label: ['勾选', 'checkbox'],
  read: (_f, raw) => (typeof raw === 'boolean' ? raw : undefined),
  write: (_f, input) => (typeof input === 'boolean' ? { value: input } : { issue: 'invalid' }),
  emptyNew: false,
  format: (_f, v, locale) => (v ? t(locale, 'data_Yes_1f54e') : t(locale, 'data_No_04a4b')),
  filter: { is: (_f, v) => typeof v === 'boolean' },
  ai: { doc: '{default?}' },
  example: { id: 'done', name: 'Done', type: 'checkbox' },
  exampleValue: true,
});
