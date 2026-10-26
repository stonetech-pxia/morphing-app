import { z } from 'zod';

import { localDate } from './data';
import type { ParamField } from './workflow/contract';

// 分组后各出一份（D-243）：图片转 PDF、合并 PDF、打包 ZIP 可以按规则把文件分成几组，每组出一个文件。
// 规则只有固定几种（每 N 个、同一天、同一个月），没有循环和表达式：仍然是一步一个动作，只是这一步的输出有几个文件。

export const GROUP_RULES = ['none', 'count', 'day', 'month'] as const;
export type GroupRule = (typeof GROUP_RULES)[number];

export const MAX_GROUP_SIZE = 50;

/** 加在动作参数里的两个键（旧配置没有，当作不分组）。 */
export const groupParams = {
  group: z.enum(GROUP_RULES).optional(),
  groupSize: z.number().int().min(1).max(MAX_GROUP_SIZE).optional(),
};

export const groupNeedsSize = (p: {
  group?: GroupRule | undefined;
  groupSize?: number | undefined;
}) => p.group !== 'count' || p.groupSize !== undefined;

export const GROUP_FIELDS: readonly ParamField[] = [
  {
    key: 'group',
    label: { en: 'Split into', zh: '分成几份', fr: 'Répartir' },
    kind: 'choice',
    options: [
      { value: 'none', label: { en: 'One file', zh: '一份', fr: 'Un seul fichier' } },
      {
        value: 'count',
        label: { en: 'Every N files', zh: '每 N 个一份', fr: 'Tous les N fichiers' },
      },
      {
        value: 'day',
        label: { en: 'One per day taken', zh: '按拍摄日期，每天一份', fr: 'Un par jour' },
      },
      { value: 'month', label: { en: 'One per month', zh: '每个月一份', fr: 'Un par mois' } },
    ],
  },
  {
    key: 'groupSize',
    label: { en: 'Files per group', zh: '每份几个', fr: 'Fichiers par groupe' },
    kind: 'number',
    min: 1,
    max: MAX_GROUP_SIZE,
    step: 1,
    showIf: { key: 'group', equals: ['count'] },
  },
];

export interface GroupableItem {
  name: string;
  takenAt?: number;
  modifiedAt?: number;
}

export interface FileGroup<T> {
  /** 这一份的名字（不含扩展名）：按日期分时是日期，否则是第一个文件的名字。 */
  name: string;
  items: T[];
}

/**
 * 按规则分组。count：按原来的顺序每 N 个一组。day / month：按拍摄时间（没有时用修改时间）的本地日期，
 * 组按日期从早到晚排，组内保持原来的顺序；读不到日期的放在最后一组，名字用 undated。
 */
export function groupItems<T extends GroupableItem>(
  items: readonly T[],
  rule: GroupRule | undefined,
  size: number | undefined,
  undated: string,
): FileGroup<T>[] {
  if (items.length === 0) return [];
  if (!rule || rule === 'none') return [{ name: items[0]!.name, items: [...items] }];
  if (rule === 'count') {
    const n = Math.max(1, size ?? 1);
    const groups: FileGroup<T>[] = [];
    for (let i = 0; i < items.length; i += n) {
      const chunk = items.slice(i, i + n);
      groups.push({ name: chunk[0]!.name, items: chunk });
    }
    return groups;
  }
  const byKey = new Map<string, T[]>();
  const noDate: T[] = [];
  for (const item of items) {
    const at = item.takenAt ?? item.modifiedAt;
    if (at === undefined) {
      noDate.push(item);
      continue;
    }
    const day = localDate(new Date(at));
    const key = rule === 'day' ? day : day.slice(0, 7);
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const groups = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, items: list }));
  if (noDate.length) groups.push({ name: undated, items: noDate });
  return groups;
}
