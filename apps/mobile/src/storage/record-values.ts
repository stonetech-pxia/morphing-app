/** 稳定的 JSON：对象的键排好序，同样的内容不管键怎么排都得到同样的字符串。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 两条记录的值是不是一样（不管键的顺序）：条件写入（updateRecordIfUnchanged）用它判断记录有没有被改过。 */
export const sameValues = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  canonical(a) === canonical(b);
