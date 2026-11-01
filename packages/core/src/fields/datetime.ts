import { z } from 'zod';

import {
  formatTimestamp,
  isValidDate,
  isValidDateTime,
  localDateTime,
  normalizeTime,
} from '../field-values';
import { defineField, fieldBase, type FieldDefinitionOf } from './define';

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('datetime'),
  default: z.literal('now').optional(),
});

/** YYYY-MM-DDTHH:mm → 本地时间的毫秒数（显示用）。 */
const localMs = (v: string) => {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [h, min] = v.slice(11).split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, min).getTime();
};

/**
 * D-279：日期加时间，存成设备本地的 YYYY-MM-DDTHH:mm（不带时区）；default now = 新记录填现在。
 * 筛选和图表按它那一天（本地日期）算；公式里能放进 days()、hours()、minutes()（D-280）。
 */
export const datetimeField: FieldDefinitionOf<'datetime', typeof schema> = defineField({
  type: 'datetime',
  schema,
  label: ['日期时间', 'date and time'],
  read: (_f, raw) => (typeof raw === 'string' && isValidDateTime(raw) ? raw : undefined),
  write: (_f, input) => {
    // 「2026-10-29 08:30」「2026-10-29T08:30」，可以带秒（不存）。
    const m = typeof input === 'string' ? /^(\S{10})[T ]\s*(.+)$/.exec(input.trim()) : null;
    const time = m ? normalizeTime(m[2]!) : undefined;
    const value = m && time ? `${m[1]}T${time}` : '';
    return isValidDateTime(value) ? { value } : { issue: 'invalid' };
  },
  initial: (f, now) => (f.default === undefined ? undefined : localDateTime(now)),
  format: (_f, v, locale) => formatTimestamp(localMs(v as string), locale),
  csv: (_f, v) => String(v).replace('T', ' '),
  formula: 'datetime',
  filter: {
    // 一个日期（那一天的都算）或一个日期时间（正好那一刻）。
    is: (_f, v) => typeof v === 'string' && (isValidDate(v) || isValidDateTime(v)),
    compare: 'date',
    period: true,
  },
  day: (_f, v) => String(v).slice(0, 10),
  titleRank: 7,
  ai: { doc: '{default?: "now"} (a date with a time of day; rule 40)' },
  example: { id: 'when', name: 'When', type: 'datetime', default: 'now' },
  exampleValue: '2026-10-27T21:45',
});
