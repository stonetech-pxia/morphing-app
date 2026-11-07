import { MemoryWorkspaceRepo } from '../storage/memory';
import type { AssetRecord } from '../storage/types';
import { mergeUserPdfs } from '../storage/user-files';
import { copyUserFiles } from '../storage/copy-files';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

// R10：文件已经复制进 App、数据库里却登记不上时，这一个新副本要删掉（否则存储空间页看不到、也删不掉）。
// 只补偿这一次新建的副本：原件、之前已经登记好的、收件那一批不动。

const diskAssets = (files: FakeFiles) =>
  [...files.disk.keys()].filter((k) => k.startsWith('assets/'));

describe('复制进文档库：登记失败时删掉这个新副本', () => {
  it('第 2 个登记不上：第 1 个还在文档库里，第 2 个的副本删掉，返回 copyFailed', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    const a = files.offer('one.txt', new Uint8Array([1, 2, 3]), 'text/plain');
    const b = files.offer('two.txt', new Uint8Array([4, 5, 6]), 'text/plain');
    const add = repo.addAsset.bind(repo);
    let calls = 0;
    jest.spyOn(repo, 'addAsset').mockImplementation(async (asset: AssetRecord) => {
      if (++calls === 2) throw new Error('database is locked');
      return add(asset);
    });
    const result = await copyUserFiles([a, b], files, repo);
    expect(result.problem).toBe('copyFailed');
    expect(result.created).toHaveLength(1);
    const kept = await repo.listAssets();
    expect(kept.map((x) => x.name)).toEqual(['one.txt']);
    // 磁盘上只剩已经登记的那个；原件没动。
    expect(diskAssets(files)).toEqual([kept[0]!.path]);
    expect(files.disk.has(a.uri)).toBe(true);
    expect(files.disk.has(b.uri)).toBe(true);
  });
});

describe('合并 PDF：登记失败时删掉合成的新文件，原来的不动', () => {
  it('addAsset 失败：抛错，磁盘上没有留下合成的副本', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    const bytes = await makePdf(1);
    const assets: AssetRecord[] = [];
    for (const id of ['aaaaaa', 'bbbbbb']) {
      const asset: AssetRecord = {
        id,
        name: `${id}.pdf`,
        mimeType: 'application/pdf',
        size: bytes.length,
        path: `assets/${id}/${id}.pdf`,
        source: 'picked',
        createdAt: 0,
      };
      await repo.addAsset(asset);
      files.disk.set(asset.path, bytes);
      assets.push(asset);
    }
    jest.spyOn(repo, 'addAsset').mockRejectedValueOnce(new Error('database is locked'));
    await expect(
      mergeUserPdfs(assets, 'merged', repo, files, {
        now: () => new Date(),
        newId: () => 'cccccc',
      }),
    ).rejects.toThrow('database is locked');
    expect(diskAssets(files).sort()).toEqual(assets.map((a) => a.path).sort());
    expect((await repo.listAssets()).map((a) => a.id).sort()).toEqual(['aaaaaa', 'bbbbbb']);
  });
});
