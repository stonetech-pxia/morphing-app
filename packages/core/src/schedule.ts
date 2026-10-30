import { z } from 'zod';

import {
  DEFAULT_CALENDAR,
  dateOfDayNumber,
  twoWeekStartOf,
  weekStartOf,
  type Calendar,
} from './calendar';
import { dayNumber } from './formula';
import { localeTag } from './localization';
import { t } from './messages';
import type { Locale } from './schema-primitives';

// 日程（D-292–D-296）：每条记录存一份重复规则（每天、每周几天、每周 N 次、每月几号、每 N 天、每年某天），
// 由规则和「做过的日子」算出下一次、今天该不该做、过期几天。纯逻辑：日子用天数（dayNumber）来加减，
// 「今天」和「这周」按 calendar（D-286）。规则是小的白名单 JSON，不是 rrule 字符串。
// D-340 加「一次」（once）：只做一次，可以定在某天、也可以不定日期；做过一次就结束（finished）。

const perDay = z.number().int().min(1).max(20).optional();
/** 几点（D-346）：每种规则都可以带，「明天 03:00」「每周一 09:00」；按记录排的提醒用它。 */
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional();

/** 一周里的几天：1 = 周一 … 7 = 周日（ISO）。 */
const Weekday = z.number().int().min(1).max(7);
/** 一个月里的几号：1–31，-1 = 最后一天。比这个月天数大的号落在月底。 */
const MonthDay = z.union([z.number().int().min(1).max(31), z.literal(-1)]);

/** 每种时间段里最多几次（每天最多一次，例如每周最多 7 次）。 */
const TIMES_LIMIT = { week: 7, twoWeeks: 14, month: 31, year: 366 } as const;
export type SchedulePer = keyof typeof TIMES_LIMIT;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 「一次」的日子（YYYY-MM-DD），要是真的日期。 */
const OnceDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (d) => {
      const n = dayNumber(d);
      return n !== undefined && dateOfDayNumber(n) === d;
    },
    { message: 'not a real date' },
  );

export const ScheduleRuleSchema = z.discriminatedUnion('repeat', [
  // D-340：只做一次，date 不写 = 不定日期（有空再做）。没有 perDay。
  z.strictObject({ repeat: z.literal('once'), date: OnceDate.optional(), time }),
  z.strictObject({ repeat: z.literal('daily'), perDay, time }),
  z.strictObject({
    repeat: z.literal('weekdays'),
    days: z.array(Weekday).min(1).max(7),
    perDay,
    time,
  }),
  z
    .strictObject({
      repeat: z.literal('times'),
      per: z.enum(['week', 'twoWeeks', 'month', 'year']),
      count: z.number().int().min(1).max(366),
      perDay,
      time,
    })
    .refine((r) => r.count <= TIMES_LIMIT[r.per], {
      message: 'count can be at most 7 a week, 14 every two weeks, 31 a month, 366 a year',
    }),
  z.strictObject({
    repeat: z.literal('monthDays'),
    days: z.array(MonthDay).min(1).max(32),
    perDay,
    time,
  }),
  z.strictObject({
    repeat: z.literal('interval'),
    every: z.number().int().min(1).max(60),
    perDay,
    time,
  }),
  z
    .strictObject({
      repeat: z.literal('yearly'),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      perDay,
      time,
    })
    .refine((r) => r.day <= DAYS_IN_MONTH[r.month - 1]!, { message: 'no such day in that month' }),
]);
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

const KEYS: Record<ScheduleRule['repeat'], readonly string[]> = {
  once: ['date'],
  daily: [],
  weekdays: ['days'],
  times: ['per', 'count'],
  monthDays: ['days'],
  interval: ['every'],
  yearly: ['month', 'day'],
};

/**
 * 宽容读取（记录里存的值、表单输入）：只留这种规则认识的属性，几天排好序、去掉重复，perDay 1 不存；
 * 对不上的返回 undefined（只是不显示）。
 */
