import { fieldNameKey, pageOccurrences } from './prefill';
import type { TextPage } from './prefill/rows';
import type { Collection, Field, Locale } from './schema';

// 新建表单页的字段操作（D-444）：都是纯函数，表还没进配置，点「记下」才建。
// 字段名来自用户点的文字；配置里只有字段名，没有值（底线 14）。

/** 从文件旁边的值判断字段类型：金额、日期、电话、邮箱；看不出来就是文字。不用模型。 */
export function fieldTypeFor(
  name: string,
  pages: readonly TextPage[],
  locale: Locale,
): Pick<Field, 'type'> & { format?: 'phone' | 'email' } {
  const key = fieldNameKey(name);
  for (const [i, page] of pages.entries())
    for (const o of pageOccurrences(page, i, locale).occ) {
      if (fieldNameKey(o.label) !== key) continue;
      if (o.kind === 'money') return { type: 'money' };
      if (o.kind === 'date') return { type: 'date' };
      if (o.kind === 'phone') return { type: 'text', format: 'phone' };
      if (o.kind === 'email') return { type: 'text', format: 'email' };
      if (o.kind === 'text') continue;
    }
  return { type: 'text' };
}

/** 这个名字的字段已经有了。 */
export const draftHasField = (table: Collection, name: string) =>
  table.fields.some((f) => fieldNameKey(f.name) === fieldNameKey(name));

/** 加一个字段（放在附件前面）。名字空的或重复的不加。 */
export function addDraftField(
  table: Collection,
  name: string,
  pages: readonly TextPage[],
  locale: Locale,
): Collection {
  const trimmed = name.trim();
  if (!trimmed || draftHasField(table, trimmed)) return table;
  const fields = table.fields;
  let n = fields.length + 1;
  while (fields.some((f) => f.id === `field-${n}`)) n++;
  const field = {
    id: `field-${n}`,
    name: trimmed,
    ...fieldTypeFor(trimmed, pages, locale),
  } as Field;
  const at = fields.findIndex((f) => f.type === 'file');
  const next = [...fields];
  next.splice(at < 0 ? next.length : at, 0, field);
  return { ...table, fields: next };
}

/** 改字段名。空的或和别的字段重复时不改。 */
export function renameDraftField(table: Collection, id: string, name: string): Collection {
  const trimmed = name.trim();
  const fields = table.fields;
  if (!trimmed || fields.some((f) => f.id !== id && fieldNameKey(f.name) === fieldNameKey(trimmed)))
    return table;
  return { ...table, fields: fields.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) };
}

/** 去掉字段。附件字段留着：文件要放在那里。 */
export function removeDraftField(table: Collection, id: string): Collection {
  return { ...table, fields: table.fields.filter((f) => f.id !== id || f.type === 'file') };
}
