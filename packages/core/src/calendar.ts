import { localDate } from './field-values';
import { dayNumber } from './formula';
import type { CalendarSettings, WorkspaceConfig } from './schema';

// 一天、一周从什么时候开始（D-286）。所有按天、按周归类的计算（时间段、图表分组、连续天数、
// 日期字段的默认值 today、创建时间算哪一天）都从这里取「今天」和「这周」。
// 日子用天数（dayNumber，UTC 的整数）来加减，不用毫秒：夏令时那天也不会多一天或少一天。

export interface Calendar {
  /** 一天从几点开始（0–6）：2 表示凌晨 1:30 还算前一天。 */
  dayStartHour: number;
  weekStart: 'monday' | 'sunday';
  /** 两周一段（thisTwoWeeks）从哪一天算起；不写时从一个固定的、落在一周第一天的日子算起。 */
  twoWeekStart?: string;
}

export const DEFAULT_CALENDAR: Calendar = { dayStartHour: 0, weekStart: 'monday' };

/** 配置里的设置，没写的用默认值。 */
export function calendarOf(config: Pick<WorkspaceConfig, 'calendar'>): Calendar {
  const c: CalendarSettings = config.calendar ?? {};
  return {
    dayStartHour: c.dayStartHour ?? DEFAULT_CALENDAR.dayStartHour,
    weekStart: c.weekStart ?? DEFAULT_CALENDAR.weekStart,
    ...(c.twoWeekStart ? { twoWeekStart: c.twoWeekStart } : {}),
  };
}

/** 天数 → YYYY-MM-DD。 */
export const dateOfDayNumber = (n: number): string =>
  new Date(n * 86_400_000).toISOString().slice(0, 10);

/** 某个时刻算哪一天（YYYY-MM-DD）：一天开始的钟点之前算前一天。 */
export function dayOf(d: Date, cal: Calendar = DEFAULT_CALENDAR): string {
  const day = localDate(d);
  return d.getHours() < cal.dayStartHour ? dateOfDayNumber(dayNumber(day)! - 1) : day;
}

/** 今天的天数。 */
export const todayNumber = (now: Date, cal: Calendar = DEFAULT_CALENDAR): number =>
  dayNumber(dayOf(now, cal))!;

/** 这一天所在那周的第一天（天数）。天数 0 是 1970-01-01，星期四。 */
export function weekStartOf(day: number, cal: Calendar = DEFAULT_CALENDAR): number {
  const sinceStart = (((day + (cal.weekStart === 'monday' ? 3 : 4)) % 7) + 7) % 7;
  return day - sinceStart;
}

/** 没写 twoWeekStart 时两周从 2024-01-01（周一）所在那周的第一天算起。 */
const DEFAULT_TWO_WEEK_ANCHOR = dayNumber('2024-01-01')!;

/** 这一天所在的两周一段的第一天（天数）。锚定日之前的日子往前按 14 天一段推。 */
export function twoWeekStartOf(day: number, cal: Calendar = DEFAULT_CALENDAR): number {
  const anchored = cal.twoWeekStart === undefined ? undefined : dayNumber(cal.twoWeekStart);
  const anchor = anchored ?? weekStartOf(DEFAULT_TWO_WEEK_ANCHOR, cal);
  return anchor + 14 * Math.floor((day - anchor) / 14);
}
