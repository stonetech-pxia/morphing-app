import { generateSigningKey, signCatalog, type Catalog, type ToolManifest } from '@morph/core';

import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js';

import jobApply from '../../../../tools/job-apply/manifest.json';
import type { ToolFs } from '../tool-download/store';

// 测试用：内存里的 tools 目录、一个假的托管（地址 → 字节），和发布目录的小帮手（用测试自己的密钥签名）。

export const TOOLS_URL = 'https://tools.test/morph';

/** 同步算出来的 SHA-256（包成 Promise）：整条下载链路都在微任务里完成，测试里好等。 */
export const toolSha256 = async (bytes: Uint8Array) =>
  [...sha256Bytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

const encoder = new TextEncoder();

export class MemoryToolFs implements ToolFs {
  files = new Map<string, string>();
  net = new Map<string, Uint8Array>();
  fetches: string[] = [];
  async fetch(url: string) {
    const bytes = this.net.get(url);
    if (!bytes) throw new Error('offline');
    this.fetches.push(url);
    return bytes;
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async readText(path: string) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`no ${path}`);
    return value;
  }
  async writeText(path: string, value: string) {
    this.files.set(path, value);
  }
  async remove(path: string) {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }
  async listDirs(path: string) {
    const prefix = path ? `${path}/` : '';
    const dirs = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length).split('/');
      if (rest.length > 1) dirs.add(rest[0]!);
    }
    return [...dirs];
  }
}

/** 仓库里的示例数据工具（tools/job-apply）。 */
export const exampleManifest = (): ToolManifest =>
  JSON.parse(JSON.stringify(jobApply)) as ToolManifest;

export const testKey = generateSigningKey();

/** 把这些清单「发布」到假的托管上：清单文件、目录和签名。返回目录。 */
export async function publish(
  fs: MemoryToolFs,
  manifests: ToolManifest[],
  options: { seq: number; revoked?: string[]; tamper?: (bytes: Uint8Array) => Uint8Array },
): Promise<Catalog> {
  const tools = [];
  for (const m of manifests) {
    const bytes = encoder.encode(JSON.stringify(m));
    const path = `tools/${m.id}/${m.version}.json`;
    fs.net.set(`${TOOLS_URL}/${path}`, options.tamper ? options.tamper(bytes) : bytes);
    tools.push({
      id: m.id,
      version: m.version,
      hostApi: m.hostApi,
      path,
      size: bytes.length,
      sha256: await toolSha256(bytes),
      name: m.name,
      description: m.description,
      icon: m.icon,
    });
  }
  const catalog: Catalog = {
    format: 1,
    seq: options.seq,
    issuedAt: '2026-10-24T08:00:00.000Z',
    tools,
    revoked: options.revoked ?? [],
  };
  const data = encoder.encode(JSON.stringify(catalog));
  fs.net.set(`${TOOLS_URL}/catalog.json`, data);
  fs.net.set(`${TOOLS_URL}/catalog.sig`, encoder.encode(signCatalog(data, testKey.secretKey)));
  return catalog;
}
