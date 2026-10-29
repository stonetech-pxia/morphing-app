import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  LAYOUT_STORE_KEY,
  layoutStoreFile,
  parseLayoutStore,
  type LayoutMemory,
  createRegistry,
  templateOps,
  type AIProvider,
} from '@morph/core';
import { createClaudePlanner, type PlannerMessage } from '@morph/planner';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import DataRoute from '../app/data';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import RecordRoute from '../app/record/[collectionId]';
import TableReadyRoute from '../app/table-ready/[collectionId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 用户数据（docs/DATA_DESIGN.md）：AI 搭页面，用户记录内容；改界面、撤销、恢复都不碰记录；
// 发给模型的内容里永远没有记录。

const registry = createRegistry(BUILTIN_TOOLS);

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

async function renderApp({
  repo = new MemoryWorkspaceRepo(),
  provider = createMockAIProvider(),
}: { repo?: MemoryWorkspaceRepo; provider?: AIProvider } = {}) {
  const files = new FakeFiles();
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider,
    registry,
    locale: 'zh',
    now: () => new Date(),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack />
          </GestureHandlerRootView>
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'record/[collectionId]': RecordRoute,
    'table-ready/[collectionId]': TableReadyRoute,
    data: DataRoute,
  });
  return { repo, store, files };
}

/**
 * 数据页面分两步（D-191）：数据表是功能，直接做好，打开「数据表做好了」；
 * 页面是外观，点「接着改」自动发送，进草稿，应用。
 */
async function buildDataPage(text: string) {
  await fireEvent.press(screen.getByTestId('nav-ai'));
  await fireEvent.changeText(await screen.findByTestId('change-input'), text);
  await fireEvent.press(screen.getByTestId('change-submit'));
  expect(await screen.findByTestId('table-ready-screen')).toHaveTextContent(/数据表做好了/);
  expect(screen.getByTestId('next-card')).toHaveTextContent(/增加记账页面/);
  await fireEvent.press(screen.getByTestId('next-go'));
  await fireEvent.press(await screen.findByTestId('draft-apply', {}, { timeout: 4000 }));
  expect(await screen.findByTestId('banner')).toBeTruthy();
}

async function addExpense(amount: string, category: string, note: string) {
  await fireEvent.changeText(screen.getByTestId('form-add-amount'), amount);
  await fireEvent.press(screen.getByTestId(`form-add-category-${category}`));
  await fireEvent.changeText(screen.getByTestId('form-add-note'), note);
  await fireEvent.press(screen.getByTestId('form-add-submit'));
}

