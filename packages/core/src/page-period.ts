import {
  dateOfDayNumber,
  todayNumber,
  weekStartOf,
  type Calendar,
  DEFAULT_CALENDAR,
} from './calendar';
import { periodRange, recordDay, type DataRecord } from './data';
import { dayNumber } from './formula';
import { previousPeriodRange } from './compare';
import { PAGE_PERIODS, type PagePeriod } from './schema-primitives';
import type { Collection, GroupUnit } from './schema';

// 页面上的时间范围（D-440，创始人 2026-11-05 定）：页面上放一个 period 块，用户在几个选项里选一个（或自定义起止日期），
// 同一页里 source.period 是 "page" 的图表和数字卡都按它画。选了什么只在页面画着的时候有，什么都不写（底线 15）。
// 选项由配置决定（Tink 能改）：只有常用的几种，不是 Expensify 那十几种。这里是纯逻辑：范围怎么算、上一期是哪一段。

/** 用户选的：一个固定的时间段，或者自己选的起止日期（含两端，YYYY-MM-DD）。 */
export type PageChoice = { period: PagePeriod } | { start: string; end: string };

/** 一段日期（含两端）。 */
export interface DayRange {
  start: string;
  end: string;
}

const isPeriod = (c: PageChoice): c is { period: PagePeriod } => 'period' in c;

/** 现在选的范围：本周是周一到周日（还没到的日子也在里面，图上是 0），最近 N 天到今天为止。 */
export function choiceRange(
  choice: PageChoice,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): DayRange {
  if (!isPeriod(choice)) return { start: choice.start, end: choice.end };
  const [start, end] = periodRange(choice.period, now, cal);
  return { start, end };
}

/**
 * 图表用的上一期：紧挨在前面的一整段，一一对应着比（本周比上周、本月比上个月、今年比去年、最近 N 天比再往前的 N 天、
 * 自定义的比前面同样长的一段）。
 */
export function previousFullRange(
  choice: PageChoice,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): DayRange {
  const { start, end } = choiceRange(choice, now, cal);
  const startDay = dayNumber(start)!;
  const days = dayNumber(end)! - startDay + 1;
  const shift = (by: number, length: number): DayRange => ({
    start: dateOfDayNumber(startDay - by),
    end: dateOfDayNumber(startDay - by + length - 1),
  });
  if (!isPeriod(choice)) return shift(days, days);
  const [y, m] = start.split('-').map(Number) as [number, number];
  switch (choice.period) {
    case 'today':
      return shift(1, 1);
    case 'thisWeek':
      return shift(7, 7);
    case 'thisMonth': {
      const last = new Date(Date.UTC(y, m - 1, 0));
      const prev = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
      return { start: `${prev}-01`, end: `${prev}-${String(last.getUTCDate()).padStart(2, '0')}` };
    }
    case 'thisYear':
      return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    default:
      return shift(days, days);
  }
}

/** 数字卡用的上一期：和现有的「和上一段同期比」（D-308）一样，本月到 29 号就比上个月 1–29 号。自定义的比前面同样长的一段。 */
export function previousToDateRange(
  choice: PageChoice,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): DayRange {
  if (!isPeriod(choice)) return previousFullRange(choice, now, cal);
  const [start, end] = previousPeriodRange(choice.period, now, cal);
  return { start, end };
}

/** 图表按什么时间段分：范围不超过 31 天按天，不超过半年按周，再长按月。 */
export function rangeUnit(range: DayRange): GroupUnit {
  const days = dayNumber(range.end)! - dayNumber(range.start)! + 1;
  return days <= 31 ? 'day' : days <= 184 ? 'week' : 'month';
}

/** 范围里每一段的开始日期（从早到晚）：按周的第一段从范围开始那天所在的周一（或周日）起，按月的从那个月 1 号起。 */
export function rangeStarts(
  range: DayRange,
  unit: GroupUnit,
  cal: Calendar = DEFAULT_CALENDAR,
): string[] {
  const first = dayNumber(range.start)!;
  const last = dayNumber(range.end)!;
  const out: string[] = [];
  if (unit === 'day') {
    for (let d = first; d <= last; d++) out.push(dateOfDayNumber(d));
  } else if (unit === 'week') {
    for (let d = weekStartOf(first, cal); d <= last; d += 7) out.push(dateOfDayNumber(d));
  } else {
    const [sy, sm] = range.start.split('-').map(Number) as [number, number];
    const [ey, em] = range.end.split('-').map(Number) as [number, number];
    for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? (y++, (m = 1)) : m++)
      out.push(`${y}-${String(m).padStart(2, '0')}-01`);
  }
  return out;
}

/** 日期落在这段里的记录（用哪个日期字段看 ref；创建时间、日期时间也行）。没有日期的不在任何范围里。 */
export function recordsInRange(
  records: readonly DataRecord[],
  collection: Collection,
  ref: string,
  range: DayRange,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): DataRecord[] {
  return records.filter((r) => {
    const day = recordDay(r, collection, ref, now, cal);
    return day !== undefined && day >= range.start && day <= range.end;
  });
}

/** 选的是不是一个合法的范围：自定义的两端是日期、开始不晚于结束，最长五年。 */
export function validChoice(choice: PageChoice): boolean {
  if (isPeriod(choice)) return (PAGE_PERIODS as readonly string[]).includes(choice.period);
  const a = dayNumber(choice.start);
  const b = dayNumber(choice.end);
  return a !== undefined && b !== undefined && a <= b && b - a < 366 * 5;
}

/** 今天是哪一天（页面上显示「今天」「本周」用）。 */
export const todayText = (now: Date, cal: Calendar = DEFAULT_CALENDAR): string =>
  dateOfDayNumber(todayNumber(now, cal));
