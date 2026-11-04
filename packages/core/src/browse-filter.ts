import type { Calendar } from './calendar';
import {
  formatRef,
  localDate,
  periodRange,
  recordValue,
  type DataRecord,
  type LinkResolver,
} from './data';
import { cleanTags, tagKey } from './fields';
import { localeTag } from './localization';
import type { Collection, Field, Locale, Period } from './schema';

// 列表上的筛选和搜索读什么（创始人 2026-11-04 定）。都是现算：配置里没有标签名（底线 14），什么都不写（底线 15）。

/** 这些记录用到的标签：同一个标签（不分大小写）只算一次，排好序。没有记录用的标签就没有了。 */
export function tagsInRecords(
  records: readonly DataRecord[],
  view: Collection,
  fieldId: string,
  locale: Locale,
): string[] {
  const all = cleanTags(
    records.flatMap((r) => {
      const v = recordValue(r, view, fieldId);
      return Array.isArray(v) ? (v as readonly string[]) : [];
    }),
  );
  return all.sort(new Intl.Collator(localeTag(locale)).compare);
}

export interface BrowseFilterRow {
  field: string;
  values: { value: string; label: string }[];
}

function rowValues(
  records: readonly DataRecord[],
  view: Collection,
  field: Field,
  locale: Locale,
): BrowseFilterRow['values'] {
  if (field.type === 'tags')
    return tagsInRecords(records, view, field.id, locale).map((tag) => ({
      value: tag,
      label: tag,
    }));
  if (field.type !== 'choice') return [];
  // 单选按选项的顺序，只列有记录用的。
  const used = new Set(records.map((r) => recordValue(r, view, field.id)));
  return field.options.filter((o) => used.has(o.id)).map((o) => ({ value: o.id, label: o.label }));
}

/** 每个筛选字段一排；没有值的字段没有这一排。 */
export function browseFilterRows(
  records: readonly DataRecord[],
  view: Collection,
  fields: readonly string[],
  locale: Locale,
): BrowseFilterRow[] {
  return fields.flatMap((id) => {
    const field = view.fields.find((f) => f.id === id);
    const values = field ? rowValues(records, view, field, locale) : [];
    return values.length > 0 ? [{ field: id, values }] : [];
  });
}

/** 只留下这个字段是这个值的记录（标签：这条记录有这个标签，不分大小写）。 */
export function browseFilter(
  records: readonly DataRecord[],
  view: Collection,
  picked: { field: string; value: string },
): DataRecord[] {
  return records.filter((r) => {
    const v = recordValue(r, view, picked.field);
    return Array.isArray(v)
      ? (v as readonly string[]).some((tag) => tagKey(tag) === tagKey(picked.value))
      : v === picked.value;
  });
}

/** 列表上能切换的时间段（D-437）：本周、本月、本年；再加「全部」（不选）。 */
export const BROWSE_PERIODS = [
  'thisWeek',
  'thisMonth',
  'thisYear',
] as const satisfies readonly Period[];
export type BrowsePeriod = (typeof BROWSE_PERIODS)[number];

/** 只留下这个日期字段（或创建、修改时间）落在当前这个时间段里的记录；现算，什么都不写。没有日期的不在任何时间段里。 */
export function browsePeriod(
  records: readonly DataRecord[],
  view: Collection,
  fieldId: string,
  period: BrowsePeriod,
  now: Date,
  cal?: Calendar,
): DataRecord[] {
  const [start, end] = periodRange(period, now, cal);
  return records.filter((r) => {
    const v = recordValue(r, view, fieldId);
    const day =
      typeof v === 'number' ? localDate(new Date(v)) : typeof v === 'string' ? v.slice(0, 10) : '';
    return day !== '' && day >= start && day <= end;
  });
}

/**
 * 搜索读的文字：这张表每个字段显示出来的样子，不管列表显示不显示（电话、邮箱、备注、标签、单选的名字），
 * 加上这一行显示的（可能是创建时间）。附件不算：文件名和文件内容都不搜。
 */
export function recordSearchTexts(
  record: DataRecord,
  view: Collection,
  shown: readonly string[],
  locale: Locale,
  links?: LinkResolver,
  now: Date = new Date(),
  cal?: Calendar,
): string[] {
  const ids = [...view.fields.filter((f) => f.type !== 'file').map((f) => f.id), ...shown];
  return [...new Set(ids)]
    .filter((id) => view.fields.find((f) => f.id === id)?.type !== 'file')
    .map((id) => formatRef(record, view, id, locale, links, now, cal));
}
