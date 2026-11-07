import type { Collection } from '@morph/core';

import { revisionTables } from '../workspace/revision-tables';
import type { RevisionRecord, WorkspaceRepo } from './types';

// 历史版本只追加、不删除（底线 7）：要看全部历史的地方（找回已移出界面的表、看旧版本里用过哪些文件）
// 一页一页从新读到旧，读完为止，不能只取最近若干个。

/** 一页读多少个版本（每个版本带整份配置，一次不读太多）。 */
export const REVISION_PAGE = 100;

/** 从新到旧一页一页读完全部历史版本。onPage 返回 true 表示够了，提前停。 */
export async function eachRevisionPage(
  repo: WorkspaceRepo,
  onPage: (page: RevisionRecord[]) => boolean | void,
): Promise<void> {
  let before: number | undefined;
  for (;;) {
    const page = await repo.listRevisions(REVISION_PAGE, before);
    if (page.length === 0) return;
    if (onPage(page) === true) return;
    if (page.length < REVISION_PAGE) return;
    before = page[page.length - 1]!.id;
  }
}

/**
 * 在历史版本里找回这些表的结构（已移出界面的表，记录还在）：同一张表取最新的那个版本里的样子，
 * 都找到了就停。
 */
export async function findRevisionTables(
  repo: WorkspaceRepo,
  missing: ReadonlySet<string>,
): Promise<Map<string, Collection>> {
  const found = new Map<string, Collection>();
  if (missing.size === 0) return found;
  await eachRevisionPage(repo, (page) => {
    for (const rev of page) {
      for (const table of revisionTables(rev.config)) {
        if (missing.has(table.id) && !found.has(table.id)) found.set(table.id, table);
      }
    }
    return found.size === missing.size;
  });
  return found;
}