export function readSchedule(raw: unknown): ScheduleRule | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const keys = KEYS[r.repeat as ScheduleRule['repeat']];
  if (!keys) return undefined;
  const picked: Record<string, unknown> = { repeat: r.repeat };
  for (const k of keys) {
    const v = r[k];
    if (v === undefined) continue;
    picked[k] = Array.isArray(v)
      ? [...new Set(v)].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b))
      : v;
  }
  if (r.perDay !== undefined && r.perDay !== 1 && r.repeat !== 'once') picked.perDay = r.perDay;
  if (typeof r.time === 'string' && r.time !== '') picked.time = r.time;
  const parsed = ScheduleRuleSchema.safeParse(picked);
  return parsed.success ? parsed.data : undefined;
}

// ---- 计算 ----

const utc = (day: number) => new Date(day * 86_400_000);
/** 一周里的第几天：1 = 周一 … 7 = 周日。天数 0（1970-01-01）是周四。 */
const isoWeekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1;
const monthLength = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const dayOfUtc = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 86_400_000;

/** 号数落在这个月的哪一天（-1 和超出这个月的号数都是月底）。 */
const clampDay = (x: number, length: number) => (x === -1 ? length : Math.min(x, length));

/** 这一天是不是规则里的一天（只用于固定的日子：每天、每周几天、每月几号、每年某天）。 */
function matches(rule: ScheduleRule, day: number): boolean {
  const d = utc(day);
  const dom = d.getUTCDate();
  const length = monthLength(d.getUTCFullYear(), d.getUTCMonth());
  switch (rule.repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return rule.days.includes(isoWeekday(day));
    case 'monthDays':
      return rule.days.some((x) => clampDay(x, length) === dom);
    case 'yearly':
      return d.getUTCMonth() === rule.month - 1 && clampDay(rule.day, length) === dom;
    default:
      return false;
  }
}

/** 从 from 起（含）第一个规则里的日子。每年 2 月 29 日最多要往后找 4 年。 */
function firstMatch(rule: ScheduleRule, from: number): number {
  for (let day = from; day < from + 1500; day++) if (matches(rule, day)) return day;
  return from;
}

/** 「N 次」的时间段：今天所在那一段的第一天和最后一天（天数）。 */
function periodOf(per: SchedulePer, today: number, cal: Calendar): [number, number] {
  if (per === 'week') return [weekStartOf(today, cal), weekStartOf(today, cal) + 6];
  if (per === 'twoWeeks') return [twoWeekStartOf(today, cal), twoWeekStartOf(today, cal) + 13];
  const d = utc(today);
  const y = d.getUTCFullYear();
  if (per === 'year') return [dayOfUtc(y, 0, 1), dayOfUtc(y, 11, 31)];
  const m = d.getUTCMonth();
  return [dayOfUtc(y, m, 1), dayOfUtc(y, m + 1, 0)];
}

export interface ScheduleStatus {
  /**
   * 下一次（天数）：还没做的那一次，过期了就是过期的那天。「一次」不定日期、或者已经做完时没有（D-340）。
   */
  next: number | undefined;
  /** 今天该做（包括已经过期的）。 */
  dueToday: boolean;
  /** 过期几天（0 = 没过期）。「N 次」的规则不算过期。 */
  overdueDays: number;
  /** 「一次」已经做过了（D-340）：不再有下一次，筛选 due pending 不算它。 */
  finished?: true;
}

export interface ScheduleOptions {
  /**
   * 提前做了算这一次（D-341，日程字段的 countEarly）：只影响固定的日子（每天、每周几天、每月几号、每年某天）。
   * 不开时照 D-293：下一次 = 上次做过之后第一个规则里的日子，提前做了不算（28 号付了 1 号的账，1 号仍要付）。
   */
  countEarly?: boolean;
  /** 从哪天起有这条规则（天数，记录的创建那天）：countEarly 从这天起第一个规则里的日子开始数。 */
  since?: number;
}

/**
 * 规则在今天的状态。done 是做过的日子（天数，做了几次就有几个；今天以后的不算）。
 * - 一次（D-340）：做过就结束；没做过时下一次是它的日子，不定日期就没有下一次。
 * - 每 N 天：上次做过之后 N 天；没做过就是今天。
 * - 固定的日子：上次做过之后第一个规则里的日子（可能已经过了 = 过期）；没做过就是今天起第一个。
 *   countEarly 时按 Todoist 的算法：从 since 起第一个规则里的日子是「该做的那一次」，每做一次（不管早晚）
 *   就排到「该做的那一次」和做的那天两者较晚的之后第一个规则里的日子，所以提前做了也算这一次。
 * - 每周 / 两周 / 月 / 年 N 次：这一段里做过的天数不够 N，今天还没做就是今天，做过了是明天（这一段的
 *   最后一天做过了就是下一段第一天）；够了就是下一段第一天。
 * - 一天 perDay 次：那一天做够 perDay 次才算做过。
 */
