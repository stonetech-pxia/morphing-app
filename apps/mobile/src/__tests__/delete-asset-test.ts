import { MemoryWorkspaceRepo } from '../storage/memory';
import type { AssetRecord, WorkspaceRepo } from '../storage/types';
import { deleteUserFiles } from '../storage/user-files';
import { FakeFiles } from '../test-utils/fake-files';
import { sqliteRepo } from '../test-utils/node-sqlite';

// 删除用户文件（D-264）：数据库里的记录、授权和运行结果的引用一起清掉，磁盘上的目录也删掉。
// SQLite 用 Node 自带的 node:sqlite 跑真实的 SQL（test-utils/node-sqlite.ts）。

const asset = (id: string): AssetRecord => ({
  id,
  name: `${id}.jpg`,
  mimeType: 'image/jpeg',
  size: 10,
  path: `assets/${id}/${id}.jpg`,
  source: 'generated',
  createdAt: 1,
});

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
