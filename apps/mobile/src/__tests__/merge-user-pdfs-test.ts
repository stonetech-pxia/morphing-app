import { RunError } from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import type { AssetRecord } from '../storage/types';
import { mergeUserPdfs } from '../storage/user-files';
import { FakeFiles, makePdf } from '../test-utils/fake-files';

// R04：全部文件页面的「合并」要把选中的 PDF 整份读进内存（pdf-lib），和快捷操作一样先按
// 单个 50 MB、合计 100 MB 的上限检查（P-006），超限在读文件之前就拒绝；原文件、已存的副本都不动。

const MB = 1024 * 1024;

async function setup(sizes: number[]) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const bytes = await makePdf(1);
  const assets: AssetRecord[] = [];
  for (const [i, size] of sizes.entries()) {
    const id = `a${i}aaaa`;
    const asset: AssetRecord = {
      id,
      name: `${id}.pdf`,
      mimeType: 'application/pdf',
      size,
      path: `assets/${id}/${id}.pdf`,
      source: 'picked',
      createdAt: 0,
    };
    await repo.addAsset(asset);
    files.disk.set(asset.path, bytes);
    assets.push(asset);
  }
  const read = jest.spyOn(files, 'readBytes');
  const merge = (list: readonly AssetRecord[] = assets) =>
    mergeUserPdfs(list, 'merged', repo, files, { now: () => new Date(), newId: () => 'cccccc' });
  return { repo, files, assets, read, merge };
}

describe('文档库合并 PDF 的大小检查', () => {
  it('正常的两个 PDF 合成一个新文件，原来的都还在', async () => {
    const { repo, assets, merge } = await setup([100_000, 120_000]);
    const out = await merge();
    expect(out.name).toBe('merged.pdf');
    const names = (await repo.listAssets()).map((a) => a.name).sort();
    expect(names).toEqual([...assets.map((a) => a.name), 'merged.pdf'].sort());
  });

  it('单个文件超过 50 MB：读文件之前就拒绝，什么都不写', async () => {
    const { repo, read, merge } = await setup([100_000, 51 * MB]);
    await expect(merge()).rejects.toMatchObject({ code: 'tooLarge' });
    await expect(merge()).rejects.toBeInstanceOf(RunError);
    expect(read).not.toHaveBeenCalled();
    expect(await repo.listAssets()).toHaveLength(2);
  });

  it('每个都不超过 50 MB、合计超过 100 MB：读文件之前就拒绝', async () => {
    const { repo, read, merge } = await setup([30 * MB, 30 * MB, 30 * MB, 30 * MB]);
    await expect(merge()).rejects.toMatchObject({ code: 'tooLargeTotal' });
    expect(read).not.toHaveBeenCalled();
    expect(await repo.listAssets()).toHaveLength(4);
  });

  it('刚好 50 MB 一个、合计不超过 100 MB 的不拦', async () => {
    const { read, merge } = await setup([50 * MB, 50 * MB]);
    await merge();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
