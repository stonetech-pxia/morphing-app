import { z } from 'zod';

import { formatDuration } from '../field-values';
import { defineField, fieldBase, isNumber, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('duration'),
  default: z.number().int().min(0).max(1_000_000).optional(),
});

/** 最长约 1.9 年（分钟数）。 */
const MAX_MINUTES = 1_000_000;

const readMinutes = (_f: unknown, raw: unknown) =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= MAX_MINUTES
    ? raw
    : undefined;

/** 填写的时长：分钟数，或者「1:30」（几小时:几分，分钟要小于 60）。 */
function minutesOf(input: unknown): number | undefined {
  if (typeof input === 'number') return input;
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  const hm = /^(\d*)[:：](\d*)$/.exec(s);
  if (hm) {
    const minutes = Number(hm[2] || 0);
    if (minutes >= 60 || (hm[1] === '' && hm[2] === '')) return undefined;
    return Number(hm[1] || 0) * 60 + minutes;
  }
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
}

/**
 * D-279：时长，存成分钟数（整数），显示成 h:mm（「1:30」）。统计和图表能求和、平均，
 * 公式里就是分钟数（D-280）。
 */
export const durationField: FieldDefinitionOf<'duration', typeof schema> = defineField({
  type: 'duration',
  schema,
  label: ['时长', 'duration'],
  read: readMinutes,
  write: (_f, input) => {
    const n = minutesOf(input);
    if (n === undefined || !Number.isFinite(n) || n < 0 || n > MAX_MINUTES)
      return { issue: 'invalid' };
    return { value: Math.round(n) };
  },
  format: (_f, v) => formatDuration(v as number),
  formatAmount: (_f, n) => formatDuration(n),
  print: {
    numeric: true,
    total: { rank: 3, format: (_f, sum) => formatDuration(sum) },
  },
  formula: 'number',
  numeric: true,
  filter: { is: isNumber, compare: 'number' },
  ai: {
    doc: '{default? minutes} (a length of time in minutes, shown as h:mm; rule 42)',
  },
  example: { id: 'spent', name: 'Time spent', type: 'duration' },
  exampleValue: 90,
});
