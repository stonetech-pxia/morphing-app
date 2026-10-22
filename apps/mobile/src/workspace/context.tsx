import type { Locale, Registry } from '@morph/core';
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { WorkspaceState, WorkspaceStore } from './store';

interface WorkspaceContextValue {
  store: WorkspaceStore;
  registry: Registry;
  locale: Locale;
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
