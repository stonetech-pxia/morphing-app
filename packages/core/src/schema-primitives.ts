import { z } from 'zod';

// 配置里最基本的写法（语言、ID、有长度限制的文字）。字段定义（fields/）只依赖这里，
// 这样 schema-base.ts 可以从字段定义生成字段的结构，不会互相引用。对外从 schema.ts 导出。

export type Locale = 'en' | 'zh' | 'fr';
export type Localized = Record<Locale, string>;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
/**
 * 「这一条记录」（D-342）：只能写在给某张表的一条记录用的页面（page.recordOf）上，筛选里引用字段 is / isNot
 * 它、新建时引用字段设成它；打开页面时换成那条记录的 ID（record-pages.ts 的 bindRecord）。
 */
export const RECORD_REF = '$record';
/**
 * 工具作用的那一条（v34）：列表的这一行、大圆块这一块、通知说的那一条。v33 写作 "row"（只在引用字段上）。
 * $group 是拖到的那一栏 / 那一段的值，$here 是就地添加时「这一段的值 + 列表筛选里的等于条件」。
 */
export const ROW_REF = '$row';
export const GROUP_REF = '$group';
export const HERE_REF = '$here';

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

/** 按顺序的聚合（D-284，算法在 sequence.ts）：数字块都能用，图表只能用 distinctDays。 */
export const SEQUENCE_AGGREGATES = ['streak', 'daysSince', 'avgInterval', 'distinctDays'] as const;
export type SequenceAggregate = (typeof SEQUENCE_AGGREGATES)[number];
export const STREAK_UNITS = ['day', 'week', 'month'] as const;
export type StreakUnit = (typeof STREAK_UNITS)[number];

/** 筛选条件：白名单比较，多个条件之间是“并且”，没有表达式。 */
export const ConditionSchema = z.strictObject({
  field: FieldRefSchema,
  op: z.enum(['is', 'isNot', 'contains', 'gt', 'lt', 'isEmpty', 'isNotEmpty', 'inPeriod', 'due']),
  value: z.union([z.string().max(200), z.number().finite(), z.boolean()]).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

/** 筛选：多个条件之间是「并且」（≤5；汇总字段 ≤6，v33 的 period 迁移成一条 inPeriod，M3）。 */
export const filterSchema = (max = 5) => z.array(ConditionSchema).max(max);
export type Filter = Condition[];

/**
 * 聚合（v34 一份列表）：每个地方允许哪几种由检查定——数字块全部（除 latest），图表 count / sum / avg /
 * distinctDays，汇总字段全部。
 */
export const AGGREGATES = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'latest',
  ...SEQUENCE_AGGREGATES,
] as const;
export type Aggregate = (typeof AGGREGATES)[number];

/**
 * 按日子算的参数（v33 在 stat 和 rollup 上各写一遍 dateField / unit / perUnit / skipField / skipOption）。
 * date 不写 = 表里第一个日期字段，没有就第一个日期时间字段，再没有就创建时间；unit、perUnit、skip 只给 streak。
 */
export const DaysSchema = z.strictObject({
  date: FieldRefSchema.optional(),
  unit: z.enum(STREAK_UNITS).optional(),
  perUnit: z.number().int().min(1).max(50).optional(),
  skip: z.strictObject({ field: IdSchema, option: IdSchema }).optional(),
});
export type Days = z.infer<typeof DaysSchema>;

/** 分组的时间单位（列表分段、图表、月历）。 */
export const GROUP_UNITS = ['day', 'week', 'month'] as const;
export type GroupUnit = (typeof GROUP_UNITS)[number];

/**
 * 分组（v34 一种写法；v33 有 stat.groupBy、chart.group + choiceField / dateField + periods、
 * recordList.groupField + groupFilter、recordList.groupBy + groupUnit + showEmpty、calendar + dateField 六种）。
 * by：单选、引用每个选项（被引用的每条）一组；日期类按 unit 分；日程按下一次分。不写 by 只写 unit = 第一个日期字段。
 * last：只给图表，最近几段（原 chart.periods）。showEmpty：单选、引用时没有记录的组也列出。
 * filter：引用分组时先筛被引用的表，决定要哪几组（原 groupFilter）。
 */
export const GroupingSchema = z.strictObject({
  by: FieldRefSchema.optional(),
  unit: z.enum(GROUP_UNITS).optional(),
  last: z.number().int().min(2).max(31).optional(),
  showEmpty: z.literal(true).optional(),
  filter: filterSchema().optional(),
});
export type Grouping = z.infer<typeof GroupingSchema>;
