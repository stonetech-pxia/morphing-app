import { z } from 'zod';

import { ScheduleRuleSchema, readSchedule, scheduleText, type ScheduleRule } from '../schedule';
import { IdSchema } from '../schema-primitives';
import { defineField, fieldBase, type FieldDefinitionOf } from './define';

/**
 * 「上次完成」可以来自同一张表的哪些字段（D-293）：日期、日期时间，或者汇总字段（D-288，用被汇总的那些
 * 记录的全部日子，见 data.ts 的 rollupDays）。
 */
export const SCHEDULE_LAST_DONE_TYPES: readonly string[] = ['date', 'datetime', 'rollup'];

const schema = z.strictObject({
  ...fieldBase,
  type: z.literal('schedule'),
  default: ScheduleRuleSchema.optional(),
  lastDone: IdSchema.optional(),
});

/**
 * D-292：日程，每条记录存一份重复规则（用户在表单里设，default 是新记录的规则）。显示成「规则 · 下一次」；
 * 筛选（due、inPeriod、gt / lt）、排序和公式按算出来的下一次（D-294、D-295）。lastDone 是同一张表里
 * 记「上次完成」的日期或日期时间字段（D-293）；没有它就只按规则本身算。
 */
export const scheduleField: FieldDefinitionOf<'schedule', typeof schema> = defineField({
  type: 'schedule',
  schema,
  label: ['日程', 'schedule'],
  read: (_f, raw) => readSchedule(raw),
  write: (_f, input) => {
    const rule = readSchedule(input);
    return rule ? { value: rule } : { issue: 'invalid' };
  },
  initial: (f) => f.default,
  // 只有规则；记录上的「· 下一次」由 data.ts 的 formatRef 加上（要整条记录才能算）。
  format: (_f, v, locale) => scheduleText(v as ScheduleRule, locale),
  formula: 'date',
  filter: { is: () => false, compare: 'date', period: true, schedule: true },
  check: (f, { collection }) => {
    if (f.lastDone === undefined) return [];
    const source = collection.fields.find((x) => x.id === f.lastDone);
    if (source && SCHEDULE_LAST_DONE_TYPES.includes(source.type)) return [];
    return [
      {
        code: 'data',
        message: `${collection.id}.${f.id}: lastDone ${f.lastDone} must be a date, datetime or rollup field of ${collection.id}`,
      },
    ];
  },
  ai: {
    doc: '{default?: Rule, lastDone?: fieldId of a date, datetime or rollup field} (a repeat rule each entry keeps; rule 48)',
  },
  example: {
    id: 'plan',
    name: 'Plan',
    type: 'schedule',
    default: { repeat: 'interval', every: 7 },
  },
  exampleValue: { repeat: 'weekdays', days: [1, 3, 5] },
});
