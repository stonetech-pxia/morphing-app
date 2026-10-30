import { dateOfDayNumber, todayNumber, weekStartOf, type Calendar } from './calendar';
import {
  fieldOf,
  groupRecords,
  recordDay,
  scheduleStatusOf,
  type DataRecord,
  type LinkedGroups,
} from './data';
import { dayNumber } from './formula';
import { localeTag } from './localization';
import { t } from './messages';
import { shortDate, weekdayName } from './schedule';
import type { Collection, Grouping, Locale } from './schema';
import { dateFieldOf } from './sequence';

// 记录列表分段（D-347）：按单选、引用分（每个选项 / 被引用的每条一段，顺序同 D-336 的分组），或者按日子分
// （日期、日期时间、系统字段按天 / 周 / 月；日程按下一次，过期的合成一段放最前，没有下一次的放最后）。
// 纯逻辑：每段的标题、记录和「在这一段添加」时预设的值（A10，D-349）；App 只画标题、折叠和行。

export interface ListGroup {
  /** 稳定的键：折叠状态按它记。 */
  key: string;
  label: string;
  records: DataRecord[];
  /**
   * 在这一段新建时这个字段预设成什么（表单输入）：单选项 ID、引用的记录 ID、日期（按天分时）、日程的「一次」。
   * 「未选」「已过期」、按周按月分的段没有。
   */
  preset?: unknown;
}

function dayLabel(day: number, today: number, locale: Locale): string {
  const weekday = weekdayName(((((day + 3) % 7) + 7) % 7) + 1, locale);
  const date = t(locale, 'groupDay', { date: shortDate(day, today, locale), weekday });
  const relative =
    day === today
      ? t(locale, 'scheduleToday')
      : day === today + 1
        ? t(locale, 'scheduleTomorrow')
        : day === today - 1
          ? t(locale, 'yesterday')
          : undefined;
  return relative ? t(locale, 'groupDayRelative', { relative, day: date }) : date;
}

function monthLabel(day: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(day * 86_400_000));
}

/**
 * 已经筛选、排好序的记录按 group 分段（每段里保持原来的顺序）。group.by 不写时按第一个日期字段（dateFieldOf）。
 * 按日子分时段的先后跟着排序走：按日期从早到晚排就是今天、明天……；日程的「已过期」总在最前，「不定日期」总在最后。
 * group.showEmpty：单选、引用时没有记录的段也列出（版块）。
 */
export function listGroups(
  records: readonly DataRecord[],
  collection: Collection,
  group: Pick<Grouping, 'by' | 'unit' | 'showEmpty'>,
  options: {
    locale: Locale;
    now: Date;
    cal: Calendar;
    /** 引用字段：被引用的那张表和它的记录（D-336）。 */
    linked?: LinkedGroups | undefined;
  },
): ListGroup[] {
  const { locale, now, cal } = options;
  const groupBy = dateFieldOf(collection, group.by);
  const field = fieldOf(collection, groupBy);
  if (field?.type === 'choice' || field?.type === 'link') {
    return groupRecords(records, collection, groupBy, t(locale, 'statNoChoice'), options.linked)
      .filter((g) => group.showEmpty || g.records.length > 0)
      .map((g) => ({
        key: g.optionId ?? 'none',
        label: g.label,
        records: g.records,
        ...(g.optionId === null ? {} : { preset: g.optionId }),
      }));
  }
  const today = todayNumber(now, cal);
  const unit = group.unit ?? 'day';
  const schedule = field?.type === 'schedule';
  const groups = new Map<string, ListGroup>();
  let overdue: ListGroup | undefined;
  let noDate: ListGroup | undefined;
  for (const r of records) {
    let day: number | undefined;
    if (schedule) {
      day = scheduleStatusOf(r, collection, field, now, cal)?.next;
      if (day !== undefined && day < today) {
        overdue ??= { key: 'overdue', label: t(locale, 'groupOverdue'), records: [] };
        overdue.records.push(r);
        continue;
      }
    } else {
      const date = recordDay(r, collection, groupBy, now, cal);
      day = date === undefined ? undefined : dayNumber(date);
    }
    if (day === undefined) {
      noDate ??= {
        key: 'none',
        label: t(locale, schedule ? 'scheduleNoDate' : 'groupNoDate'),
        records: [],
      };
      noDate.records.push(r);
      continue;
    }
    const start =
      unit === 'week'
        ? weekStartOf(day, cal)
        : unit === 'month'
          ? dayNumber(`${dateOfDayNumber(day).slice(0, 7)}-01`)!
          : day;
    const key = `${unit}-${start}`;
    let section = groups.get(key);
    if (!section) {
      const label =
        unit === 'week'
          ? t(locale, 'groupWeek', { date: shortDate(start, today, locale) })
          : unit === 'month'
            ? monthLabel(start, locale)
            : dayLabel(start, today, locale);
      const date = dateOfDayNumber(start);
      // 按天分时可以在这一天添加：日期字段填这一天，日程是「一次，这一天」。
      const preset =
        unit !== 'day'
          ? undefined
          : schedule
            ? { repeat: 'once', date }
            : field?.type === 'date'
              ? date
              : undefined;
      section = { key, label, records: [], ...(preset === undefined ? {} : { preset }) };
      groups.set(key, section);
    }
    section.records.push(r);
  }
  return [...(overdue ? [overdue] : []), ...groups.values(), ...(noDate ? [noDate] : [])];
}

/**
 * 在一个列表里新建时从它的筛选能带上的值（A10，D-349）：单选 is 某个选项、引用 is 某条（给一条记录用的页面上
 * 已经换成这条，D-342）、勾选框 is true / false。只认「等于」，别的条件（时间段、包含……）带不上。
 */
export function filterPresets(
  collection: Collection,
  filter: readonly { field: string; op: string; value?: unknown }[] | undefined,
): Record<string, unknown> {
  const presets: Record<string, unknown> = {};
  for (const c of filter ?? []) {
    if (c.op !== 'is') continue;
    const f = fieldOf(collection, c.field);
    if (!f) continue;
    if (f.type === 'choice' && f.options.some((o) => o.id === c.value)) presets[f.id] = c.value;
    else if (f.type === 'link' && typeof c.value === 'string' && c.value !== '$record')
      presets[f.id] = c.value;
    else if (f.type === 'checkbox' && typeof c.value === 'boolean') presets[f.id] = c.value;
  }
  return presets;
}
