import type { SQLiteDatabase } from 'expo-sqlite';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { SQLiteWorkspaceRepo, migrateDatabase } from '../storage/sqlite';
import type { AssetRecord, WorkspaceRepo } from '../storage/types';
import { deleteUserFiles } from '../storage/user-files';
import { FakeFiles } from '../test-utils/fake-files';

// 删除用户文件（D-264）：数据库里的记录、授权和运行结果的引用一起清掉，磁盘上的目录也删掉。
// SQLite 用 Node 自带的 node:sqlite 跑真实的 SQL（外键开着），和 App 里 expo-sqlite 的接口一样包一层。

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

function nodeSqlite(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  const api = {
    execAsync: async (sql: string) => db.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params),
    withExclusiveTransactionAsync: async (fn: (txn: unknown) => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn(api);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

const asset = (id: string): AssetRecord => ({
  id,
  name: `${id}.jpg`,
  mimeType: 'image/jpeg',
  size: 10,
  path: `assets/${id}/${id}.jpg`,
  source: 'generated',
  createdAt: 1,
});

async function sqliteRepo() {
  const db = nodeSqlite();
  await migrateDatabase(db);
  return new SQLiteWorkspaceRepo(db);
}

describe.each([
  ['memory', async () => new MemoryWorkspaceRepo()],
  ['SQLite', sqliteRepo],
] as const)('deleteAsset (%s)', (_name, make: () => Promise<WorkspaceRepo>) => {
  it('removes the file, its grants and the run result pointing at it; keeps the others', async () => {
    const repo = await make();
    await repo.addAsset(asset('keep01'));
    await repo.addAsset(asset('gone01'));
    await repo.grantAsset('workflow:x', 'gone01');
    await repo.grantAsset('workflow:x', 'keep01');
    const run = await repo.startToolRun({ toolId: 'image', workflowId: 'x', revisionId: 1 });
    await repo.finishToolRun(run, { status: 'succeeded', outputAssetId: 'gone01' });

    await repo.deleteAsset('gone01');
    expect(await repo.getAsset('gone01')).toBeNull();
    expect((await repo.listAssets()).map((a) => a.id)).toEqual(['keep01']);
    expect(await repo.hasGrant('workflow:x', 'gone01')).toBe(false);
    expect(await repo.hasGrant('workflow:x', 'keep01')).toBe(true);
    expect((await repo.listToolRuns(10))[0]!.outputAssetId).toBeNull();
    // 再删一次（已经不在了）不出错。
    await repo.deleteAsset('gone01');
  });
});

describe('deleteUserFiles', () => {
  it('deletes the copy on disk and the record; never touches files outside assets/', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    await repo.addAsset(asset('aaa111'));
    files.disk.set('assets/aaa111/aaa111.jpg', new Uint8Array([1]));
    files.disk.set('assets/bbb222/b.jpg', new Uint8Array([2]));
    files.disk.set('content://media/1', new Uint8Array([3]));
    await deleteUserFiles(['aaa111', 'missing'], repo, files);
    expect(await repo.listAssets()).toEqual([]);
    expect([...files.disk.keys()].sort()).toEqual(['assets/bbb222/b.jpg', 'content://media/1']);
    await files.removeAssetFile('content://media/1');
    await files.removeAssetFile('../etc');
    expect(files.disk.has('content://media/1')).toBe(true);
  });
});
