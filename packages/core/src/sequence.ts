import { DEFAULT_CALENDAR, todayNumber, weekStartOf, type Calendar } from './calendar';
import { readValue, recordDay, fieldOf, type DataRecord } from './data';
import { round } from './field-values';
import { dayNumber } from './formula';
import { type Collection, type Days, type SequenceAggregate, type StreakUnit } from './schema';

// 按顺序的聚合（D-284）：看记录落在哪些日子上，而不是把数值加起来。纯逻辑，接口是
// 「一组记录 + 日期字段 + 参数 → 值」：统计、图表现在用，以后汇总字段（P3）也照样用。
// 日子都换成天数（dayNumber）来比较，按「一天从几点开始、一周从周几开始」（D-286）归类。

export { isSequenceAggregate, sequenceText } from './sequence-text';

/** 连续的规则：每个单位（天 / 周 / 月）至少 perUnit 条才算做到；skip 那个选项的记录算「跳过」。 */
export interface StreakRule {
  unit: StreakUnit;
  perUnit: number;
  skip?: Days['skip'];
}

/**
 * 按日子算用哪个日期（Days.date，图表按时间分组时是 group.by，月历是 group.by）：写了就用它；不写是表里第一个
 * 日期字段，没有就第一个日期时间字段（D-279），再没有就创建时间。
 */
export function dateFieldOf(collection: Collection, date: string | undefined): string {
  return (
    date ??
    collection.fields.find((f) => f.type === 'date')?.id ??
    collection.fields.find((f) => f.type === 'datetime')?.id ??
    'createdAt'
  );
}

export interface SequenceContext {
  /** 按哪个日期：日期字段、日期时间字段（D-279），或 createdAt / updatedAt（按一天开始的钟点归到哪一天）。 */
  dateField: string;
  now: Date;
  cal?: Calendar;
}

/** 每条记录的日子（天数）；没有日期的不算。 */
function recordDays(records: readonly DataRecord[], collection: Collection, ctx: SequenceContext) {
  const cal = ctx.cal ?? DEFAULT_CALENDAR;
  return records.flatMap((r) => {
    const v = recordDay(r, collection, ctx.dateField, ctx.now, cal);
    const day = typeof v === 'string' ? dayNumber(v) : undefined;
    return day === undefined ? [] : [{ record: r, day }];
  });
}

/** 一天落在哪个单位里（单位的编号，相邻单位差 1）。 */
function unitOf(day: number, unit: StreakUnit, cal: Calendar): number {
  if (unit === 'day') return day;
  if (unit === 'week') return Math.floor(weekStartOf(day, cal) / 7);
  const d = new Date(day * 86_400_000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * 当前连续和最佳连续（照 Streaks 的规则）：一个单位里做到的条数够了 +1；只有「跳过」的单位
 * 不断也不加；当前这个单位（今天 / 本周 / 本月）还没做到不算断，过了才断。今天以后的记录不算。
 */
export function streakOf(
  records: readonly DataRecord[],
  collection: Collection,
  rule: StreakRule,
  ctx: SequenceContext,
): { current: number; best: number } {
  const cal = ctx.cal ?? DEFAULT_CALENDAR;
  const today = todayNumber(ctx.now, cal);
  const skipField = rule.skip ? fieldOf(collection, rule.skip.field) : undefined;
  const done = new Map<number, number>();
  const skipped = new Set<number>();
  for (const { record, day } of recordDays(records, collection, ctx)) {
    if (day > today) continue;
    const unit = unitOf(day, rule.unit, cal);
    const isSkip =
      skipField !== undefined &&
      readValue(skipField, record.values[skipField.id]) === rule.skip!.option;
    if (isSkip) skipped.add(unit);
    else done.set(unit, (done.get(unit) ?? 0) + 1);
  }
  const units = [...done.keys(), ...skipped];
  if (units.length === 0) return { current: 0, best: 0 };
  const last = unitOf(today, rule.unit, cal);
  const state = (u: number) =>
    (done.get(u) ?? 0) >= rule.perUnit ? 'done' : skipped.has(u) ? 'skip' : 'missed';
  let best = 0;
  let run = 0;
  for (let u = Math.min(...units); u <= last; u++) {
    const s = state(u);
    if (s === 'done') best = Math.max(best, ++run);
    else if (s === 'missed' && u !== last) run = 0;
  }
  return { current: run, best };
}

/** 距最近一条（今天以前，含今天）几天；没有记录时为 null。 */
export function daysSince(
  records: readonly DataRecord[],
  collection: Collection,
  ctx: SequenceContext,
): number | null {
  const today = todayNumber(ctx.now, ctx.cal ?? DEFAULT_CALENDAR);
  const past = recordDays(records, collection, ctx).filter((d) => d.day <= today);
  return past.length === 0 ? null : today - Math.max(...past.map((d) => d.day));
}

/** 有记录的不同日子，从早到晚。 */
const distinctDayList = (
  records: readonly DataRecord[],
  collection: Collection,
  ctx: SequenceContext,
) => [...new Set(recordDays(records, collection, ctx).map((d) => d.day))].sort((a, b) => a - b);

/** 相邻两个有记录的日子平均隔几天（一位小数）；不到两天有记录时为 null。 */
export function avgInterval(
  records: readonly DataRecord[],
  collection: Collection,
  ctx: SequenceContext,
): number | null {
  const days = distinctDayList(records, collection, ctx);
  return days.length < 2 ? null : round((days.at(-1)! - days[0]!) / (days.length - 1), 1);
}

/** 有记录的天数。 */
export const distinctDays = (
  records: readonly DataRecord[],
  collection: Collection,
  ctx: SequenceContext,
): number => distinctDayList(records, collection, ctx).length;

/**
 * 数字块、汇总字段显示的值：streak 是当前连续，另给 best；其余只有 value。日期按 days.date（dateFieldOf），
 * days.unit、perUnit、skip 只给 streak。
 */
export function sequenceValue(
  records: readonly DataRecord[],
  collection: Collection,
  aggregate: SequenceAggregate,
  days: Days | undefined,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): { value: number | null; best?: number } {
  const ctx: SequenceContext = { dateField: dateFieldOf(collection, days?.date), now, cal };
  switch (aggregate) {
    case 'streak': {
      // skip 要选项和字段都写了才算（同 v33）。
      const skip = days?.skip?.field && days.skip.option ? days.skip : undefined;
      const rule = { unit: days?.unit ?? 'day', perUnit: days?.perUnit ?? 1, skip };
      const { current, best } = streakOf(records, collection, rule, ctx);
      return { value: current, best };
    }
    case 'daysSince':
      return { value: daysSince(records, collection, ctx) };
    case 'avgInterval':
      return { value: avgInterval(records, collection, ctx) };
    case 'distinctDays':
      return { value: distinctDays(records, collection, ctx) };
  }
}
