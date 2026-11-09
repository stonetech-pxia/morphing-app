import { BUNDLED_PACKS, PACKS, PACK_HOST, PREFILL_MODEL_PACK, packFileUrl } from '@morph/core';

import { PackError, PackStore } from '../packs/store';
import { MemoryPackFs, bundlePack, manifests, sha256, text } from '../test-utils/memory-packs';

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
        // 还没定托管地址的（展平模型，D-274）写相对路径，路径里带扩展包的 ID 和版本号。
        if (file.url.startsWith(PACK_HOST)) {
          expect(file.url).toBe(
            `${PACK_HOST}${pack.id}/${pack.version}/${file.url.split('/').pop()}`,
          );
          continue;
        }
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

  it('downloads a pack without a fixed address from the configured pack server only (D-274)', async () => {
    const fs = new MemoryPackFs();
    const body = text('model');
    const file = {
      path: 'uvdoc.onnx',
      url: `${PACK_HOST}dewarp/1.0.0/uvdoc.onnx`,
      size: body.length,
      sha256: await sha256(body),
    };
    const pack = { ...PACKS.find((p) => p.id === 'dewarp')!, files: [file] };
    fs.net.set('https://packs.example/dewarp/1.0.0/uvdoc.onnx', body);
    expect(packFileUrl(file)).toBeNull();
    expect(packFileUrl(file, 'https://packs.example/')).toBe(
      'https://packs.example/dewarp/1.0.0/uvdoc.onnx',
    );
    expect(packFileUrl(PACKS[0]!.files[0]!)).toBe(PACKS[0]!.files[0]!.url);

    // 没配置地址：下载不了，不留下半个扩展包。
    const unconfigured = new PackStore(fs, sha256, () => pack);
    await expect(unconfigured.install('dewarp')).rejects.toBeInstanceOf(PackError);
    expect(await unconfigured.isInstalled('dewarp')).toBe(false);

    const store = new PackStore(
      fs,
      sha256,
      () => pack,
      () => 1,
      'https://packs.example',
    );
    await store.install('dewarp');
    expect(await store.isInstalled('dewarp')).toBe(true);
    expect(fs.downloads).toEqual(['https://packs.example/dewarp/1.0.0/uvdoc.onnx']);
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
      name: { en: '', zh: '', fr: '' },
      description: { en: '', zh: '', fr: '' },
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

  it('two installs of the same pack at once download it once (background download, then asking again)', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    const seen: number[] = [];
    await Promise.all([store.install('ocr'), store.install('ocr', (p) => seen.push(p.doneBytes))]);
    expect(fs.downloads).toHaveLength(2);
    expect(await store.isInstalled('ocr')).toBe(true);
    // 后来的那次也能看到进度，不是只等着。
    expect(seen.length).toBeGreaterThan(0);
  });

  it('tells listeners when a download that went to the background finishes or fails', async () => {
    const fs = new MemoryPackFs();
    const store = new PackStore(fs, sha256, () => undefined);
    const seen: { ids: string[]; ok: boolean }[] = [];
    const off = store.onBackgroundEnd((e) => seen.push(e));
    store.finishedInBackground(['ocr'], true);
    store.finishedInBackground(['ocr-eng'], false);
    off();
    store.finishedInBackground(['x'], true);
    expect(seen).toEqual([
      { ids: ['ocr'], ok: true },
      { ids: ['ocr-eng'], ok: false },
    ]);
  });

  // D-510：处理文件常用的扩展包随 App 打包，算已安装；第一次用到时从 App 里复制，和下载一样校验。
  describe('packs that come with the app (D-510)', () => {
    it('only the file tools are bundled, not the big optional downloads', () => {
      const ids = PACKS.map((p) => p.id);
      for (const id of [...BUNDLED_PACKS.ios, ...BUNDLED_PACKS.android]) expect(ids).toContain(id);
      expect(BUNDLED_PACKS.ios).toEqual(['ppocr', 'pdfview', 'dewarp', 'layout']);
      // 拉正照片只有 Android 要（iOS 系统能找纸边）。
      expect(BUNDLED_PACKS.android).toEqual([...BUNDLED_PACKS.ios, 'scan']);
      for (const id of [...BUNDLED_PACKS.ios, ...BUNDLED_PACKS.android]) {
        expect(id).not.toBe(PREFILL_MODEL_PACK);
        expect(id).not.toMatch(/^(speech-|ocr$|ocr-)/);
      }
    });

    it('counts as installed without a download: copied once, verified, offline', async () => {
      const fs = new MemoryPackFs();
      const lookup = await manifests(fs);
      const ocr = lookup.get('ocr')!;
      bundlePack(fs, ocr, (path) => (path === 'a.js' ? text('aaa') : text('bbbb')));
      fs.net.clear();
      const store = new PackStore(
        fs,
        sha256,
        (id) => lookup.get(id),
        () => 5,
      );
      const changed = jest.fn();
      store.subscribe(changed);

      expect(await store.isInstalled('ocr')).toBe(true);
      expect(fs.downloads).toEqual([]);
      expect(fs.copies.sort()).toEqual(['ocr/7.0.0/a.js', 'ocr/7.0.0/b.js']);
      expect(await store.readText('ocr', 'b.js')).toBe('bbbb');
      expect(changed).toHaveBeenCalledTimes(1);
      expect(await store.installed()).toEqual([
        { id: 'ocr', version: '7.0.0', bytes: 7, installedAt: 5, bundled: true },
      ]);
      // 复制过一次就不再复制。
      expect(await store.isInstalled('ocr')).toBe(true);
      expect(fs.copies).toHaveLength(2);
      // 没带的照旧要下载。
      expect(await store.isInstalled('ocr-eng')).toBe(false);
    });

    it('lists bundled packs as installed before anything asked for them', async () => {
      const fs = new MemoryPackFs();
      const lookup = await manifests(fs);
      bundlePack(fs, lookup.get('ocr')!, (path) => (path === 'a.js' ? text('aaa') : text('bbbb')));
      const store = new PackStore(fs, sha256, (id) => lookup.get(id));
      expect((await store.installed()).map((p) => [p.id, p.bundled])).toEqual([['ocr', true]]);
    });

    it('a bundled file with the wrong hash is not used; the pack then downloads as before', async () => {
      const fs = new MemoryPackFs();
      const lookup = await manifests(fs);
      bundlePack(fs, lookup.get('ocr')!, () => text('evil'));
      const store = new PackStore(fs, sha256, (id) => lookup.get(id));
      expect(await store.isInstalled('ocr')).toBe(false);
      expect(fs.files.size).toBe(0);
      expect(await store.installed()).toEqual([]);
      // 没经过用户确认不下载；用户点了下载才下载。
      expect(fs.downloads).toEqual([]);
      await store.install('ocr');
      expect(fs.downloads.sort()).toEqual(['https://cdn/a.js', 'https://cdn/b.js']);
      expect((await store.installed()).map((p) => [p.id, p.bundled])).toEqual([['ocr', undefined]]);
    });

    it('a newer version in the manifest is downloaded and replaces the bundled copy', async () => {
      const fs = new MemoryPackFs();
      const lookup = await manifests(fs);
      const old = lookup.get('ocr')!;
      bundlePack(fs, old, (path) => (path === 'a.js' ? text('aaa') : text('bbbb')));
      expect(await new PackStore(fs, sha256, (id) => lookup.get(id)).isInstalled('ocr')).toBe(true);

      // 下一个 App 版本的清单换了新版本（例如 R2 上的新模型），App 里带的还是旧的。
      const body = text('newer');
      fs.net.set('https://cdn/c.js', body);
      const newer = {
        ...old,
        version: '7.1.0',
        files: [{ path: 'c.js', url: 'https://cdn/c.js', size: 5, sha256: await sha256(body) }],
      };
      const store = new PackStore(fs, sha256, (id) => (id === 'ocr' ? newer : lookup.get(id)));
      expect(await store.isInstalled('ocr')).toBe(false);
      await store.install('ocr');
      expect(fs.downloads).toEqual(['https://cdn/c.js']);
      expect([...fs.files.keys()].sort()).toEqual(['ocr/7.1.0/c.js', 'ocr/7.1.0/ready.json']);
      expect((await store.installed()).map((p) => [p.version, p.bundled])).toEqual([
        ['7.1.0', undefined],
      ]);
    });
  });
});
