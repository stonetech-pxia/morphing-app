import type { WorkspaceConfig } from '@morph/core';

// 收件页面「存成记录」（D-392、D-444）：列出有附件字段的表（全部，不推荐）和「新建表单」。
// 不用 AI、不识别文字、不预填别的值；收到的文件复制成用户文件放进附件字段，用户自己填完保存。

export type RecordChoice = {
  kind: 'table';
  tableId: string;
  name: string;
  /** 文件像收据，这张表带收据规则（D-421）：排第一并标推荐（D-476）。 */
  recommended?: true;
};

/** 已有的、能放文件的表。新建一张表走新建表单页（D-444）。 */
export function recordChoices(config: WorkspaceConfig, receiptLike = false): RecordChoice[] {
  const tables = config.data.tables.filter((c) => c.fields.some((f) => f.type === 'file'));
  const choice = (c: (typeof tables)[number]): RecordChoice => ({
    kind: 'table',
    tableId: c.id,
    name: c.name,
  });
  if (!receiptLike) return tables.map(choice);
  const rule = tables.filter((c) => c.prefillRules === 'receipt');
  return [
    ...rule.map((c) => ({ ...choice(c), recommended: true as const })),
    ...tables.filter((c) => c.prefillRules !== 'receipt').map(choice),
  ];
}

/**
 * 为新记录表单复制出来的用户文件（还没有存进任何记录）。只在内存里，按一个随机的键交给记录页：
 * 用户没保存就离开时，记录页按这个键删掉它们。不放进路由参数：外部链接不能借这个删用户的文件。
 */
const formCopies = new Map<string, string[]>();

export function holdFormCopies(assetIds: string[]): string {
  const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  formCopies.set(key, assetIds);
  return key;
}

/** 取走这个键的文件（只能取一次）；不是这里给的键返回空。 */
export function takeFormCopies(key: string | undefined): string[] {
  if (!key) return [];
  const ids = formCopies.get(key) ?? [];
  formCopies.delete(key);
  return ids;
}
