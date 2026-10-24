import { createHash } from 'node:crypto';

import {
  parseToolManifest,
  registerTool,
  toolFromManifest,
  toolManifestUrl,
  trustedToolKeys,
  verifyCatalog,
  type Registry,
} from '@morph/core';

// 计划服务也要认识下载的工具（D-177）：App 的配置里添加了它们，服务端校验配置、给模型写提示词都要用到。
// 和 App 一样只信任签名的目录；目录里的工具全部注册（停用的也注册，否则已经添加了它的配置校验不过）。

export interface PublishedToolsOptions {
  /** 目录所在的地址（MORPH_TOOLS_URL），不含 catalog.json。 */
  baseUrl: string;
  /** 也信任仓库里的开发公钥（MORPH_TOOLS_DEV_KEY=1，只在本机开发时用）。 */
  devKey: boolean;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** 拉一次目录，把新的或更新了的工具注册进来。返回这次注册了几个。 */
export async function loadPublishedTools(
  registry: Registry,
  options: PublishedToolsOptions,
  state: { seq: number } = { seq: 0 },
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const get = async (url: string) => {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const base = options.baseUrl.replace(/\/+$/, '');
  const [data, signature] = await Promise.all([
    get(`${base}/catalog.json`),
    get(`${base}/catalog.sig`).then((b) => new TextDecoder().decode(b)),
  ]);
  const catalog = verifyCatalog(data, signature, trustedToolKeys(options.devKey), state.seq);
  state.seq = catalog.seq;
  let count = 0;
  for (const entry of catalog.tools) {
    if (registry.tools.get(entry.id)?.version === entry.version) continue;
    try {
      const bytes = await get(toolManifestUrl(base, entry));
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
        throw new Error('size or SHA-256 does not match the catalog');
      }
      registerTool(registry, toolFromManifest(parseToolManifest(bytes, registry, entry)));
      count++;
    } catch (e) {
      options.log?.(`下载的工具 ${entry.id}@${entry.version} 没有注册：${String(e)}`);
    }
  }
  return count;
}

/** 启动时拉一次，之后每隔 intervalMs 再拉；失败只记日志，保留已经注册的。 */
export function watchPublishedTools(
  registry: Registry,
  options: PublishedToolsOptions & { intervalMs: number },
): { ready: Promise<void>; stop: () => void } {
  const state = { seq: 0 };
  const run = () =>
    loadPublishedTools(registry, options, state).then(
      (n) => {
        if (n > 0) options.log?.(`注册了 ${n} 个下载的工具`);
      },
      (e: unknown) => options.log?.(`工具目录没有更新：${String(e)}`),
    );
  const ready = run();
  const timer = setInterval(() => void run(), options.intervalMs);
  timer.unref?.();
  return { ready, stop: () => clearInterval(timer) };
}