describe('user data (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('AI builds a budget page; entries are recorded on the page and the stats update', async () => {
    const { repo } = await renderApp();
    await buildDataPage('新建一个记账页面');

    // 导航栏已满，新页面的入口是首页上的快捷入口。
    await fireEvent.press(await screen.findByText('记账'));
    expect(await screen.findByTestId('component-recent')).toBeTruthy();
    expect(screen.getByText('还没有记录')).toBeTruthy();

    await addExpense('35', 'food', '午饭');
    await addExpense('12.5', 'transport', '地铁');
    expect(await screen.findByText(/^午饭 · \d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    expect(await screen.findByText('¥47.50')).toBeTruthy();
    expect(screen.getByText('¥35.00')).toBeTruthy();
    expect((await repo.listRecords('expenses')).length).toBe(2);

    // 必填项为空时不保存，并提示。
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    expect(await screen.findByText('必填')).toBeTruthy();
    expect((await repo.listRecords('expenses')).length).toBe(2);
  });

  it('checklists, editing and deleting with undo', async () => {
    const { repo, store } = await renderApp();
    const result = await store
      .getState()
      .proposeOps(templateOps('todo', store.getState().config!, 'zh'), '新建待办');
    expect(result.kind).toBe('preview');
    await store.getState().confirm();

    await fireEvent.press(await screen.findByText('待办'));
    await fireEvent.changeText(await screen.findByTestId('form-add-title'), '买牛奶');
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    const [todo] = await repo.listRecords('todos');
    expect(todo!.values).toEqual({ title: '买牛奶', done: false });

    await fireEvent.press(await screen.findByTestId(`check-${todo!.id}`));
    expect((await repo.getRecord(todo!.id))!.values.done).toBe(true);

    // 打开记录编辑页修改，然后删除并撤销。
    await fireEvent.press(screen.getByText('买牛奶'));
    await fireEvent.changeText(await screen.findByTestId('editor-title'), '买燕麦奶');
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect(await screen.findByText('买燕麦奶')).toBeTruthy();

    await fireEvent.press(screen.getByText('买燕麦奶'));
    await fireEvent.press(await screen.findByTestId('editor-delete'));
    expect(await screen.findByText('已删除一条记录')).toBeTruthy();
    expect(await repo.listRecords('todos')).toEqual([]);
    await fireEvent.press(screen.getByTestId('toast-undo'));
    expect(await screen.findByText('买燕麦奶')).toBeTruthy();
  });

  it('a new table can be tried right away, before it has a page (D-191)', async () => {
    const { repo } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '新建一个记账页面');
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('table-ready-name')).toHaveTextContent('账目');
    await fireEvent.press(screen.getByTestId('table-ready-record'));
    await fireEvent.changeText(await screen.findByTestId('editor-amount'), '35');
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(await repo.listRecords('expenses')).toHaveLength(1);
  });

  it('undo, restore and removing the table never touch the entries', async () => {
    const { repo, store, files } = await renderApp();
    await buildDataPage('新建一个记账页面');
    await fireEvent.press(await screen.findByText('记账'));
    await addExpense('35', 'food', '午饭');
    expect(await screen.findAllByText('¥35.00')).toHaveLength(2);
    const entries = await repo.listRecords('expenses');

    // 撤销一次界面修改：记录不变。
    const theme = await store.getState().proposeOps([{ op: 'setTheme', radius: 4 }], '圆角');
    expect(theme.kind).toBe('preview');
    await store.getState().confirm();
    await store.getState().undo();
    await store.getState().confirm();
    expect(await repo.listRecords('expenses')).toEqual(entries);

    // 恢复到建表之前的版本：数据表离开界面，记录保留在「设置 → 数据」。
    expect((await store.getState().proposeRestore(1)).kind).toBe('preview');
    await store.getState().confirm();
    expect(store.getState().config!.collections).toEqual([]);
    expect(await repo.listRecords('expenses')).toEqual(entries);

    // 记账页已不存在，回到外壳。
    await testRouter.back();
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-data'));
    expect(await screen.findByTestId('orphan-expenses')).toBeTruthy();
    expect(screen.getByText('1 条记录')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('export-expenses'));
    expect(files.sharedTexts.get('账目.csv')).toContain('35.00,餐饮,');

    // 再恢复到有这张表的版本：记录原样回来。
    const withTable = (await repo.listRevisions(20)).find(
      (r) => (r.config as { collections?: unknown[] }).collections?.length,
    )!;
    expect((await store.getState().proposeRestore(withTable.id)).kind).toBe('preview');
    await store.getState().confirm();
    expect(store.getState().config!.collections.map((c) => c.id)).toEqual(['expenses']);
    expect(await repo.listRecords('expenses')).toEqual(entries);
  });

  it('a table that is no longer in the app can be deleted for good, after confirmation', async () => {
    const { repo, store } = await renderApp();
    await store.getState().proposeOps(templateOps('notes', store.getState().config!, 'zh'), '笔记');
    await store.getState().confirm();
    await repo.insertRecord({
      id: 'n1',
      collectionId: 'notes',
      values: { title: '想法' },
      createdAt: 1,
      updatedAt: 1,
    });
    await store.getState().proposeOps([{ op: 'removeCollection', collectionId: 'notes' }], '移除');
    await store.getState().confirm();

    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-data'));
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await fireEvent.press(await screen.findByTestId('purge-notes'));
    expect(await repo.countRecords()).toEqual([]);
  });

  it('AI requests about the entries themselves are refused', async () => {
    await renderApp();
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '记一笔午饭 35');
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByText(/AI 只修改界面，不会读取或改动你记录的数据/)).toBeTruthy();
    expect(screen.queryByTestId('draft-bar')).toBeNull();
  });
});

