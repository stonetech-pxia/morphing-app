import {
  appViewOf,
  calendarOf,
  type Calendar,
  type Locale,
  type Registry,
  type Theme,
  type WorkspaceConfig,
} from '@morph/core';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { FilePlatform } from '../runtime/runner';
import type { WorkspaceRepo } from '../storage/types';
import type { WorkspaceState, WorkspaceStore } from './store';

interface WorkspaceContextValue {
  store: WorkspaceStore;
  registry: Registry;
  locale: Locale;
  /** 工作流执行与文件列表使用的存储和平台文件能力。 */
  repo: WorkspaceRepo;
  files: FilePlatform;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}

export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(useWorkspaceContext().store, selector);
}

/**
 * 在某个 App 里打开的页面（设置、Tink、记录页……）都用这个 App 的风格，顶栏和内容一致（D-485）。
 * 不在 App 里就是主页的风格。config 不传就用已保存的那份。
 */
export function useAppTheme(config?: WorkspaceConfig): Theme {
  const appId = useWorkspace((s) => s.appId);
  const saved = useWorkspace((s) => s.config)!;
  return appViewOf(config ?? saved, appId).theme;
}

/** 一天、一周从什么时候开始（D-286）：按天、按周归类的计算都用它。 */
export function useCalendar(): Calendar {
  const settings = useWorkspace((s) => s.config?.data.calendar);
  return useMemo(() => calendarOf({ data: { tables: [], calendar: settings } }), [settings]);
}
