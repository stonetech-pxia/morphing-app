import type { DataRecord, WorkspaceConfig } from '@morph/core';

// 本地存储契约（M1/M2 以设备本地为唯一权威来源，§5.4）。
// SQLite 实现用于 App，内存实现用于测试；两者必须满足同样的语义。

export type RevisionSource = 'seed' | 'ai' | 'user' | 'restore' | 'rollback' | 'recovery';

export interface RevisionRecord {
  id: number;
  parentId: number | null;
  schemaVersion: number;
  /** 原始 JSON：读取后必须经过 prepareSnapshot（迁移 + 校验）才能使用。 */
  config: unknown;
  source: RevisionSource;
  summary: string;
  createdAt: number;
}

export type ChangeStatus =
  'previewing' | 'committed' | 'cancelled' | 'rejected' | 'failed' | 'rolled_back';

export interface ChangeRequestRecord {
  id: number;
  input: string;
  plan: unknown;
  status: ChangeStatus;
  baseRevisionId: number | null;
  resultRevisionId: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly expectedBase: number | null,
    readonly actualHead: number | null,
  ) {
    super(`workspace changed: expected head ${expectedBase}, found ${actualHead}`);
  }
}

export interface CommitInput {
  /** 生成这次修改时看到的 head；与当前 head 不一致时提交失败（§7D baseRevision）。 */
  baseId: number | null;
  config: WorkspaceConfig;
  source: RevisionSource;
  summary: string;
}

/** 用户文件（§6 UserAsset）：归属工作空间，不随版本恢复，回滚和卸载工具都不会删除。 */
export interface AssetRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** 相对于 App 文档目录的路径。 */
  path: string;
  source: 'picked' | 'generated';
  createdAt: number;
}

export type ToolRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 工作流执行记录（§6 ToolRun）：只记录状态和错误代码，不记录文件内容。 */
export interface ToolRunRecord {
  id: number;
  toolId: string;
  workflowId: string;
  revisionId: number;
  status: ToolRunStatus;
  error: string | null;
  outputAssetId: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** 用户数据的一条记录（docs/DATA_DESIGN.md）。不属于任何版本：撤销、恢复都不会改动它。 */
export interface StoredRecord extends DataRecord {
  /** 软删除时间；null 表示正常。 */
  deletedAt: number | null;
}

export interface WorkspaceRepo {
  getHead(): Promise<RevisionRecord | null>;
  getRevision(id: number): Promise<RevisionRecord | null>;
  /** 最新的在前。 */
  listRevisions(limit: number): Promise<RevisionRecord[]>;
  /** 原子操作：检查 head、写入新 revision、移动 head。冲突时抛 RevisionConflictError。 */
  commitRevision(input: CommitInput): Promise<RevisionRecord>;

  createChangeRequest(input: {
    input: string;
    plan: unknown;
    status: ChangeStatus;
    baseRevisionId: number | null;
    error?: string;
  }): Promise<number>;
  updateChangeRequest(
    id: number,
    patch: { status: ChangeStatus; resultRevisionId?: number; error?: string },
  ): Promise<void>;
  getChangeRequest(id: number): Promise<ChangeRequestRecord | null>;

  addAsset(asset: AssetRecord): Promise<void>;
  getAsset(id: string): Promise<AssetRecord | null>;
  /** 最新的在前。 */
  listAssets(): Promise<AssetRecord[]>;

  /** AssetGrant（§7G）：工具只能读取授权给它的文件。 */
  grantAsset(toolId: string, assetId: string): Promise<void>;
  hasGrant(toolId: string, assetId: string): Promise<boolean>;
  /** 卸载工具时只删除授权，不删除文件。 */
  revokeToolGrants(toolId: string): Promise<void>;

  startToolRun(input: { toolId: string; workflowId: string; revisionId: number }): Promise<number>;
  finishToolRun(
    id: number,
    result: { status: Exclude<ToolRunStatus, 'running'>; error?: string; outputAssetId?: string },
  ): Promise<void>;
  listToolRuns(limit: number): Promise<ToolRunRecord[]>;

  // ---- 设备上的小设置（不属于配置、不进版本，例如使用习惯的统计 D-127）----
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // ---- 用户记录：只由用户在页面上的操作读写，从不经过 AI ----
  /** 某张表未删除的记录（顺序不保证，由调用方排序）。 */
  listRecords(collectionId: string): Promise<DataRecord[]>;
  getRecord(id: string): Promise<StoredRecord | null>;
  insertRecord(record: DataRecord): Promise<void>;
  updateRecord(id: string, values: Record<string, unknown>, updatedAt: number): Promise<void>;
  /** 软删除：可以撤销，「最近删除」里保留 30 天。 */
  deleteRecord(id: string, deletedAt: number): Promise<void>;
  restoreRecord(id: string): Promise<void>;
  /** 最近删除的在前。 */
  listDeletedRecords(): Promise<StoredRecord[]>;
  /** 永久清除在 before 之前软删除的记录，返回清除的数量。 */
  purgeDeletedRecords(before: number): Promise<number>;
  /** 每张表未删除的记录数（包括已经不在配置里的表）。 */
  countRecords(): Promise<{ collectionId: string; count: number }[]>;
  /** 用户确认后永久删除一张表的全部记录。 */
  purgeCollection(collectionId: string): Promise<void>;
}
