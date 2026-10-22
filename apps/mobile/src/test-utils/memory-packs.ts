import type { PackManifest } from '@morph/core';

import type { PackFs } from '../packs/store';

// 测试用：内存里的扩展包目录、假的网络和两个小清单（文字识别包 + 英文语言包）。哈希用真实的 SHA-256（Node 的 WebCrypto）。

export const sha256 = async (bytes: Uint8Array) => {
  const digest = await (globalThis as { crypto: Crypto }).crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** 内存里的 packs 目录和一个假的网络。 */
export class MemoryPackFs implements PackFs {
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

export async function manifests(fs: MemoryPackFs) {
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
