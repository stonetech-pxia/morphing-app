import { z } from 'zod';

// 配置里最基本的写法（语言、ID、有长度限制的文字）。字段定义（fields/）只依赖这里，
// 这样 schema-base.ts 可以从字段定义生成字段的结构，不会互相引用。对外从 schema.ts 导出。

export type Locale = 'en' | 'zh' | 'fr';
export type Localized = Record<Locale, string>;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const IdSchema = z.string().regex(ID_PATTERN, 'id must be lowercase letters, digits or -');

/** 去掉首尾空白后长度在 min..max 之间的文字。 */
export const boundedText = (min: number, max: number) => z.string().trim().min(min).max(max);

// 字段定义（汇总字段的筛选和时间段，D-288）也要用到下面这些，所以放在这里。

/** 每条记录都有的系统字段。 */
export const SYSTEM_FIELDS = ['createdAt', 'updatedAt'] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];
export const FieldRefSchema = z.union([IdSchema, z.enum(SYSTEM_FIELDS)]);

/**
 * 时间段（筛选、in.records、file.filter 共用）。最近几天是固定几档（D-285）；thisTwoWeeks 从「设置 → 日期」的
 * 锚定日起每 14 天一段，thisHalfMonth 是 1–15 号或 16 号到月底。按「今天」算，今天从几点开始见 calendar.ts。
 */
export const PERIODS = [
  'today',
  'thisWeek',
  'thisMonth',
  'thisYear',
  'last7days',
  'last30days',
  'last14days',
  'last90days',
  'last365days',
  'thisTwoWeeks',
  'thisHalfMonth',
] as const;
export type Period = (typeof PERIODS)[number];

/** 按顺序的聚合（D-284，算法在 sequence.ts）：统计都能用，图表只能用 distinctDays。 */
export const SEQUENCE_AGGREGATES = ['streak', 'daysSince', 'avgInterval', 'distinctDays'] as const;
export type SequenceAggregate = (typeof SEQUENCE_AGGREGATES)[number];
export const STREAK_UNITS = ['day', 'week', 'month'] as const;
export type StreakUnit = (typeof STREAK_UNITS)[number];

/** 筛选条件：白名单比较，多个条件之间是“并且”，没有表达式。 */
export const ConditionSchema = z.strictObject({
  field: FieldRefSchema,
  op: z.enum(['is', 'isNot', 'contains', 'gt', 'lt', 'isEmpty', 'isNotEmpty', 'inPeriod']),
  value: z.union([z.string().max(200), z.number().finite(), z.boolean()]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;
