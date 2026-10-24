import {
  ToolManifestSchema,
  checkToolManifest,
  isRevoked,
  registerTool,
  toolFromManifest,
  type Catalog,
  type CatalogEntry,
  type Registry,
} from '@morph/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ToolDownloadStore } from './store';

// 下载的工具在 App 里的状态（D-177）：目录、本机下载了哪些、正在下载哪个。
// 启动时先 load()（把本机下载过的工具注册进注册表），再打开工作空间，否则用到它们的配置会校验不过。

export interface ToolDownloadsState {
  /** 配置了目录地址（EXPO_PUBLIC_MORPH_TOOLS_URL）。没配置时只用本机已经下载的。 */
  configured: boolean;
  catalog: Catalog | null;
  checkedAt: number | null;
  /** 本机下载的工具：id → 版本和大小。 */
  downloaded: Record<string, { version: string; bytes: number }>;
  /** 正在下载的工具 id。 */
  busy: string | null;
  load(): Promise<void>;
  /** 拉一次目录；maxAgeMs 之内拉过就不拉。没联网时保留上次的目录。 */
  refresh(maxAgeMs?: number): Promise<void>;
  /** 下载（或更新到）目录里的最新版本，并注册进注册表。出错时抛出 ToolDownloadError。 */
  download(entry: CatalogEntry): Promise<void>;
  /** 删掉本机下载的工具（要先在配置里移除）。注册表里的留到下次启动。 */
  remove(id: string): Promise<void>;
}

export type ToolDownloads = StoreApi<ToolDownloadsState>;

export function createToolDownloads(deps: {
  store: ToolDownloadStore;
  registry: Registry;
  configured: boolean;
  now?: () => number;
}): ToolDownloads {
  const now = deps.now ?? Date.now;
  return createStore<ToolDownloadsState>()((set, get) => ({
    configured: deps.configured,
    catalog: null,
    checkedAt: null,
    downloaded: {},
    busy: null,

    async load() {
      const downloaded: ToolDownloadsState['downloaded'] = {};
      for (const tool of await deps.store.downloaded()) {
        // 每次启动都重新检查：App 更新后，旧清单可能不再适用（动作改了、能力级别变了）。
        const parsed = ToolManifestSchema.safeParse(tool.manifest);
        if (!parsed.success || checkToolManifest(parsed.data, deps.registry).length > 0) continue;
        registerTool(deps.registry, toolFromManifest(parsed.data));
        downloaded[parsed.data.id] = { version: parsed.data.version, bytes: tool.bytes };
      }
      const cached = await deps.store.cachedCatalog();
      set({
        downloaded,
        catalog: cached?.catalog ?? null,
        checkedAt: cached?.checkedAt ?? null,
      });
    },

    async refresh(maxAgeMs = 0) {
      if (!deps.configured) return;
      const { checkedAt } = get();
      if (checkedAt !== null && now() - checkedAt < maxAgeMs) return;
      try {
        const catalog = await deps.store.refreshCatalog();
        set({ catalog, checkedAt: now() });
      } catch {
        // 没联网、服务器出错或签名不对：保留上次验证过的目录。
      }
    },

    async download(entry) {
      set({ busy: entry.id });
      try {
        const tool = await deps.store.download(entry, deps.registry);
        registerTool(deps.registry, toolFromManifest(tool.manifest));
        set({
          downloaded: {
            ...get().downloaded,
            [entry.id]: { version: tool.manifest.version, bytes: tool.bytes },
          },
        });
      } finally {
        set({ busy: null });
      }
    },

    async remove(id) {
      await deps.store.remove(id);
      const { [id]: _, ...rest } = get().downloaded;
      set({ downloaded: rest });
    },
  }));
}

/** 这个工具在本机的版本被停用了（D-178：没联网时用上次的目录，没有目录就不算停用）。 */
export function toolRevoked(state: ToolDownloadsState, toolId: string): boolean {
  const version = state.downloaded[toolId]?.version;
  return version !== undefined && isRevoked(state.catalog, toolId, version);
}
