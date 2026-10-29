import { dateOfDayNumber, todayNumber, type Calendar } from './calendar';
import { periodRange } from './data';
import { dayNumber } from './formula';
import { t } from './messages';
import type { Condition, Locale, Period } from './schema';

// 统计的「和上一段时间比」（D-308）：统计的筛选里有一个 inPeriod 条件时，把它换成上一段，再算一次。
// 按日历的时间段（本周、本月、今年……）比上一段的同期：本月到 29 号就比上个月 1–29 号，
// 不然月中总是「比上月少一半」；今天比昨天一整天；最近 N 天比再往前的 N 天。一天和一周的开始按 D-286。

/** 上一段同期的日期范围（含两端）。 */
export function previousPeriodRange(period: Period, now: Date, cal: Calendar): [string, string] {
  const today = todayNumber(now, cal);
  const [startText, endText] = periodRange(period, now, cal);
  const start = dayNumber(startText)!;
  const days = dayNumber(endText)! - start + 1;
  const toDate = today - start + 1;
  const shift = (by: number, length: number): [string, string] => [
    dateOfDayNumber(start - by),
    dateOfDayNumber(start - by + length - 1),
  ];
  const [y, m, d] = dateOfDayNumber(today).split('-').map(Number) as [number, number, number];
  const ymd = (yy: number, mm: number, dd: number) => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return dateOfDayNumber(Math.round(Date.UTC(yy, mm - 1, Math.min(dd, last)) / 86_400_000));
  };
  switch (period) {
    case 'today':
      return shift(1, 1);
    case 'thisWeek':
      return shift(7, toDate);
    case 'thisTwoWeeks':
      return shift(14, toDate);
    case 'thisHalfMonth':
      // 上半月比上个月的下半月（16 号起），下半月比这个月的上半月；都到同样的第几天为止，不超出那半个月。
      return d <= 15
        ? [ymd(y, m - 1, 16), ymd(y, m - 1, 15 + d)]
        : [`${dateOfDayNumber(today).slice(0, 7)}-01`, ymd(y, m, Math.min(15, d - 15))];
    case 'thisMonth':
      return [ymd(y, m - 1, 1), ymd(y, m - 1, d)];
    case 'thisYear':
      return [`${y - 1}-01-01`, ymd(y - 1, m, d)];
    default:
      // 最近 N 天：再往前的 N 天。
      return shift(days, days);
  }
}

/**
 * 上一段的筛选：唯一一个 inPeriod 条件换成上一段同期（大于前一天、小于后一天），别的条件不动。
 * 没有或有不止一个 inPeriod 条件时没有可比的（check 会拦住这种配置）。
 */
export function previousFilter(
  filter: readonly Condition[] | undefined,
  now: Date,
  cal: Calendar,
): { filter: Condition[]; period: Period } | null {
  const periods = (filter ?? []).filter((c) => c.op === 'inPeriod');
  if (periods.length !== 1) return null;
  const cond = periods[0]!;
  const period = cond.value as Period;
  const [from, to] = previousPeriodRange(period, now, cal);
  const before = dateOfDayNumber(dayNumber(from)! - 1);
  const after = dateOfDayNumber(dayNumber(to)! + 1);
  return {
    period,
    filter: (filter ?? []).flatMap((c) =>
      c === cond
        ? [
            { field: c.field, op: 'gt' as const, value: before },
            { field: c.field, op: 'lt' as const, value: after },
          ]
        : [c],
    ),
  };
}

/** 变化：多了、少了还是一样，百分比取整；上一段是 0 时没有百分比。任何一边没有值时没有。 */
export function compareChange(
  current: number | null,
  previous: number | null,
): { direction: 'up' | 'down' | 'same'; percent: number | null } | null {
  if (current === null || previous === null) return null;
  const direction = current > previous ? 'up' : current < previous ? 'down' : 'same';
  if (previous === 0) return { direction, percent: direction === 'same' ? 0 : null };
  return {
    direction,
    percent: Math.round((Math.abs(current - previous) / Math.abs(previous)) * 100),
  };
}

/** 上一段的说明和它的值：「上月同期：¥100.00」「再往前 30 天：12」。 */
export function previousLabel(period: Period, value: string, locale: Locale): string {
  const days = /^last(\d+)days$/.exec(period);
  if (days) return t(locale, 'compare_lastDays', { n: Number(days[1]), value });
  return t(locale, `compare_${period as Exclude<Period, `last${string}`>}`, { value });
}

/** 变化的文字：↑ 12%、↓ 5%、持平；上一段是 0 时只写「↑ 增加」。 */
export function changeLabel(
  change: ReturnType<typeof compareChange>,
  locale: Locale,
): string | null {
  if (!change) return null;
  if (change.direction === 'same') return t(locale, 'compareSame');
  if (change.percent === null)
    return change.direction === 'up' ? t(locale, 'compareUpNoPercent') : null;
  return t(locale, change.direction === 'up' ? 'compareUp' : 'compareDown', { n: change.percent });
}
