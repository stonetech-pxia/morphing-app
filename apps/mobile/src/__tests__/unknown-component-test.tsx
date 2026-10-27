import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type Locale,
  type WorkspaceConfig,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import HomeRoute from '../app/index';
import { directEditEntry } from '../editing/entry';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// D-254：更新的 App 存下的配置里有这个版本不认识的组件。页面照常打开，那个位置显示「需要更新 App」，
// 长按只能移动和删除，保存时原样写回。

const registry = createRegistry(BUILTIN_TOOLS);

const calendar = {
  id: 'cal',
  type: 'calendar',
  props: { view: 'month' },
  style: { tone: 'primary' },
};

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

async function renderWithNewerConfig(locale: Locale) {
  const repo = new MemoryWorkspaceRepo();
  const config = createDefaultWorkspace(locale);
  // 存下来的 JSON 来自更新的 App：组件类型这个版本不认识。
  const stored = {
    ...config,
    pages: [{ ...config.pages[0]!, components: [...config.pages[0]!.components, calendar] }],
  } as unknown as WorkspaceConfig;
  await repo.commitRevision({ baseId: null, config: stored, source: 'user', summary: 'seed' });
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale,
    now: () => new Date(),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files: new FakeFiles(), registry, locale }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack />
          </GestureHandlerRootView>
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
  });
  return { repo, store };
}

const savedHead = async (repo: MemoryWorkspaceRepo) =>
  JSON.parse(JSON.stringify((await repo.getHead())!.config)) as {
    pages: { components: { id: string }[] }[];
  };

describe('a component from a newer version of the app', () => {
  beforeAll(() => {
    directEditEntry.pageButton = true;
  });
  afterAll(() => {
    directEditEntry.pageButton = false;
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['zh', '需要更新 App 才能显示这里的内容。'],
    ['en', 'This needs a newer version of this app to show.'],
    ['fr', 'Une version plus récente de cette app est nécessaire pour afficher ce contenu.'],
  ] as const)('shows an update placeholder in %s', async (locale, text) => {
    const { store } = await renderWithNewerConfig(locale);
    expect(store.getState().status).toBe('ready');
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByTestId('component-welcome')).toBeTruthy();
  });

  it('can only be moved or deleted; moving keeps its JSON as it was', async () => {
    const { repo, store } = await renderWithNewerConfig('zh');
    await fireEvent.press(await screen.findByTestId('page-edit'));
    await fireEvent.press(await screen.findByTestId('arrange-edit-cal'));
    expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
    expect(screen.queryByTestId('edit-text')).toBeNull();
    expect(screen.queryByTestId('edit-hide')).toBeNull();
    expect(screen.queryByTestId('edit-tone-primary')).toBeNull();
    expect(screen.getByTestId('edit-delete')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('edit-up'));
    await fireEvent.press(screen.getByTestId('arrange-done'));
    expect(await screen.findByText(/^已改好：/)).toBeTruthy();
    expect(store.getState().head!.source).toBe('user');
    const saved = await savedHead(repo);
    const components = saved.pages[0]!.components;
    expect(components.at(-2)).toEqual(calendar);
  });

  it('can be deleted', async () => {
    const { repo } = await renderWithNewerConfig('zh');
    await fireEvent.press(await screen.findByTestId('page-edit'));
    await fireEvent.press(await screen.findByTestId('arrange-edit-cal'));
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
      buttons?.find((b) => b.text === '删除')?.onPress?.();
    });
    await fireEvent.press(await screen.findByTestId('edit-delete'));
    await fireEvent.press(screen.getByTestId('arrange-done'));
    expect(await screen.findByText(/^已改好：/)).toBeTruthy();
    const saved = await savedHead(repo);
    expect(saved.pages[0]!.components.map((c) => c.id)).not.toContain('cal');
  });
});
