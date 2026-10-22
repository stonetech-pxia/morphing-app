import type { SQLiteDatabase } from 'expo-sqlite';

import {
  RevisionConflictError,
  type ChangeRequestRecord,
  type CommitInput,
  type RevisionRecord,
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
];

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
}
