import { z } from 'zod';

import { FILE_ID } from '../field-values';
import { t } from '../messages';
import { defineField, fieldBase, isText, type FieldDefinitionOf } from './define';

const schema = z.strictObject({ ...fieldBase, type: z.literal('file') });

const isFileId = (v: unknown): v is string => typeof v === 'string' && FILE_ID.test(v);

/** D-187：附件，值是 Morph 里一个文件的 ID（快捷操作「记一笔」存进来的收据、照片等）。 */
export const fileField: FieldDefinitionOf<'file', typeof schema> = defineField({
  type: 'file',
  schema,
  label: ['附件', 'attachment'],
  read: (_f, raw) => (isFileId(raw) ? raw : undefined),
  write: (_f, input) => (isFileId(input) ? { value: input } : { issue: 'invalid' }),
  format: (_f, _v, locale) => t(locale, 'data_Attachment_6f6cf'),
  inForm: false,
  filter: { is: isText },
  ai: { doc: '(an attachment: a file saved in Morph, put there by out.addRecord)' },
  example: { id: 'receipt', name: 'Receipt', type: 'file' },
  exampleValue: 'asset1',
});
