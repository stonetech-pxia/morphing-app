import { z } from 'zod';

import { isValidTime, normalizeTime } from '../field-values';
import { defineField, fieldBase, type FieldDefinitionOf } from './define';

const schema = z.strictObject({ ...fieldBase, type: z.literal('time') });

const readTime = (_f: unknown, raw: unknown) =>
  typeof raw === 'string' && isValidTime(raw) ? raw : undefined;

/** D-279：几点几分 HH:mm（没有日期）。公式里 hours / minutes 跨午夜时自动加 24 小时（D-280）。 */
export const timeField: FieldDefinitionOf<'time', typeof schema> = defineField({
  type: 'time',
  schema,
  label: ['时间', 'time'],
  read: readTime,
  write: (_f, input) => {
    const time = typeof input === 'string' ? normalizeTime(input) : undefined;
    return time ? { value: time } : { issue: 'invalid' };
  },
  // 三种语言都写 08:30（法语也是 24 小时制、冒号）。
  format: (_f, v) => String(v),
  formula: 'time',
  filter: { is: (_f, v) => readTime(_f, v) !== undefined, compare: 'time' },
  ai: { doc: '(a time of day "HH:mm"; rule 42)' },
  example: { id: 'start', name: 'Start', type: 'time' },
  exampleValue: '08:30',
});
