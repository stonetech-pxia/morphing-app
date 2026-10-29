import { dateOfDayNumber, todayNumber, weekStartOf, type Calendar } from './calendar';
import { fieldOf, readValue, recordDay, type DataRecord } from './data';
import { dayNumber } from './formula';
import { localeTag } from './localization';
import type { Collection, Locale } from './schema';

// 记录列表的月历外观（D-305）：一个月的格子，每天有几条记录、按一个单选字段上什么颜色。
// 纯逻辑：哪几周、每天的记录、深浅几档、月份和星期的名字；App 只负责画格子。
// 日子用天数（dayNumber）比较，记录落在哪天用 recordDay（一天从几点开始，D-286）。

const pad = (n: number) => String(n).padStart(2, '0');

/** 今天所在的月份（YYYY-MM），按一天从几点开始。 */
export const currentMonth = (now: Date, cal: Calendar): string =>
  dateOfDayNumber(todayNumber(now, cal)).slice(0, 7);

/** 往前或往后几个月。 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** 这个月第一天和最后一天（天数）。 */
function monthBounds(month: string): [number, number] {
  const first = dayNumber(`${month}-01`)!;
  const last = dayNumber(`${shiftMonth(month, 1)}-01`)! - 1;
  return [first, last];
}

/** 画出来的几周（每周 7 个天数），从这个月第一天所在那周到最后一天所在那周；一周的开始按 cal。 */
export function monthWeeks(month: string, cal: Calendar): number[][] {
  const [first, last] = monthBounds(month);
  const weeks: number[][] = [];
  for (let start = weekStartOf(first, cal); start <= last; start += 7)
    weeks.push(Array.from({ length: 7 }, (_, i) => start + i));
  return weeks;
}

/**
 * 读这个月的记录时要读哪一段（只读需要的记录）：日期从 1 号到下个月 2 号之前；日期时间和创建时间也一样，
 * 多读一天是因为一天从凌晨几点开始时，下个月 1 号凌晨的记录还算这个月最后一天（D-286）。
 * from / until 比的是存着的日期或日期时间文字，fromMs / untilMs 比的是创建时间（本机时区的 0 点）。
 */
export function monthQueryRange(month: string): {
  from: string;
  until: string;
  fromMs: number;
  untilMs: number;
} {
  const [, last] = monthBounds(month);
  const from = `${month}-01`;
  const until = dateOfDayNumber(last + 2);
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).getTime();
  };
  return { from, until, fromMs: ms(from), untilMs: ms(until) };
}

export interface MonthDay {
  count: number;
  /** 上色的单选字段在这一天最后一条记录上的选项；null 是没选（或选项已删掉）。没有上色字段时也是 null。 */
  optionId: string | null;
  /** 这一天的记录，最晚的在前（按日期时间，再按创建时间）。 */
  records: DataRecord[];
}

/** 这个月每天的记录（只有有记录的日子），和记录最多的那天有几条。 */
export function monthDays(
  records: readonly DataRecord[],
  collection: Collection,
  spec: { dateField: string; colorField?: string | undefined },
  month: string,
  now: Date,
  cal: Calendar,
): { days: Map<number, MonthDay>; max: number } {
  const [first, last] = monthBounds(month);
  const color = spec.colorField ? fieldOf(collection, spec.colorField) : undefined;
  const byDay = new Map<number, { record: DataRecord; key: string }[]>();
  for (const record of records) {
    const date = recordDay(record, collection, spec.dateField, now, cal);
    const n = date === undefined ? undefined : dayNumber(date);
    if (n === undefined || n < first || n > last) continue;
    // 同一天的先后：日期时间字段按它的值，其余按创建时间。
    const raw = record.values[spec.dateField];
    const key = `${typeof raw === 'string' ? raw : ''}|${String(record.createdAt).padStart(15, '0')}`;
    const list = byDay.get(n);
    if (list) list.push({ record, key });
    else byDay.set(n, [{ record, key }]);
  }
  const days = new Map<number, MonthDay>();
  let max = 0;
  for (const [n, list] of byDay) {
    list.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    const latest = list[0]!.record;
    const option = color?.type === 'choice' ? readValue(color, latest.values[color.id]) : undefined;
    days.set(n, {
      count: list.length,
      optionId: typeof option === 'string' ? option : null,
      records: list.map((x) => x.record),
    });
    max = Math.max(max, list.length);
  }
  return { days, max };
}

/** 没有上色字段时格子的深浅：0 是没有记录，1–4 按这个月记录最多的那天分档。 */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

/** 月份的标题：2026年10月、October 2026、octobre 2026。 */
export function monthTitle(month: string, locale: Locale): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** 表头的星期（最短的写法：一、M、L），从一周的第一天开始。 */
export function weekdayLabels(cal: Calendar, locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(localeTag(locale), { weekday: 'narrow', timeZone: 'UTC' });
  // 天数 4 是 1970-01-05，周一。
  const start = cal.weekStart === 'monday' ? 4 : 3;
  return Array.from({ length: 7 }, (_, i) => format.format(new Date((start + i) * 86_400_000)));
}

/** 某一天的完整日期（列出当天记录时的标题）：10月29日星期四、Thursday, October 29、jeudi 29 octobre。 */
export function dayTitle(day: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day * 86_400_000));
}
