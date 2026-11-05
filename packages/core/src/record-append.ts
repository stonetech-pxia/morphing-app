import { MAX_ATTACHMENTS, attachmentIds } from './field-values';
import type { Collection } from './schema';

// 把一次运行的结果放进一条已有的记录（out.addRecord 的 into: "existing"，D-443）：只追加，不替换、不删除。
// 这里是纯规则：放哪个字段、还能放几个、表单开始时填什么。选记录、存文件、写数据库在 App 里，表单由用户确认。

/** 文件放进哪个字段、文字放进哪个字段：第一个附件字段；第一个长文本，没有就第一个文字字段。 */
export function recordTargets(collection: Collection) {
  return {
    fileField: collection.fields.find((f) => f.type === 'file')?.id,
    textField: (
      collection.fields.find((f) => f.type === 'note') ??
      collection.fields.find((f) => f.type === 'text')
    )?.id,
  };
}

/** 这条记录的附件字段还能再放几个文件；表里没有附件字段是 0。 */
export function attachRoom(collection: Collection, values: Readonly<Record<string, unknown>>) {
  const { fileField } = recordTargets(collection);
  if (fileField === undefined) return 0;
  return Math.max(0, MAX_ATTACHMENTS - attachmentIds(values[fileField]).length);
}

/**
 * 往一条已有的记录里追加东西时，表单开始时要改的字段（只含改了的）：文件接在原来的后面，不重复、不超过上限；
 * 文字在字段是空的（或只有空白）时写进去，否则另起一行接在后面，原来的一个字不动。
 */
export function appendPrefill(
  collection: Collection,
  values: Readonly<Record<string, unknown>>,
  add: { fileIds?: readonly string[]; text?: string },
): Record<string, unknown> {
  const { fileField, textField } = recordTargets(collection);
  const out: Record<string, unknown> = {};
  if (fileField !== undefined && add.fileIds && add.fileIds.length > 0) {
    const existing = attachmentIds(values[fileField]);
    const merged = [...existing];
    for (const id of add.fileIds)
      if (merged.length < MAX_ATTACHMENTS && !merged.includes(id)) merged.push(id);
    if (merged.length > existing.length) out[fileField] = merged;
  }
  if (textField !== undefined && add.text !== undefined && add.text.trim() !== '') {
    const old = values[textField];
    out[textField] =
      typeof old === 'string' && old.trim() !== ''
        ? `${old.replace(/\n+$/, '')}\n${add.text}`
        : add.text;
  }
  return out;
}