describe('Settings → Data: app design and prefill memory', () => {
  const memory = (id: string): LayoutMemory => ({
    id,
    anchors: ['青禾小馆', '实付', '谢谢惠顾'],
    fieldTypes: { amount: 'money' },
    fields: {
      amount: { kind: 'amount', label: '实付', offset: 0, position: 0.7, format: 'dot', hits: 1 },
    },
  });
  const openData = async () => {
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-data'));
  };
  const answer = (pick: (buttons: AlertButton[]) => AlertButton | undefined) =>
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      pick(buttons ?? [])?.onPress?.();
    });

  afterEach(() => jest.restoreAllMocks());

  it('exports the app design as a file without any entries', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { files, store } = await renderApp({ repo });
    await store.getState().proposeOps(templateOps('notes', store.getState().config!, 'zh'), '笔记');
    await store.getState().confirm();
    await repo.insertRecord({
      id: 'n1',
      collectionId: 'notes',
      values: { title: '秘密想法' },
      createdAt: 1,
      updatedAt: 1,
    });
    await openData();
    await fireEvent.press(await screen.findByTestId('export-app-config'));
    const [[name, text]] = [...files.sharedTexts];
    expect(name).toMatch(/^morph-config-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(text!);
    expect(file.format).toBe('morph-app-config');
    expect(file.config.collections.map((c: { id: string }) => c.id)).toContain('notes');
    expect(text).not.toContain('秘密想法');
  });

  it('a new user has nothing to export or clear, but can restore a backup', async () => {
    const { repo, files } = await renderApp();
    await openData();
    expect(await screen.findByText('还没有记住单据版式')).toBeTruthy();
    expect(screen.queryByTestId('export-prefill-memory')).toBeNull();
    expect(screen.queryByTestId('clear-prefill-memory')).toBeNull();

    const backup = layoutStoreFile({ expenses: [memory('a'), memory('b')] }, new Date());
    files.nextPick = [
      {
        uri: 'file:///cache/DocumentPicker/backup.json',
        name: 'backup.json',
        size: 1,
        mimeType: 'application/json',
      },
    ];
    files.pickedTexts.set('file:///cache/DocumentPicker/backup.json', backup);
    const alert = jest.spyOn(Alert, 'alert');
    alert.mockImplementationOnce((_t, message, buttons) => {
      expect(message).toBe('用这个文件里的预填记忆（2 种版式）替换现在的？');
      buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
    });
    await fireEvent.press(await screen.findByTestId('restore-prefill-memory'));
    expect(await screen.findByText('记住了 2 种单据版式')).toBeTruthy();
    expect(parseLayoutStore(await repo.getMeta(LAYOUT_STORE_KEY)).expenses).toHaveLength(2);
    expect(files.readPicked).toEqual(['file:///cache/DocumentPicker/backup.json']);
  });

  it('exports the memory as a backup and clears it after confirmation', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.setMeta(LAYOUT_STORE_KEY, JSON.stringify({ expenses: [memory('a')] }));
    const { files } = await renderApp({ repo });
    await openData();
    expect(await screen.findByText('记住了 1 种单据版式')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('export-prefill-memory'));
    const [[name, text]] = [...files.sharedTexts];
    expect(name).toMatch(/^morph-prefill-memory-.*\.json$/);
    expect(JSON.parse(text!).tables.expenses[0].id).toBe('a');

    // 取消：什么都不变。
    answer((b) => b.find((x) => x.style === 'cancel'));
    await fireEvent.press(screen.getByTestId('clear-prefill-memory'));
    expect(parseLayoutStore(await repo.getMeta(LAYOUT_STORE_KEY)).expenses).toHaveLength(1);
    answer((b) => b.find((x) => x.style === 'destructive'));
    await fireEvent.press(screen.getByTestId('clear-prefill-memory'));
    expect(await screen.findByText('还没有记住单据版式')).toBeTruthy();
    expect(parseLayoutStore(await repo.getMeta(LAYOUT_STORE_KEY))).toEqual({});
  });

  it('refuses a file that is not a prefill memory backup and keeps the current memory', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.setMeta(LAYOUT_STORE_KEY, JSON.stringify({ expenses: [memory('a')] }));
    const { files } = await renderApp({ repo });
    await openData();
    files.nextPick = [
      {
        uri: 'file:///cache/DocumentPicker/notes.json',
        name: 'notes.json',
        size: 1,
        mimeType: 'application/json',
      },
    ];
    files.pickedTexts.set(
      'file:///cache/DocumentPicker/notes.json',
      '{"format":"morph-app-config"}',
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(await screen.findByTestId('restore-prefill-memory'));
    expect(alert).toHaveBeenCalledWith(
      '从文件恢复',
      '这个文件不是 Morph 导出的预填记忆，没有恢复。',
    );
    expect(parseLayoutStore(await repo.getMeta(LAYOUT_STORE_KEY)).expenses).toHaveLength(1);
  });
});

