import type { SQLiteDatabase } from 'expo-sqlite';

import { SQLiteWorkspaceRepo, migrateDatabase } from '../storage/sqlite';

// Node 自带的 node:sqlite 跑真实的 SQL（外键开着），包成和 App 里 expo-sqlite 一样的接口。
// 事务是真的：BEGIN / COMMIT / ROLLBACK，回调抛错就整个回滚；和 expo-sqlite 的独占事务一样一个接一个排队。
// 测「失败时全部保持原样」的写入（R06、R09 等）一定要用它，不要用直接调回调的假事务。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...p: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
    };
  };
};

export function nodeSqlite(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  let queue: Promise<unknown> = Promise.resolve();
  const transaction = (fn: (txn: unknown) => Promise<void>) => {
    const run = async () => {
      db.exec('BEGIN');
      try {
        await fn(api);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
  const api = {
    execAsync: async (sql: string) => db.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params),
    withTransactionAsync: transaction,
    withExclusiveTransactionAsync: transaction,
  };
  return api as unknown as SQLiteDatabase;
}

export async function sqliteRepo() {
  const db = nodeSqlite();
  await migrateDatabase(db);
  return new SQLiteWorkspaceRepo(db);
}
