import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import type { ToolDownloads, ToolDownloadsState } from './state';

const ToolDownloadsContext = createContext<ToolDownloads | null>(null);

/** 没有提供下载功能时（测试、没配置的环境）：没有目录，也没有下载的工具。 */
const NONE: ToolDownloads = createStore<ToolDownloadsState>()(() => ({
  configured: false,
  catalog: null,
  checkedAt: null,
  downloaded: {},
  busy: null,
  load: async () => undefined,
  refresh: async () => undefined,
  download: async () => {
    throw new Error('tool downloads are not available');
  },
  remove: async () => undefined,
}));

export function ToolDownloadsProvider({
  value,
  children,
}: {
  value: ToolDownloads;
  children: ReactNode;
}) {
  return <ToolDownloadsContext.Provider value={value}>{children}</ToolDownloadsContext.Provider>;
}

export function useToolDownloads<T>(selector: (state: ToolDownloadsState) => T): T {
  return useStore(useContext(ToolDownloadsContext) ?? NONE, selector);
}
