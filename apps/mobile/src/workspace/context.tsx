import type { Locale, Registry } from '@morph/core';
import { createContext, useContext, type ReactNode } from 'react';
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
