import type { DataRecord } from '@morph/core';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  RevisionConflictError,
  type AssetRecord,
  type ChangeRequestRecord,
  type CommitInput,
  type RevisionRecord,
  type StoredRecord,
  type ToolRunRecord,
  type WorkspaceRepo,
} from './types';

// SQLite 实现。数据库结构用 PRAGMA user_version 管理，每个元素是一次升级。

const DB_MIGRATIONS: string[] = [
  `CREATE TABLE workspace_head (
     singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
     revision_id INTEGER NOT NULL REFERENCES revisions(id)
   );
   CREATE TABLE revisions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     parent_id INTEGER REFERENCES revisions(id),
     schema_version INTEGER NOT NULL,
     config_json TEXT NOT NULL,
     source TEXT NOT NULL,
     summary TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE change_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     input TEXT NOT NULL,
     plan_json TEXT,
     status TEXT NOT NULL,
     base_revision_id INTEGER,
     result_revision_id INTEGER,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  `CREATE TABLE assets (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size INTEGER NOT NULL,
     path TEXT NOT NULL,
     source TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE asset_grants (
     tool_id TEXT NOT NULL,
     asset_id TEXT NOT NULL REFERENCES assets(id),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (tool_id, asset_id)
   );
   CREATE TABLE tool_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tool_id TEXT NOT NULL,
     workflow_id TEXT NOT NULL,
     revision_id INTEGER NOT NULL,
     status TEXT NOT NULL,
     error TEXT,
     output_asset_id TEXT,
     started_at INTEGER NOT NULL,
     finished_at INTEGER
   );`,
  // 用户记录：在配置之外，不随版本恢复（docs/DATA_DESIGN.md）。
  `CREATE TABLE records (
     id TEXT PRIMARY KEY,
     collection_id TEXT NOT NULL,
     values_json TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   );
   CREATE INDEX records_by_collection ON records (collection_id, deleted_at, created_at);`,
  // 设备上的小设置：使用习惯的统计等（D-127），不随版本恢复。
  `CREATE TABLE app_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

interface RecordRow {
  id: string;
  collection_id: string;
  values_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toStoredRecord(row: RecordRow): StoredRecord {
  let values: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.values_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      values = parsed as Record<string, unknown>;
    }
  } catch {
    // 损坏的记录显示为空，而不是让页面崩溃。
  }
  return {
    id: row.id,
    collectionId: row.collection_id,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  for (let v = row?.user_version ?? 0; v < DB_MIGRATIONS.length; v++) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(DB_MIGRATIONS[v]!);
      await txn.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

interface RevisionRow {
  id: number;
  parent_id: number | null;
  schema_version: number;
  config_json: string;
  source: RevisionRecord['source'];
  summary: string;
  created_at: number;
}

function toRevision(row: RevisionRow): RevisionRecord {
  let config: unknown;
  try {
    config = JSON.parse(row.config_json);
  } catch {
    config = null; // 损坏的快照交给 prepareSnapshot 拒绝
  }
  return {
    id: row.id,
    parentId: row.parent_id,
    schemaVersion: row.schema_version,
    config,
    source: row.source,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

interface ChangeRequestRow {
  id: number;
  input: string;
  plan_json: string | null;
  status: ChangeRequestRecord['status'];
  base_revision_id: number | null;
  result_revision_id: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export class SQLiteWorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly db: SQLiteDatabase) {}

  async getHead() {
    const row = await this.db.getFirstAsync<RevisionRow>(
      'SELECT r.* FROM workspace_head h JOIN revisions r ON r.id = h.revision_id WHERE h.singleton = 1',
    );
    return row ? toRevision(row) : null;
  }

  async getRevision(id: number) {
    const row = await this.db.getFirstAsync<RevisionRow>(
      'SELECT * FROM revisions WHERE id = ?',
      id,
    );
    return row ? toRevision(row) : null;
  }

  async listRevisions(limit: number) {
    const rows = await this.db.getAllAsync<RevisionRow>(
      'SELECT * FROM revisions ORDER BY id DESC LIMIT ?',
      limit,
    );
    return rows.map(toRevision);
  }

  async commitRevision(input: CommitInput) {
    let record: RevisionRecord | null = null;
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      const head = await txn.getFirstAsync<{ revision_id: number }>(
        'SELECT revision_id FROM workspace_head WHERE singleton = 1',
      );
      const headId = head?.revision_id ?? null;
      if (headId !== input.baseId) throw new RevisionConflictError(input.baseId, headId);
      const createdAt = Date.now();
      const result = await txn.runAsync(
        'INSERT INTO revisions (parent_id, schema_version, config_json, source, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        input.baseId,
        input.config.schemaVersion,
        JSON.stringify(input.config),
        input.source,
        input.summary,
        createdAt,
      );
      await txn.runAsync(
        'INSERT INTO workspace_head (singleton, revision_id) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET revision_id = excluded.revision_id',
        result.lastInsertRowId,
      );
      record = {
        id: result.lastInsertRowId,
        parentId: input.baseId,
        schemaVersion: input.config.schemaVersion,
        config: input.config,
        source: input.source,
        summary: input.summary,
        createdAt,
      };
    });
    return record!;
  }

  async createChangeRequest(input: Parameters<WorkspaceRepo['createChangeRequest']>[0]) {
    const now = Date.now();
    const result = await this.db.runAsync(
      'INSERT INTO change_requests (input, plan_json, status, base_revision_id, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.input,
      JSON.stringify(input.plan ?? null),
      input.status,
      input.baseRevisionId,
      input.error ?? null,
      now,
      now,
    );
    return result.lastInsertRowId;
  }

  async updateChangeRequest(
    id: number,
    patch: Parameters<WorkspaceRepo['updateChangeRequest']>[1],
  ) {
    await this.db.runAsync(
      'UPDATE change_requests SET status = ?, result_revision_id = COALESCE(?, result_revision_id), error = COALESCE(?, error), updated_at = ? WHERE id = ?',
      patch.status,
      patch.resultRevisionId ?? null,
      patch.error ?? null,
      Date.now(),
      id,
    );
  }

  async getChangeRequest(id: number) {
    const row = await this.db.getFirstAsync<ChangeRequestRow>(
      'SELECT * FROM change_requests WHERE id = ?',
      id,
    );
    if (!row) return null;
    return {
      id: row.id,
      input: row.input,
      plan: row.plan_json ? JSON.parse(row.plan_json) : null,
      status: row.status,
      baseRevisionId: row.base_revision_id,
      resultRevisionId: row.result_revision_id,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async addAsset(asset: AssetRecord) {
    await this.db.runAsync(
      'INSERT INTO assets (id, name, mime_type, size, path, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      asset.id,
      asset.name,
      asset.mimeType,
      asset.size,
      asset.path,
      asset.source,
      asset.createdAt,
    );
  }

  async getAsset(id: string) {
    const row = await this.db.getFirstAsync<AssetRow>('SELECT * FROM assets WHERE id = ?', id);
    return row ? toAsset(row) : null;
  }

  async listAssets() {
    const rows = await this.db.getAllAsync<AssetRow>(
      'SELECT * FROM assets ORDER BY created_at DESC, rowid DESC',
    );
    return rows.map(toAsset);
  }

  async deleteAsset(id: string) {
    // 授权引用了 assets（外键），先删授权。
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('DELETE FROM asset_grants WHERE asset_id = ?', id);
      await txn.runAsync(
        'UPDATE tool_runs SET output_asset_id = NULL WHERE output_asset_id = ?',
        id,
      );
      await txn.runAsync('DELETE FROM assets WHERE id = ?', id);
    });
  }

  async grantAsset(toolId: string, assetId: string) {
    await this.db.runAsync(
      'INSERT OR IGNORE INTO asset_grants (tool_id, asset_id, created_at) VALUES (?, ?, ?)',
      toolId,
      assetId,
      Date.now(),
    );
  }

  async hasGrant(toolId: string, assetId: string) {
    const row = await this.db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM asset_grants WHERE tool_id = ? AND asset_id = ?',
      toolId,
      assetId,
    );
    return (row?.n ?? 0) > 0;
  }

  async revokeToolGrants(toolId: string) {
    await this.db.runAsync('DELETE FROM asset_grants WHERE tool_id = ?', toolId);
  }

  async startToolRun(input: { toolId: string; workflowId: string; revisionId: number }) {
    const result = await this.db.runAsync(
      "INSERT INTO tool_runs (tool_id, workflow_id, revision_id, status, started_at) VALUES (?, ?, ?, 'running', ?)",
      input.toolId,
      input.workflowId,
      input.revisionId,
      Date.now(),
    );
    return result.lastInsertRowId;
  }

  async finishToolRun(id: number, result: Parameters<WorkspaceRepo['finishToolRun']>[1]) {
    await this.db.runAsync(
      'UPDATE tool_runs SET status = ?, error = ?, output_asset_id = ?, finished_at = ? WHERE id = ?',
      result.status,
      result.error ?? null,
      result.outputAssetId ?? null,
      Date.now(),
      id,
    );
  }

  async getMeta(key: string) {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string) {
    await this.db.runAsync(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  async countSucceededRuns() {
    const rows = await this.db.getAllAsync<{ workflowId: string; count: number; lastAt: number }>(
      "SELECT workflow_id AS workflowId, COUNT(*) AS count, MAX(started_at) AS lastAt FROM tool_runs WHERE status = 'succeeded' GROUP BY workflow_id",
    );
    return new Map(rows.map(({ workflowId, count, lastAt }) => [workflowId, { count, lastAt }]));
  }

  async listToolRuns(limit: number) {
    const rows = await this.db.getAllAsync<ToolRunRow>(
      'SELECT * FROM tool_runs ORDER BY id DESC LIMIT ?',
      limit,
    );
    return rows.map((r): ToolRunRecord => ({
      id: r.id,
      toolId: r.tool_id,
      workflowId: r.workflow_id,
      revisionId: r.revision_id,
      status: r.status,
      error: r.error,
      outputAssetId: r.output_asset_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
  }

  async listRecords(collectionId: string) {
    const rows = await this.db.getAllAsync<RecordRow>(
      'SELECT * FROM records WHERE collection_id = ? AND deleted_at IS NULL',
      collectionId,
    );
    return rows.map(toStoredRecord);
  }

  async getRecord(id: string) {
    const row = await this.db.getFirstAsync<RecordRow>('SELECT * FROM records WHERE id = ?', id);
    return row ? toStoredRecord(row) : null;
  }

  async insertRecord(record: DataRecord) {
    await this.db.runAsync(
      'INSERT INTO records (id, collection_id, values_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      record.id,
      record.collectionId,
      JSON.stringify(record.values),
      record.createdAt,
      record.updatedAt,
    );
  }

  async updateRecord(id: string, values: Record<string, unknown>, updatedAt: number) {
    await this.db.runAsync(
      'UPDATE records SET values_json = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(values),
      updatedAt,
      id,
    );
  }

  async deleteRecord(id: string, deletedAt: number) {
    await this.db.runAsync('UPDATE records SET deleted_at = ? WHERE id = ?', deletedAt, id);
  }

  async restoreRecord(id: string) {
    await this.db.runAsync('UPDATE records SET deleted_at = NULL WHERE id = ?', id);
  }

  async discardRecord(id: string) {
    await this.db.runAsync('DELETE FROM records WHERE id = ?', id);
  }

  async listDeletedRecords() {
    const rows = await this.db.getAllAsync<RecordRow>(
      'SELECT * FROM records WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
    );
    return rows.map(toStoredRecord);
  }

  async purgeDeletedRecords(before: number) {
    const result = await this.db.runAsync(
      'DELETE FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      before,
    );
    return result.changes;
  }

  async countRecords() {
    return this.db.getAllAsync<{ collectionId: string; count: number }>(
      'SELECT collection_id AS collectionId, COUNT(*) AS count FROM records WHERE deleted_at IS NULL GROUP BY collection_id',
    );
  }

  async purgeCollection(collectionId: string) {
    await this.db.runAsync('DELETE FROM records WHERE collection_id = ?', collectionId);
  }
}

interface AssetRow {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  path: string;
  source: AssetRecord['source'];
  created_at: number;
}

function toAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    path: row.path,
    source: row.source,
    createdAt: row.created_at,
  };
}

interface ToolRunRow {
  id: number;
  tool_id: string;
  workflow_id: string;
  revision_id: number;
  status: ToolRunRecord['status'];
  error: string | null;
  output_asset_id: string | null;
  started_at: number;
  finished_at: number | null;
}
