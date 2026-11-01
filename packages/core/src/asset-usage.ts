import { RECORD_LIMITS, attachmentIds, type DataRecord } from './data';
import { allComponents, type Collection, type WorkspaceConfig } from './schema';

// 「设置 → 存储空间」（D-264）：Morph 保存的每个用户文件现在用在哪里。只看文件 ID，
// 不看文件名和内容；这一页只在本机显示，从不发给 AI。

/** 用到一个文件的地方。 */
export type AssetUse =
  /** 一条记录的附件（D-263）。deleted：在「最近删除」里（30 天内还能恢复）。 */
  | { kind: 'record'; collectionId: string; recordId: string; deleted: boolean }
  /** 一个块：图片、文件位（entry 的 opens.file）、卡片的图片背景（D-045、D-257、D-258）。 */
  | { kind: 'component'; pageId: string; componentId: string }
  /** 一个页面的图片背景（D-258）。 */
  | { kind: 'page'; pageId: string };

export interface AssetUsage {
  uses: AssetUse[];
  /** 现在没有地方用，但历史版本里用过（恢复旧版本时会再用到它）。 */
  inOldVersions: boolean;
}

/**
 * 一段配置 JSON 里所有指向用户文件的 ID（不管在哪一层）。v34 只有四处（NEW_FORMAT §3.5）：图片块的
 * show.asset、卡片的 style.backdrop.assetId、页面的 backdrop.assetId、文件位的 opens.file；
 * 历史版本可能是 v33 的配置，那时都叫 assetId。
 */
function collectAssetIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectAssetIds(v, into);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (ASSET_KEYS.has(k) && typeof v === 'string') into.add(v);
      else collectAssetIds(v, into);
    }
  }
}
const ASSET_KEYS = new Set(['assetId', 'asset', 'file']);

/** 当前配置里用到文件的页面和块。 */
export function configAssetUses(config: WorkspaceConfig): Map<string, AssetUse[]> {
  const uses = new Map<string, AssetUse[]>();
  const add = (id: string, use: AssetUse) => uses.set(id, [...(uses.get(id) ?? []), use]);
  for (const page of config.containers.pages) {
    if (page.backdrop?.assetId) add(page.backdrop.assetId, { kind: 'page', pageId: page.id });
    for (const c of allComponents(page)) {
      const ids = new Set<string>();
      // 分组的子块单独算，不算在分组上。
      collectAssetIds({ ...c, children: [] }, ids);
      for (const id of ids) add(id, { kind: 'component', pageId: page.id, componentId: c.id });
    }
  }
  return uses;
}

/**
 * 每个文件用在哪里。records 是所有记录（包括「最近删除」里的）；collections 是这些记录所在的表的结构
 * （当前配置里的，和只在旧版本里的表），用来找附件字段。revisions 是历史版本的配置 JSON。
 * 最近删除超过 30 天的记录不算（马上会被清除）。
 */
export function assetUsage(input: {
  assetIds: readonly string[];
  config: WorkspaceConfig;
  collections: readonly Collection[];
  records: readonly (DataRecord & { deletedAt: number | null })[];
  revisions: readonly unknown[];
  now: Date;
}): Map<string, AssetUsage> {
  const { config, now } = input;
  const result = new Map<string, AssetUsage>(
    input.assetIds.map((id) => [id, { uses: [], inOldVersions: false }]),
  );
  const add = (id: string, use: AssetUse) => result.get(id)?.uses.push(use);

  for (const [id, uses] of configAssetUses(config)) for (const use of uses) add(id, use);

  const fileFields = new Map<string, string[]>();
  for (const c of [...config.data.tables, ...input.collections]) {
    if (fileFields.has(c.id)) continue;
    fileFields.set(
      c.id,
      c.fields.filter((f) => f.type === 'file').map((f) => f.id),
    );
  }
  const oldest = now.getTime() - RECORD_LIMITS.deletedRetentionDays * 24 * 3600 * 1000;
  for (const r of input.records) {
    if (r.deletedAt !== null && r.deletedAt < oldest) continue;
    const ids = new Set(
      (fileFields.get(r.collectionId) ?? []).flatMap((f) => attachmentIds(r.values[f])),
    );
    for (const id of ids)
      add(id, {
        kind: 'record',
        collectionId: r.collectionId,
        recordId: r.id,
        deleted: r.deletedAt !== null,
      });
  }

  const old = new Set<string>();
  for (const rev of input.revisions) collectAssetIds(rev, old);
  for (const [id, usage] of result) usage.inOldVersions = usage.uses.length === 0 && old.has(id);
  return result;
}

/** 现在没有地方在用：当前配置、没删的记录和最近删除里的记录都没用到（旧版本里用过的也算没在用）。 */
export const isUnused = (usage: AssetUsage | undefined) => !usage || usage.uses.length === 0;
