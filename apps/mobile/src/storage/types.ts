import type { WorkspaceConfig } from '@morph/core';

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
}
