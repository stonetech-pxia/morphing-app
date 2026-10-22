import { PACKS, type PackManifest } from '@morph/core';

import { PackError, PackStore, type PackFs } from '../packs/store';

// 扩展包下载、校验和删除。哈希用真实的 SHA-256（Node 的 WebCrypto）。

const sha256 = async (bytes: Uint8Array) => {
  const digest = await (globalThis as { crypto: Crypto }).crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** 内存里的 packs 目录和一个假的网络。 */
class MemoryPackFs implements PackFs {
  files = new Map<string, Uint8Array>();
  net = new Map<string, Uint8Array>();
  downloads: string[] = [];
  async download(url: string, path: string) {
    const bytes = this.net.get(url);
    if (!bytes) throw new Error('offline');
    this.downloads.push(url);
    this.files.set(path, bytes);
    return bytes;
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async readText(path: string) {
    return String.fromCharCode(...this.files.get(path)!);
  }
  async writeText(path: string, value: string) {
    this.files.set(path, text(value));
  }
  async readBytes(path: string) {
    return this.files.get(path)!;
  }
  async remove(path: string) {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }
  async listDirs(path: string) {
    const prefix = path ? `${path}/` : '';
    return [
      ...new Set(
        [...this.files.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length).split('/')[0]!),
      ),
    ];
  }
  uri(path: string) {
    return `file:///packs/${path}`;
  }
}

async function manifests(fs: MemoryPackFs) {
  const file = async (url: string, body: string) => {
    fs.net.set(url, text(body));
    return {
      path: url.split('/').pop()!,
      url,
      size: body.length,
      sha256: await sha256(text(body)),
    };
  };
  const base: PackManifest = {
    id: 'ocr',
    version: '7.0.0',
    name: { en: 'OCR', zh: '文字识别包' },
    description: { en: '', zh: '' },
    license: 'Apache-2.0',
    files: [await file('https://cdn/a.js', 'aaa'), await file('https://cdn/b.js', 'bbbb')],
  };
  const lang: PackManifest = {
    ...base,
    id: 'ocr-eng',
    version: '4.0.0',
    requires: ['ocr'],
    files: [await file('https://cdn/eng.gz', 'english')],
  };
  return new Map([base, lang].map((m) => [m.id, m]));
}

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
    expect(progress).toEqual(['ocr 0/7', 'ocr 3/7', 'ocr 7/7', 'ocr-eng 0/7', 'ocr-eng 7/7']);
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
