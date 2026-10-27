import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  presetById,
  presetWorkflow,
  type Op,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import RunRoute from '../app/run/[workflowId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 快捷操作卡片可以直接指向内设快捷操作的预设 ID（D-259，和 D-236 一致）：不用先添加；
// 用户改过以后配置里有副本，卡片显示并运行副本。

const registry = createRegistry(BUILTIN_TOOLS);

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

async function renderApp() {
  const repo = new MemoryWorkspaceRepo();
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: 'zh',
    now: () => new Date(),
  });
  await store.getState().boot();
  const router = await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files: new FakeFiles(), registry, locale: 'zh' }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack />
          </GestureHandlerRootView>
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    'page/[pageId]': PageRoute,
    'run/[workflowId]': RunRoute,
  });
  return { store, router };
}

async function commit(store: WorkspaceStore, ops: Op[], summary: string) {
  expect((await store.getState().proposeOps(ops, summary)).kind).toBe('preview');
  await store.getState().confirm();
  expect(await screen.findByText(`已改好：${summary}`)).toBeTruthy();
}

const RUNNER: Op = {
  op: 'addComponent',
  pageId: 'home',
  component: {
    id: 'visa-card',
    type: 'workflowRunner',
    props: { workflowId: 'visa-photo', look: 'row' },
  },
};

describe('a quick action card for a built-in quick action', () => {
  it('runs the built-in one without adding it, then the user’s copy once there is one', async () => {
    const { store, router } = await renderApp();
    await commit(store, [RUNNER], '加卡片');
    expect(store.getState().config!.workflows.some((w) => w.presetId === 'visa-photo')).toBe(false);
    expect(await screen.findByText('签证 / 证件照')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('run-visa-photo'));
    expect(router.getPathname()).toBe('/run/visa-photo');
  });

  it('after the user changes it, the card shows and runs the copy', async () => {
    const { store, router } = await renderApp();
    const copy = {
      ...presetWorkflow(presetById('visa-photo')!, 'zh', 'kid-photo'),
      name: '孩子的证件照',
    };
    await commit(store, [{ op: 'addWorkflow', workflow: copy }, RUNNER], '改过的');
    expect(await screen.findByText('孩子的证件照')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('run-kid-photo'));
    expect(router.getPathname()).toBe('/run/kid-photo');
  });
});
