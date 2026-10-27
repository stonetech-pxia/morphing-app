import { z } from 'zod';

import { FILE_ID, MAX_ATTACHMENTS } from '../field-values';
import { t } from '../messages';
import { defineField, fieldBase, isText, type FieldDefinitionOf } from './define';

const schema = z.strictObject({ ...fieldBase, type: z.literal('file') });

const isFileId = (v: unknown): v is string => typeof v === 'string' && FILE_ID.test(v);

/** 去掉重复的 ID，保留第一次出现的顺序。 */
const unique = (ids: readonly string[]) => [...new Set(ids)];

/**
 * D-187、D-263：附件，值是一组 Morph 里的文件 ID（有顺序，最多 20 个）。用户在表单里选的照片和文件、
 * 快捷操作「记一笔」存进来的收据都放在这里。读取宽容：旧数据里的单个 ID 当成只有一个文件的一组，
 * 坏的 ID 和超出上限的不显示；写入一律写成一组。
 */
export const fileField: FieldDefinitionOf<'file', typeof schema> = defineField({
  type: 'file',
  schema,
  label: ['附件', 'attachment'],
  read: (_f, raw) => {
    const ids = isFileId(raw)
      ? [raw]
      : Array.isArray(raw)
        ? unique(raw.filter(isFileId)).slice(0, MAX_ATTACHMENTS)
        : [];
    return ids.length > 0 ? ids : undefined;
  },
  write: (_f, input) => {
    const list: unknown[] = Array.isArray(input) ? input : [input];
    if (!list.every(isFileId)) return { issue: 'invalid' };
    const ids = unique(list as string[]);
    if (ids.length > MAX_ATTACHMENTS) return { issue: 'tooLong' };
    return { value: ids };
  },
  format: (_f, v, locale) => t(locale, 'data_attachments', { n: Array.isArray(v) ? v.length : 1 }),
  // is / isNot：有没有这个文件。
  filter: { is: isText },
  // 按文件个数排。
  sort: (_f, v) => (Array.isArray(v) ? v.length : 0),
  ai: {
    doc: '(an attachment: a file saved in Morph, put there by out.addRecord)',
  },
  example: { id: 'receipt', name: 'Receipt', type: 'file' },
  exampleValue: ['asset1'],
});