export function scheduleStatus(
  rule: ScheduleRule,
  done: readonly number[],
  today: number,
  cal: Calendar = DEFAULT_CALENDAR,
  options: ScheduleOptions = {},
): ScheduleStatus {
  const times = rule.repeat === 'once' ? 1 : (rule.perDay ?? 1);
  const counts = new Map<number, number>();
  for (const day of done) if (day <= today) counts.set(day, (counts.get(day) ?? 0) + 1);
  const full = (day: number) => (counts.get(day) ?? 0) >= times;
  const last = counts.size === 0 ? undefined : Math.max(...counts.keys());

  let next: number;
  if (rule.repeat === 'once') {
    if (last !== undefined)
      return { next: undefined, dueToday: false, overdueDays: 0, finished: true };
    const day = rule.date === undefined ? undefined : dayNumber(rule.date);
    if (day === undefined) return { next: undefined, dueToday: false, overdueDays: 0 };
    return { next: day, dueToday: day <= today, overdueDays: Math.max(0, today - day) };
  }
  if (rule.repeat === 'times') {
    const [start, end] = periodOf(rule.per, today, cal);
    let daysDone = 0;
    for (let day = start; day <= today; day++) if (full(day)) daysDone++;
    if (daysDone >= rule.count) next = end + 1;
    else if (!full(today)) next = today;
    else next = today + 1;
    return { next, dueToday: next <= today, overdueDays: 0 };
  }
  if (rule.repeat === 'interval') {
    next = last === undefined ? today : full(last) ? last + rule.every : last;
  } else if (options.countEarly && last !== undefined && full(last)) {
    const doneDays = [...counts.keys()].filter(full).sort((a, b) => a - b);
    const first = doneDays[0]!;
    let due = firstMatch(rule, Math.min(options.since ?? first, first));
    for (const day of doneDays) due = firstMatch(rule, Math.max(due, day) + 1);
    next = due;
  } else {
    next = firstMatch(rule, last === undefined ? today : full(last) ? last + 1 : last);
  }
  return { next, dueToday: next <= today, overdueDays: Math.max(0, today - next) };
}

/**
 * 接下来 count 次（天数，从今天起，D-316）：第一次是 scheduleStatus 的下一次（过期了就是今天），之后假设每次
 * 都按时做了（那天做够 perDay 次）再往后算。按记录排提醒用：用户真的做了、记录变了会重新算。
 * 「一次」最多一次（D-340）：定了日子、还没做时就是那天（过期了是今天）。
 */
export function scheduleOccurrences(
  rule: ScheduleRule,
  done: readonly number[],
  today: number,
  count: number,
  cal: Calendar = DEFAULT_CALENDAR,
  options: ScheduleOptions = {},
): number[] {
  const assumed = [...done];
  const days: number[] = [];
  let from = today;
  for (let i = 0; i < count; i++) {
    const next = scheduleStatus(rule, assumed, from, cal, options).next;
    if (next === undefined) break;
    const day = Math.max(next, from);
    days.push(day);
    for (let k = 0; k < (rule.repeat === 'once' ? 1 : (rule.perDay ?? 1)); k++) assumed.push(day);
    from = day;
  }
  return days;
}

// ---- 显示 ----

/** 规则的一句话（三种语言各写完整的句子，单复数按 isSingular）。 */
export function scheduleText(rule: ScheduleRule, locale: Locale): string {
  const base = ruleText(rule, locale);
  const text = rule.time ? t(locale, 'scheduleAtTime', { rule: base, time: rule.time }) : base;
  return rule.repeat !== 'once' && rule.perDay
    ? t(locale, 'schedulePerDay', { rule: text, n: rule.perDay })
    : text;
}

