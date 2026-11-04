import { z } from 'zod';

import { defineField, fieldBase, isText, type FieldDefinitionOf } from './define';

/** 一条记录最多几个标签，一个标签最多几个字。 */
export const MAX_RECORD_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

const schema = z.strictObject({ ...fieldBase, type: z.literal('tags') });

/** 比较两个标签时用的写法：不分大小写，全角半角一样。 */
export const tagKey = (tag: string) => tag.normalize('NFKC').toLowerCase();

/** 去掉前后空白、空的和重复的（保留第一次出现的写法）；不是文字的跳过。 */
export function cleanTags(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    if (tag === '' || seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    tags.push(tag);
  }
  return tags;
}

/**
 * 标签（创始人 2026-11-04 定）：值是这条记录自己的一组文字，存在记录里。配置里没有标签名（底线 14）：
 * 有哪些标签从记录现算（tagsInRecords），没有记录用的标签就没有了。AI 只知道有这个字段，看不到值（底线 2）。
 * 配置里的筛选只能看有没有标签（emptyOnly）：is 的值就是标签名，不能写进配置；列表上临时的筛选在内存里（browseFilter）。
 */
export const tagsField: FieldDefinitionOf<'tags', typeof schema> = defineField({
  type: 'tags',
  schema,
  label: ['标签', 'tags'],
  read: (_f, raw) => {
    if (!Array.isArray(raw)) return undefined;
    const tags = cleanTags(raw)
      .filter((tag) => tag.length <= MAX_TAG_LENGTH)
      .slice(0, MAX_RECORD_TAGS);
    return tags.length > 0 ? tags : undefined;
  },
  write: (_f, input) => {
    const list: unknown[] = Array.isArray(input) ? input : [input];
    if (!list.every((x) => typeof x === 'string')) return { issue: 'invalid' };
    const tags = cleanTags(list);
    if (tags.length > MAX_RECORD_TAGS || tags.some((tag) => tag.length > MAX_TAG_LENGTH))
      return { issue: 'tooLong' };
    return { value: tags.length > 0 ? tags : '' };
  },
  format: (_f, v) => (Array.isArray(v) ? v.join(', ') : ''),
  filter: { is: isText, emptyOnly: true },
  sort: false,
  ai: {
    doc: "(the entry's own tags, as many as the user likes: the user types them in the entry form, and tag names live only in the entries, so never name one: not in a filter, a value or a default; filters only take isEmpty / isNotEmpty; to let the user filter by tag use show.browse.filter)",
  },
  example: { id: 'labels', name: 'Tags', type: 'tags' },
  exampleValue: ['vip', 'client'],
});
