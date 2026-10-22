import { BUILTIN_TOOLS, createMockAIProvider, createRegistry } from '@morph/core';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import RunRoute from '../app/run/[workflowId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';
import { FakeFiles } from './fake-files';

// 工具和工作流旅程测试共用：真实路由 + 内存存储 + 假文件平台。

export const testRegistry = createRegistry(BUILTIN_TOOLS);

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

export async function renderToolsApp(repo = new MemoryWorkspaceRepo(), files = new FakeFiles()) {
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry: testRegistry,
    locale: 'zh',
    now: () => new Date(2026, 9, 22, 9, 0),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files, registry: testRegistry, locale: 'zh' }}>
          <Stack />
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'run/[workflowId]': RunRoute,
  });
  return { repo, store, files };
}

/** 系统确认框：直接点非取消的按钮（例如「应用更改」）。 */
export function acceptNextAlert() {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
}