const TIMES_KEY = {
  week: 'scheduleTimesWeek',
  twoWeeks: 'scheduleTimesTwoWeeks',
  month: 'scheduleTimesMonth',
  year: 'scheduleTimesYear',
} as const;

function ruleText(rule: ScheduleRule, locale: Locale): string {
  const list = (items: string[]) => items.join(t(locale, 'separatorList'));
  switch (rule.repeat) {
    case 'once': {
      const day = rule.date === undefined ? undefined : dayNumber(rule.date);
      return day === undefined
        ? t(locale, 'scheduleOnceAnytime')
        : t(locale, 'scheduleOnceOn', { date: shortDate(day, day, locale) });
    }
    case 'daily':
      return t(locale, 'scheduleDaily');
    case 'weekdays':
      return t(locale, 'scheduleWeekdays', {
        days: list(rule.days.map((day) => weekdayName(day, locale))),
      });
    case 'times':
      return t(locale, TIMES_KEY[rule.per], { n: rule.count });
    case 'monthDays':
      return t(locale, 'scheduleMonthDays', {
        days: list(
          rule.days.map((x) =>
            x === -1 ? t(locale, 'scheduleLastDay') : t(locale, 'scheduleMonthDay', { day: x }),
          ),
        ),
      });
    case 'interval':
      return t(locale, 'scheduleInterval', { n: rule.every });
    case 'yearly':
      return t(locale, 'scheduleYearly', { date: monthDayName(rule.month, rule.day, locale) });
  }
}

/** 周几的短名字（周一、Mon、lun.）。2024-01-01 是周一。 */
export function weekdayName(day: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: 'short', timeZone: 'UTC' }).format(
    utc(dayOfUtc(2024, 0, day)),
  );
}

/** 某月某日（3月5日、March 5、5 mars），用闰年 2024，2 月 29 日也能写。 */
export function monthDayName(month: number, day: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utc(dayOfUtc(2024, month - 1, day)));
}

/** 月份的名字（选每年哪一天时用）。 */
export function monthName(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { month: 'short', timeZone: 'UTC' }).format(
    utc(dayOfUtc(2024, month - 1, 1)),
  );
}

/** 一个日子写成短日期（11月5日、Nov 5、5 nov.），不是今年的带年份。 */
export function shortDate(day: number, today: number, locale: Locale): string {
  const sameYear = dateOfDayNumber(day).slice(0, 4) === dateOfDayNumber(today).slice(0, 4);
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(utc(day));
}

/**
 * 下一次的说明：今天、明天、过期几天，或者下次的日期（不是今年的带年份）。「一次」（D-340）写日期本身
 * （不写「下次」），做完了写「已完成」，不定日期写「不定日期」。
 */
export function scheduleStatusText(
  status: ScheduleStatus,
  today: number,
  locale: Locale,
  once = false,
): string {
  if (status.finished) return t(locale, 'scheduleFinished');
  if (status.next === undefined) return t(locale, 'scheduleNoDate');
  if (status.overdueDays > 0) return t(locale, 'scheduleOverdue', { n: status.overdueDays });
  if (status.dueToday) return t(locale, 'scheduleToday');
  if (status.next === today + 1) return t(locale, 'scheduleTomorrow');
  const date = shortDate(status.next, today, locale);
  return once ? date : t(locale, 'scheduleNext', { date });
}

/**
 * 筛选 due 的值（D-294）：今天该做（包括已过期的）、已过期、这周要做（到这周最后一天为止，包括已过期的）；
 * pending（D-340）= 还没做完：有规则、不是做完了的「一次」（不定日期的也算）。
 */
export const SCHEDULE_DUE = ['today', 'overdue', 'thisWeek', 'pending'] as const;
export type ScheduleDue = (typeof SCHEDULE_DUE)[number];

/** 状态合不合筛选 due 的值。 */
export function scheduleDue(
  status: ScheduleStatus,
  due: ScheduleDue,
  today: number,
  cal: Calendar = DEFAULT_CALENDAR,
): boolean {
  if (due === 'pending') return !status.finished;
  if (due === 'overdue') return status.overdueDays > 0;
  if (due === 'today') return status.dueToday;
  return status.next !== undefined && status.next <= weekStartOf(today, cal) + 6;
}
