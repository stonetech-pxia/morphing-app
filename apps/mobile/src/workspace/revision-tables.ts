import { CollectionSchema, migrateWorkspace, type Collection } from '@morph/core';

/**
 * 一个历史版本里的数据表（v34 之前的版本先升级，v33 的引用字段写法不一样）。
 * 用来找回已移出界面的表的结构（版本只追加、不删除）。读不出来的版本跳过。
 */
export function revisionTables(raw: unknown): Collection[] {
  const migrated = migrateWorkspace(raw);
  if (!migrated.ok) return [];
  const list = (migrated.config as { data?: { tables?: unknown[] } }).data?.tables ?? [];
  return list.flatMap((c) => {
    const parsed = CollectionSchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
}
