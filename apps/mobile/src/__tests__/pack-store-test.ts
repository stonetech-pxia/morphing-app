import { PACKS } from '@morph/core';

import { PackError, PackStore } from '../packs/store';
import { MemoryPackFs, manifests, sha256, text } from '../test-utils/memory-packs';

// 扩展包下载、校验和删除。

describe('extension packs', () => {
  it('the real manifest is well formed', () => {
    const ids = PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of PACKS) {
      for (const dep of pack.requires ?? []) expect(ids).toContain(dep);
      for (const file of pack.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        // 固定版本：地址里必须带 @版本号。
        expect(file.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^@/]+@\d/);
        expect(file.size).toBeGreaterThan(0);
        expect(file.path).not.toMatch(/\.\.|^\//);
      }
    }
    expect(ids).toEqual(
      expect.arrayContaining(['scan', 'ocr', 'ocr-eng', 'ocr-chi-sim', 'pdfview']),
    );
  });

  it('downloads a pack with its dependency, verifies every file, and works offline afterwards', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(
      fs,
      sha256,
      (id) => lookup.get(id),
      () => 1000,
    );
    const progress: string[] = [];
    await store.install('ocr-eng', (p) =>
      progress.push(`${p.packId} ${p.doneBytes}/${p.totalBytes}`),
    );
    // 两个文件并行下载，先完成哪个不一定（3 或 4 字节）。
    expect(progress).toEqual([
      'ocr 0/7',
      expect.stringMatching(/^ocr [34]\/7$/),
      'ocr 7/7',
      'ocr-eng 0/7',
      'ocr-eng 7/7',
    ]);
    expect(await store.isInstalled('ocr')).toBe(true);
    expect(await store.isInstalled('ocr-eng')).toBe(true);
    expect((await store.installed()).map((p) => p.id).sort()).toEqual(['ocr', 'ocr-eng']);
    expect(await store.readText('ocr', 'a.js')).toBe('aaa');

    // 已安装就不再下载（离线可用）。
    fs.net.clear();
    await store.install('ocr-eng');
    expect(fs.downloads).toHaveLength(3);
  });

  it('a file with the wrong hash is rejected and nothing is left behind', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    fs.net.set('https://cdn/b.js', text('evil'));
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    await expect(store.install('ocr')).rejects.toEqual(new PackError('hash', 'b.js'));
    expect(fs.files.size).toBe(0);
    expect(await store.isInstalled('ocr')).toBe(false);

    fs.net.delete('https://cdn/a.js');
    await expect(store.install('ocr')).rejects.toEqual(new PackError('download', 'a.js'));
  });

  it('removing the text recognition pack also removes its languages', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    await store.install('ocr-eng');
    await store.remove('ocr');
    expect(await store.installed()).toEqual([]);
    expect(fs.files.size).toBe(0);
  });
});
