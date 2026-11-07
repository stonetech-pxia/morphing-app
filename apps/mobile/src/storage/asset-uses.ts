import {
  assetIdsIn,
  assetUsage,
  type AssetUsage,
  type Collection,
  type DataRecord,
  type WorkspaceConfig,
} from '@morph/core';

import { revisionTables } from '../workspace/revision-tables';
import { eachRevisionPage } from './revision-pages';
import type { WorkspaceRepo } from './types';

/**
 * 用户文件用在哪里（D-264）：现在和旧版本里的表、记录（包括回收站里的）、页面。存储空间页面列出来，
 * 全部文件页面删除前用它提醒（D-472）。只读。
 */
export async function loadAssetUsage(
  repo: WorkspaceRepo,
  config: WorkspaceConfig,
  assetIds: readonly string[],
): Promise<{
  usage: Map<string, AssetUsage>;
  tables: Map<string, Collection>;
  records: (DataRecord & { deletedAt: number | null })[];
}> {
  const deleted = await repo.listDeletedRecords();
  const ids = new Set([
    ...config.data.tables.map((c) => c.id),
    ...(await repo.countRecords()).map((r) => r.collectionId),
    ...deleted.map((r) => r.collectionId),
  ]);
  const active = (await Promise.all([...ids].map((id) => repo.listRecords(id)))).flat();
  // 只在旧版本里的表：从历史版本里找回结构（和「设置 → 数据」一样）；旧版本用到的文件一并收集。
  // 全部历史一页一页读（R02），每个版本只留下需要的，不把几千份配置同时放在内存里。
  const tables = new Map<string, Collection>();
  const oldAssetIds = new Set<string>();
  await eachRevisionPage(repo, (page) => {
    for (const rev of page) {
      assetIdsIn(rev.config, oldAssetIds);
      for (const table of revisionTables(rev.config))
        if (!tables.has(table.id)) tables.set(table.id, table);
    }
  });
  for (const c of config.data.tables) tables.set(c.id, c);
  const records = [...active.map((r) => ({ ...r, deletedAt: null })), ...deleted];
  const usage = assetUsage({
    assetIds,
    config,
    collections: [...tables.values()],
    records,
    revisions: [],
    oldAssetIds,
    now: new Date(),
  });
  return { usage, tables, records };
}
