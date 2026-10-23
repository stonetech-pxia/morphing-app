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
        // 固定版本：jsDelivr 的地址里必须带 @版本号；放不进 jsDelivr 的大文件（语音模型）用 Hugging Face 固定提交的地址。
        expect(file.url).toMatch(
          /^https:\/\/(cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^@/]+@\d|huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/)/,
        );
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

  it('large files (speech models) are hashed by the native side, with byte progress', async () => {
    const fs = new MemoryPackFs();
    const big = 190 * 1024 * 1024;
    const manifest = {
      id: 'speech-whisper-small',
      version: '1.0.0',
      name: { en: '', zh: '' },
      description: { en: '', zh: '' },
      license: 'MIT',
      files: [
        { path: 'model.bin', url: 'https://hf/model.bin', size: big, sha256: 'a'.repeat(64) },
      ],
    };
    let reply = { size: big, sha256: 'a'.repeat(64) };
    const large: string[] = [];
    const fsWithLarge = Object.assign(fs, {
      async downloadLarge(url: string, path: string, onBytes: (n: number) => void) {
        large.push(`${url} -> ${path}`);
        fs.files.set(path, text('x'));
        onBytes(big / 2);
        return reply;
      },
    });
    const store = new PackStore(fsWithLarge, sha256, () => manifest);
    const progress: number[] = [];
    await store.install('speech-whisper-small', (p) => progress.push(p.doneBytes));
    expect(large).toEqual(['https://hf/model.bin -> speech-whisper-small/1.0.0/model.bin']);
    expect(fs.downloads).toEqual([]);
    expect(progress).toEqual([0, big / 2, big]);
    expect(await store.isInstalled('speech-whisper-small')).toBe(true);

    await store.remove('speech-whisper-small');
    reply = { size: big, sha256: 'b'.repeat(64) };
    await expect(store.install('speech-whisper-small')).rejects.toEqual(
      new PackError('hash', 'model.bin'),
    );
    expect(fs.files.size).toBe(0);
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
