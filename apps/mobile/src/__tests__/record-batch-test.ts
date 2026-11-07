import { MemoryWorkspaceRepo } from '../storage/memory';
import type { RecordWrite, WorkspaceRepo } from '../storage/types';
import { sqliteRepo } from '../test-utils/node-sqlite';

// R06 / R09：几条记录的写入、加上一个标记，在同一个事务里做完——要么全做、要么全不做。
// SQLite 用真实的事务（BEGIN / ROLLBACK，test-utils/node-sqlite.ts）。

const record = (id: string, count: number) => ({
  id,
  collectionId: 'tasks',
  values: { count },
  createdAt: 1,
  updatedAt: 1,
});

async function seeded(make: () => Promise<WorkspaceRepo>) {
  const repo = await make();
  for (const [id, count] of [
    ['aaaaaaa1', 1],
    ['aaaaaaa2', 2],
    ['aaaaaaa3', 3],
  ] as const)
    await repo.insertRecord(record(id, count));
  return repo;
}

const counts = async (repo: WorkspaceRepo) =>
  (await repo.listRecords('tasks')).map((r) => r.values.count).sort();

describe.each([
  ['memory', async () => new MemoryWorkspaceRepo()],
  ['SQLite', sqliteRepo],
] as const)('applyRecordWrites (%s)', (_name, make: () => Promise<WorkspaceRepo>) => {
  it('全部写入和标记一起生效', async () => {
    const repo = await seeded(make);
    const writes: RecordWrite[] = [
      { kind: 'update', id: 'aaaaaaa1', values: { count: 10 }, updatedAt: 5 },
      { kind: 'insert', record: record('aaaaaaa4', 4) },
    ];
    expect(await repo.applyRecordWrites(writes, { key: 'marker', value: 'done' })).toBe('applied');
    expect(await counts(repo)).toEqual([10, 2, 3, 4]);
    expect(await repo.getMeta('marker')).toBe('done');
    expect((await repo.getRecord('aaaaaaa1'))!.updatedAt).toBe(5);
  });

  it('中间有一条写不进去：前面的也不生效，标记也不写', async () => {
    const repo = await seeded(make);
    const writes: RecordWrite[] = [
      { kind: 'update', id: 'aaaaaaa1', values: { count: 10 }, updatedAt: 5 },
      { kind: 'update', id: 'aaaaaaa2', values: { count: 20 }, updatedAt: 5 },
      // 已经有这个 ID：插入会失败。
      { kind: 'insert', record: record('aaaaaaa3', 99) },
    ];
    await expect(
      repo.applyRecordWrites(writes, { key: 'marker', value: 'done' }),
    ).rejects.toThrow();
    expect(await counts(repo)).toEqual([1, 2, 3]);
    expect(await repo.getMeta('marker')).toBeNull();
  });

  it('要求「现在还是这份」的那条已经被改过：整批都不做，返回 conflict', async () => {
    const repo = await seeded(make);
    await repo.updateRecord('aaaaaaa2', { count: 22 }, 3);
    const writes: RecordWrite[] = [
      {
        kind: 'update',
        id: 'aaaaaaa1',
        values: { count: 10 },
        updatedAt: 5,
        expected: { count: 1 },
      },
      {
        kind: 'update',
        id: 'aaaaaaa2',
        values: { count: 20 },
        updatedAt: 5,
        expected: { count: 2 },
      },
    ];
    expect(await repo.applyRecordWrites(writes, { key: 'marker', value: 'done' })).toBe('conflict');
    expect(await counts(repo)).toEqual([1, 22, 3]);
    expect(await repo.getMeta('marker')).toBeNull();
  });

  it('要求「现在还是这份」的那条已经删了：conflict', async () => {
    const repo = await seeded(make);
    await repo.deleteRecord('aaaaaaa1', 9);
    const writes: RecordWrite[] = [
      {
        kind: 'update',
        id: 'aaaaaaa1',
        values: { count: 10 },
        updatedAt: 5,
        expected: { count: 1 },
      },
    ];
    expect(await repo.applyRecordWrites(writes)).toBe('conflict');
  });

  it('只写标记也行（没有记录要写）', async () => {
    const repo = await seeded(make);
    expect(await repo.applyRecordWrites([], { key: 'marker', value: 'x' })).toBe('applied');
    expect(await repo.getMeta('marker')).toBe('x');
  });
});
