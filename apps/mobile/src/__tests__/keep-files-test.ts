import { MemoryWorkspaceRepo } from '../storage/memory';
import { keepIncomingFiles } from '../storage/keep-files';
import { FakeFiles } from '../test-utils/fake-files';

// R01：打开、分享进来的文件存进文档库（D-455），同一份内容再打开不重复存；
// 同名同大小但内容不同的是另一个文件，不能关联到旧的那份。

const bytes = (text: string) => new TextEncoder().encode(text);

async function setup() {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const keep = async (name: string, content: string, mimeType = 'text/plain') => {
    const picked = files.offer(name, bytes(content), mimeType);
    const [kept] = await keepIncomingFiles([picked], files, repo);
    return { picked, kept: kept! };
  };
  return { repo, files, keep };
}

describe('打开的文件存进文档库时认内容', () => {
  it('同名、同大小、内容不同：是两个文件，各自存一份，存成记录时用的是自己的内容', async () => {
    const { repo, files, keep } = await setup();
    const a = await keep('report.txt', 'AAAA');
    const b = await keep('report.txt', 'BBBB');
    expect(b.kept.assetId).toBeDefined();
    expect(b.kept.assetId).not.toBe(a.kept.assetId);
    const asset = await repo.getAsset(b.kept.assetId!);
    expect(await files.readBytes(asset!.path)).toEqual(bytes('BBBB'));
    expect(await repo.listAssets()).toHaveLength(2);
  });

  it('同名、同大小、内容也一样（再打开同一份）：不重复存，用已有的', async () => {
    const { repo, keep } = await setup();
    const a = await keep('report.txt', 'AAAA');
    const again = await keep('report.txt', 'AAAA');
    expect(again.kept.assetId).toBe(a.kept.assetId);
    expect(await repo.listAssets()).toHaveLength(1);
  });

  it('大小不一样、名字不一样：直接存新的，不去读文件内容', async () => {
    const { files, keep } = await setup();
    await keep('report.txt', 'AAAA');
    const digest = jest.spyOn(files, 'contentDigest');
    const longer = await keep('report.txt', 'AAAAA');
    const renamed = await keep('other.txt', 'AAAA');
    expect(longer.kept.assetId).toBeDefined();
    expect(renamed.kept.assetId).toBeDefined();
    expect(digest).not.toHaveBeenCalled();
  });

  it('选出来的文件读不了内容：当成新文件存一份，不关联到旧的', async () => {
    const { repo, files, keep } = await setup();
    const a = await keep('report.txt', 'AAAA');
    jest.spyOn(files, 'contentDigest').mockRejectedValue(new Error('unreadable'));
    const b = await keep('report.txt', 'AAAA');
    expect(b.kept.assetId).not.toBe(a.kept.assetId);
    expect(await repo.listAssets()).toHaveLength(2);
  });

  it('已经有文档库副本的（assetId）直接用；没有大小的当新文件', async () => {
    const { repo, files, keep } = await setup();
    const a = await keep('report.txt', 'AAAA');
    const [again] = await keepIncomingFiles(
      [{ ...a.picked, assetId: a.kept.assetId! }],
      files,
      repo,
    );
    expect(again!.assetId).toBe(a.kept.assetId);
    const unknownSize = { ...files.offer('report.txt', bytes('AAAA'), 'text/plain'), size: null };
    const [kept] = await keepIncomingFiles([unknownSize], files, repo);
    expect(kept!.assetId).not.toBe(a.kept.assetId);
  });
});
