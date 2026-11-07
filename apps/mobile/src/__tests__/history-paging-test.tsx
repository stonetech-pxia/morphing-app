import {
  applyOps,
  createDefaultWorkspace,
  createMockAIProvider,
  type Collection,
  type WorkspaceConfig,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore } from '../ai/settings';
import HistoryRoute from '../app/history';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { loadAssetUsage } from '../storage/asset-uses';
import { findRevisionTables } from '../storage/revision-pages';
import type { WorkspaceRepo } from '../storage/types';
import { FakeFiles } from '../test-utils/fake-files';
import { sqliteRepo } from '../test-utils/node-sqlite';
import { acceptNextAlert, testRegistry } from '../test-utils/render-app';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// R02（底线 7）：改动记录永远能回到以前任何时候。历史页一页 50 条，往下翻能一直翻到第一个版本；
// 「设置 → 数据」找回已移出界面的表、存储空间看旧版本里的文件用到，也要读完全部历史，不能只看最近一千个。

const books: Collection = {
  id: 'books',
  name: '书',
  fields: [{ id: 'title', name: '书名', type: 'text' }],
};

/** 第一个版本：有一张「书」表和一个指向文件 oldfile 的入口；后面的版本都是空白工作空间（把它们移出去了）。 */
function firstConfig(): WorkspaceConfig {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [
      { op: 'addData', table: books },
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'lease', look: 'entry', show: { title: '合同' }, opens: { file: 'oldfile' } },
      },
    ],
    { registry: testRegistry, locale: 'zh' },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

async function fill(repo: WorkspaceRepo, count: number) {
  let baseId: number | null = null;
  for (let n = 1; n <= count; n++) {
    const r = await repo.commitRevision({
      baseId,
      config: n === 1 ? firstConfig() : createDefaultWorkspace('zh'),
      source: 'user',
      summary: `v${n}`,
    });
    baseId = r.id;
  }
}

describe.each([
  ['memory', async () => new MemoryWorkspaceRepo()],
  ['SQLite', sqliteRepo],
] as const)('listRevisions 翻页 (%s)', (_name, make: () => Promise<WorkspaceRepo>) => {
  it('beforeId 取比它更早的，新的在前，翻到没有为止', async () => {
    const repo = await make();
    await fill(repo, 120);
    const ids = async (limit: number, before?: number) =>
      (await repo.listRevisions(limit, before)).map((r) => r.id);
    expect(await ids(50)).toEqual(Array.from({ length: 50 }, (_, i) => 120 - i));
    expect(await ids(50, 71)).toEqual(Array.from({ length: 50 }, (_, i) => 70 - i));
    expect(await ids(50, 21)).toEqual(Array.from({ length: 20 }, (_, i) => 20 - i));
    expect(await ids(50, 1)).toEqual([]);
  });
});

describe('超过一千个版本以后，最早的版本还是找得到', () => {
  it('找回只在第一个版本里的表的结构', async () => {
    const repo = new MemoryWorkspaceRepo();
    await fill(repo, 1100);
    const found = await findRevisionTables(repo, new Set(['books', 'nothing']));
    expect([...found.keys()]).toEqual(['books']);
    expect(found.get('books')!.fields.map((f) => f.id)).toEqual(['title']);
  });

  it('找回之后不再往更早的读（全都找到了就停）', async () => {
    const repo = new MemoryWorkspaceRepo();
    await fill(repo, 30);
    const list = jest.spyOn(repo, 'listRevisions');
    expect((await findRevisionTables(repo, new Set())).size).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });

  it('存储空间：只在第一个版本里用过的文件，标成「旧版本里用过」', async () => {
    const repo = new MemoryWorkspaceRepo();
    await fill(repo, 1100);
    const config = (await repo.getHead())!.config as WorkspaceConfig;
    const { usage, tables } = await loadAssetUsage(repo, config, ['oldfile', 'neverused']);
    expect(usage.get('oldfile')).toMatchObject({ uses: [], inOldVersions: true });
    expect(usage.get('neverused')).toMatchObject({ uses: [], inOldVersions: false });
    expect(tables.has('books')).toBe(true);
  });
});

describe('改动记录页', () => {
  async function renderHistory(count: number) {
    const repo = new MemoryWorkspaceRepo();
    await fill(repo, count);
    const aiSettings = createAISettingsStore({
      secrets: { get: async () => null, set: async () => undefined, delete: async () => undefined },
      serverAvailable: false,
    });
    await aiSettings.getState().load();
    const files = new FakeFiles();
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
            <GestureHandlerRootView style={{ flex: 1 }}>
              <Stack />
            </GestureHandlerRootView>
          </WorkspaceProvider>
        </AISettingsProvider>
      ),
      index: () => null,
      history: HistoryRoute,
    });
    // 从设置进来的：有页面可以退回去（回到旧版本后返回设置）。
    await act(() => router.push('/history'));
    return { store, repo };
  }

  it('版本不多：没有「加载更多」', async () => {
    await renderHistory(5);
    expect(await screen.findByTestId('revision-1')).toBeTruthy();
    expect(screen.queryByTestId('history-more')).toBeNull();
  });

  it('120 个版本：先显示最近 50 个，点「加载更多」往下翻到第一个版本，能回到它', async () => {
    const { store } = await renderHistory(120);
    expect(await screen.findByTestId('revision-120')).toBeTruthy();
    expect(screen.getByTestId('revision-71')).toBeTruthy();
    expect(screen.queryByTestId('revision-70')).toBeNull();
    await fireEvent.press(screen.getByTestId('history-more'));
    expect(await screen.findByTestId('revision-70')).toBeTruthy();
    expect(screen.getByTestId('revision-21')).toBeTruthy();
    expect(screen.queryByTestId('revision-20')).toBeNull();
    await fireEvent.press(screen.getByTestId('history-more'));
    expect(await screen.findByTestId('revision-1')).toBeTruthy();
    // 翻完了就没有按钮了。
    expect(screen.queryByTestId('history-more')).toBeNull();

    // 最早的那个版本有「书」表；现在的没有。回到它是追加一个新版本，原来的都还在。
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(false);
    acceptNextAlert();
    await fireEvent.press(screen.getByTestId('restore-1'));
    await waitFor(() => expect(store.getState().head!.id).toBe(121));
    expect(store.getState().head!.source).toBe('restore');
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    expect((await store.getState().listRevisions(1))[0]!.id).toBe(121);
  });
});
