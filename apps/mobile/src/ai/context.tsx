import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { AISettingsState, AISettingsStore } from './settings';

const AISettingsContext = createContext<AISettingsStore | null>(null);

export function AISettingsProvider({
  store,
  children,
}: {
  store: AISettingsStore;
  children: ReactNode;
}) {
  return <AISettingsContext.Provider value={store}>{children}</AISettingsContext.Provider>;
}

export function useAISettings<T>(selector: (state: AISettingsState) => T): T {
  const store = useContext(AISettingsContext);
  if (!store) throw new Error('AISettingsProvider is missing');
  return useStore(store, selector);
}
