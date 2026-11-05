import {
  fieldNameKey,
  MAX_SUGGESTIONS,
  pageOccurrences,
  ruleEngine,
  type PrefillEngine,
} from './prefill';
import type { TextPage } from './prefill/rows';
import type { Collection, Field, Locale } from './schema';

// 新建表单页的字段操作（D-444）：都是纯函数，表还没进配置，点「记下」才建。
// 字段名来自用户点的文字；配置里只有字段名，没有值（底线 14）。

const LOCALE_CURRENCY: Record<Locale, string> = { en: 'USD', zh: 'CNY', fr: 'EUR' };
const CURRENCY_SIGNS: readonly [RegExp, string][] = [
  [/€|\beur\b/i, 'EUR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/[¥￥元]|\bcny\b|\brmb\b/i, 'CNY'],
  [/\$|\busd\b/i, 'USD'],
];

/** 金额字段的货币（字段一定要有）：这个金额那一行的符号，没有就按界面语言。 */
function currencyOf(raw: string, page: TextPage, locale: Locale): string {
  const line = page.lines.find((l) => l.text.includes(raw))?.text ?? raw;
  return CURRENCY_SIGNS.find(([sign]) => sign.test(line))?.[1] ?? LOCALE_CURRENCY[locale];
}

/**
 * 新建表单页的候选：规则照旧，字段名和文件上的标签完全一样时（用户刚从文件里点的），标签旁边的值排第一。
 * 只是候选，点了才填（D-394）。不用模型：这一页每改一次字段都要重新算（D-444）。
 */
export const draftEngine: PrefillEngine = async (input, signal, onPartial) => {
  const base = await ruleEngine(input, signal, onPartial);
  const occ = input.pages.flatMap((p, i) => pageOccurrences(p, i, input.locale).occ);
  const out = { ...base };
  for (const field of input.fields) {
    if (field.type === 'file') continue;
    const key = fieldNameKey(field.name);
    const hit = occ.find(
      (o) =>
        fieldNameKey(o.label) === key &&
        (field.type === 'money'
          ? o.kind === 'money'
          : field.type === 'date'
            ? o.kind === 'date'
            : true),
    );
    if (!hit) continue;
    const value = field.type === 'text' ? hit.raw : hit.value;
    const others = (out[field.id] ?? []).filter((s) => s.value !== value);
    out[field.id] = [{ value, score: 10 }, ...others].slice(0, MAX_SUGGESTIONS);
  }
  return out;
};

/** 从文件旁边的值判断字段类型：金额、日期、电话、邮箱；看不出来就是文字。不用模型。 */
export function fieldTypeFor(
  name: string,
  pages: readonly TextPage[],
  locale: Locale,
): Pick<Field, 'type'> & { format?: 'phone' | 'email'; currency?: string } {
  const key = fieldNameKey(name);
  for (const [i, page] of pages.entries())
    for (const o of pageOccurrences(page, i, locale).occ) {
      if (fieldNameKey(o.label) !== key) continue;
      if (o.kind === 'money') return { type: 'money', currency: currencyOf(o.raw, page, locale) };
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