describe('privacy: the model never receives entries', () => {
  it('the full request sent to Claude contains the table structure but none of the entries', async () => {
    const sent: PlannerMessage[][] = [];
    const planner = createClaudePlanner({
      registry,
      now: () => new Date(),
      complete: async (messages) => {
        sent.push(JSON.parse(JSON.stringify(messages)));
        const text = JSON.stringify({
          kind: 'ops',
          ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }],
        });
        return {
          text,
          stopReason: 'end_turn',
          content: [{ type: 'text', text }],
          model: 'test',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    });
    // 同时记录 AIProvider 收到的全部参数（包括配置）。
    const seen: string[] = [];
    const provider: AIProvider = {
      plan: (input, ctx) => {
        seen.push(JSON.stringify({ input, ctx: { config: ctx.config, locale: ctx.locale } }));
        return planner.plan(input, ctx);
      },
    };

    const repo = new MemoryWorkspaceRepo();
    const { store } = await renderApp({ repo, provider });
    await store
      .getState()
      .proposeOps(templateOps('budget', store.getState().config!, 'zh'), '记账');
    await store.getState().confirm();

    await fireEvent.press(await screen.findByText('记账'));
    await addExpense('4242.42', 'food', 'SECRET-MARKER-9271 给王小明的红包');
    expect(await screen.findAllByText('¥4,242.42')).toHaveLength(2);
    expect((await repo.listRecords('expenses'))[0]!.values.note).toContain('SECRET-MARKER-9271');

    expect((await store.getState().propose('主题换成绿色')).kind).toBe('preview');

    const request = JSON.stringify(sent);
    expect(sent).toHaveLength(1);
    // 数据表的结构会发送（字段名），记录的内容和数值不会。
    expect(request).toContain('账目');
    expect(request).toContain('amount');
    for (const secret of ['SECRET-MARKER-9271', '王小明', '4242.42', '4242']) {
      expect(request).not.toContain(secret);
      expect(seen.join('')).not.toContain(secret);
    }
  });
});

describe('retention', () => {
  it('entries deleted more than 30 days ago are removed for good at startup', async () => {
    const repo = new MemoryWorkspaceRepo();
    const day = 24 * 60 * 60 * 1000;
    for (const [id, ago] of [
      ['old', 31],
      ['recent', 29],
    ] as const) {
      await repo.insertRecord({ id, collectionId: 'x', values: {}, createdAt: 0, updatedAt: 0 });
      await repo.deleteRecord(id, Date.now() - ago * day);
    }
    await renderApp({ repo });
    expect((await repo.listDeletedRecords()).map((r) => r.id)).toEqual(['recent']);
  });
});
