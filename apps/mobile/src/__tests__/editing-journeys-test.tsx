import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  templateOps,
  type Op,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import RecordRoute from '../app/record/[collectionId]';
import { directEditEntry } from '../editing/entry';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 直接编辑（D-052–D-054）：长按组件或点「编辑」进入编辑模式，修改文字、颜色、隐藏、删除、顺序。
// 每个操作都先经过校验进入草稿，点「完成」时合成一个 source 为 user 的版本，提示条上可以撤销；
// 点「取消」全部放弃；预览里长按无效。

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
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files: new FakeFiles(), registry, locale: 'zh' }}>
          <Stack />
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'record/[collectionId]': RecordRoute,
  });
  return { repo, store };
}

const home = (store: WorkspaceStore) => store.getState().config!.pages[0]!;
const order = (store: WorkspaceStore) =>
  home(store).components.map((c) =>
    c.type === 'group' ? `${c.id}[${c.children.map((x) => x.id).join(',')}]` : c.id,
  );

/** 用 store 直接准备页面，等新版本渲染出来。 */
async function commit(store: WorkspaceStore, ops: Op[], summary: string) {
  expect((await store.getState().proposeOps(ops, summary)).kind).toBe('preview');
  await store.getState().confirm();
  expect(await screen.findByText(`已改好：${summary}`)).toBeTruthy();
}

/** 长按：进入编辑模式并打开组件的操作面板。 */
async function longPress(testID: string) {
  await fireEvent(await screen.findByTestId(testID), 'longPress');
  expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
  expect(screen.getByTestId('arrange-bar')).toBeTruthy();
}

/** 编辑模式里点组件打开它的操作面板。 */
async function tapInEditor(id: string) {
  await fireEvent.press(await screen.findByTestId(`arrange-edit-${id}`));
  expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
}

/** 「完成」：草稿保存为一个版本。 */
async function done(store: WorkspaceStore, summary: string) {
  await fireEvent.press(screen.getByTestId('arrange-done'));
  expect(await screen.findByText(`已改好：${summary}`)).toBeTruthy();
  expect(store.getState().editing).toBeNull();
  expect(store.getState().head).toMatchObject({ source: 'user', summary });
}

const draftHome = (store: WorkspaceStore) => store.getState().editing!.config.pages[0]!;

/** 撤销最近一次修改（提示条上的「撤销」）。 */
async function undo(store: WorkspaceStore) {
  await fireEvent.press(await screen.findByText('撤销'));
  expect(store.getState().head).toMatchObject({ source: 'restore', summary: '撤销' });
}

function pressInNextAlert(label: string) {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

describe('editing the page directly', () => {
  // 入口暂时关掉了（D-190）；编辑功能本身还在，这里打开入口继续测它。
  beforeAll(() => {
    directEditEntry.enabled = true;
  });
  afterAll(() => {
    directEditEntry.enabled = false;
  });

  afterEach(() => jest.restoreAllMocks());

  it('long-press enters edit mode; edits stay a draft until Done saves one version', async () => {
    const { store, repo } = await renderApp();
    const headId = store.getState().head!.id;
    await longPress('component-welcome');
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-title'), '  家庭账本 ');
    await fireEvent.changeText(screen.getByTestId('edit-field-subtitle'), '');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByText('家庭账本')).toBeTruthy();
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(draftHome(store).components[0]!.props).toEqual({ title: '家庭账本' });

    // 外观：面板保持打开，可以连续试。
    await tapInEditor('catalog');
    await fireEvent.press(screen.getByTestId('edit-tone-primary'));
    expect(screen.getByTestId('edit-tone-primary')).toBeSelected();
    await fireEvent.press(screen.getByTestId('edit-close'));

    // 还没保存：没有新版本。
    expect(store.getState().head!.id).toBe(headId);
    expect(home(store).components[0]!.props).toMatchObject({ title: '我的工作台' });

    await done(store, '编辑「首页」（2 处修改）');
    expect(store.getState().head!.id).toBe(headId + 1);
    expect(home(store).components[0]!.props).toEqual({ title: '家庭账本' });
    expect(home(store).components[1]!.style).toEqual({ tone: 'primary' });
    expect(await screen.findByTestId('component-welcome')).toBeTruthy();
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'committed' });

    // 一次撤销回到编辑之前。
    await undo(store);
    expect(await screen.findByText('我的工作台')).toBeTruthy();
    expect(home(store).components[1]!.style).toBeUndefined();
  });

  it('a required text cannot be emptied; Cancel without changes just leaves edit mode', async () => {
    const { store } = await renderApp();
    const headId = store.getState().head!.id;
    await longPress('component-welcome');
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-title'), '   ');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(screen.getByText('不能为空')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-text-cancel'));
    await fireEvent.press(screen.getByTestId('edit-close'));
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('arrange-cancel'));
    expect(screen.queryByTestId('arrange-bar')).toBeNull();
    expect(store.getState().head!.id).toBe(headId);
  });

  it('several look changes on one part become a single change', async () => {
    const { store } = await renderApp();
    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-tone-primary'));
    await fireEvent.press(screen.getByTestId('edit-align-center'));
    await fireEvent.press(screen.getByTestId('edit-size-large'));
    await fireEvent.press(screen.getByTestId('edit-tone-default'));
    expect(screen.getByTestId('edit-tone-default')).toBeSelected();
    await fireEvent.press(screen.getByTestId('edit-close'));
    expect(store.getState().editing!.ops).toHaveLength(1);
    await done(store, '编辑「首页」（1 处修改）');
    expect(home(store).components[1]!.style).toEqual({ align: 'center', size: 'large' });
  });

  it('hides a part; it stays visible in edit mode and can be shown again', async () => {
    const { store } = await renderApp();
    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-hide'));
    expect(screen.getByTestId('arrange-catalog')).toBeTruthy();
    expect(screen.getByText('已隐藏')).toBeTruthy();
    await done(store, '编辑「首页」（1 处修改）');
    expect(screen.queryByTestId('component-catalog')).toBeNull();

    // 「编辑」开关进入编辑模式，重新显示。
    await fireEvent.press(screen.getByTestId('page-edit'));
    await tapInEditor('catalog');
    await fireEvent.press(screen.getByTestId('edit-hide'));
    await done(store, '编辑「首页」（1 处修改）');
    expect(await screen.findByTestId('component-catalog')).toBeTruthy();
  });

  it('deletes only after confirming; Cancel discards the whole draft', async () => {
    const { store } = await renderApp();
    const headId = store.getState().head!.id;
    pressInNextAlert('取消');
    await longPress('component-recent-files');
    await fireEvent.press(screen.getByTestId('edit-delete'));
    expect(screen.getByTestId('arrange-recent-files')).toBeTruthy();

    pressInNextAlert('删除');
    await fireEvent.press(screen.getByTestId('edit-delete'));
    expect(screen.queryByTestId('arrange-recent-files')).toBeNull();
    expect(store.getState().head!.id).toBe(headId);

    // 取消编辑：确认后放弃草稿，什么都没改。
    pressInNextAlert('放弃');
    await fireEvent.press(screen.getByTestId('arrange-cancel'));
    expect(await screen.findByTestId('component-recent-files')).toBeTruthy();
    expect(store.getState().editing).toBeNull();
    expect(store.getState().head!.id).toBe(headId);

    pressInNextAlert('删除');
    await longPress('component-recent-files');
    await fireEvent.press(screen.getByTestId('edit-delete'));
    await done(store, '编辑「首页」（1 处修改）');
    expect(order(store)).toEqual(['welcome', 'catalog']);
    await undo(store);
    expect(await screen.findByTestId('component-recent-files')).toBeTruthy();
  });

  it('reorders with the arrows, into and out of a group, saved as one version', async () => {
    const { store } = await renderApp();
    await commit(
      store,
      [
        {
          op: 'addComponent',
          pageId: 'home',
          index: 1,
          component: {
            id: 'row',
            type: 'group',
            props: { layout: 'row' },
            children: [{ id: 'go', type: 'divider', props: {} }],
          },
        },
      ],
      '分组',
    );
    const headId = store.getState().head!.id;
    await fireEvent.press(screen.getByTestId('page-edit'));
    expect(await screen.findByTestId('arrange-bar')).toBeTruthy();
    expect(screen.getByTestId('arrange-up-welcome')).toBeDisabled();
    // 编辑模式下导航栏和浮动按钮隐藏，不会切走丢掉草稿。
    expect(screen.queryByTestId('nav-ai')).toBeNull();
    expect(screen.queryByTestId('page-edit')).toBeNull();

    const draftOrder = () =>
      draftHome(store).components.map((c) =>
        c.type === 'group' ? `${c.id}[${c.children.map((x) => x.id).join(',')}]` : c.id,
      );
    const step = async (testID: string, expected: string[]) => {
      await fireEvent.press(await screen.findByTestId(testID));
      expect(draftOrder()).toEqual(expected);
    };
    await step('arrange-up-catalog', ['welcome', 'row[go,catalog]', 'recent-files']);
    await step('arrange-up-catalog', ['welcome', 'row[catalog,go]', 'recent-files']);
    await step('arrange-up-catalog', ['welcome', 'catalog', 'row[go]', 'recent-files']);
    await step('arrange-down-go', ['welcome', 'catalog', 'row[]', 'go', 'recent-files']);
    expect(store.getState().head!.id).toBe(headId);
    // 连续移动同一个组件只算一处修改。
    await done(store, '编辑「首页」（2 处修改）');
    expect(store.getState().head!.id).toBe(headId + 1);
    expect(order(store)).toEqual(['welcome', 'catalog', 'row[]', 'go', 'recent-files']);
    expect(screen.getByTestId('nav-ai')).toBeTruthy();

    await undo(store);
    expect(order(store)).toEqual(['welcome', 'row[go]', 'catalog', 'recent-files']);
  });

  it('the long-press menu also moves a part up and down', async () => {
    const { store } = await renderApp();
    await longPress('component-recent-files');
    expect(screen.getByTestId('edit-down')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('edit-up'));
    await done(store, '编辑「首页」（1 处修改）');
    expect(order(store)).toEqual(['welcome', 'recent-files', 'catalog']);
  });

  it('data components: no text editing; color and deleting keep the records', async () => {
    const { store, repo } = await renderApp();
    await commit(store, templateOps('todo', store.getState().config!, 'zh'), '添加待办');
    const page = store.getState().config!.pages.find((p) => p.id !== 'home')!;
    const list = page.components.find((c) => c.type === 'recordList')!;
    const collectionId = store.getState().config!.collections[0]!.id;
    await repo.insertRecord({
      id: 'r1',
      collectionId,
      values: { title: '买牛奶' },
      createdAt: 1,
      updatedAt: 1,
    });

    await fireEvent.press(await screen.findByText('待办'));
    await longPress(`component-${list.id}`);
    expect(screen.queryByTestId('edit-text')).toBeNull();
    expect(screen.queryByTestId('edit-align-center')).toBeNull();
    await fireEvent.press(screen.getByTestId('edit-tone-secondary'));
    pressInNextAlert('删除');
    await fireEvent.press(screen.getByTestId('edit-delete'));
    expect(Alert.alert).toHaveBeenCalledWith(
      expect.stringContaining('记录列表'),
      expect.stringContaining('记录不会被删除'),
      expect.anything(),
    );
    await done(store, `编辑「${page.title}」（2 处修改）`);
    expect(screen.queryByTestId(`component-${list.id}`)).toBeNull();
    expect(await repo.listRecords(collectionId)).toHaveLength(1);
  });

  it('separate pages: the header Edit button; Back is hidden while editing', async () => {
    const { store } = await renderApp();
    await commit(
      store,
      [
        { op: 'addPage', page: { id: 'notes', title: '笔记', components: [] } },
        {
          op: 'addComponent',
          pageId: 'notes',
          component: { id: 'a', type: 'header', props: { title: '第一' } },
        },
        {
          op: 'addComponent',
          pageId: 'notes',
          component: { id: 'b', type: 'text', props: { text: '第二' } },
        },
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'open-notes',
            type: 'button',
            props: { label: '打开笔记', target: 'page:notes', variant: 'filled' },
          },
        },
      ],
      '笔记页',
    );
    await fireEvent.press(await screen.findByText('打开笔记'));
    await fireEvent.press(await screen.findByTestId('page-edit'));
    expect(screen.queryByTestId('page-edit')).toBeNull();
    await fireEvent.press(await screen.findByTestId('arrange-down-a'));
    await tapInEditor('b');
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-text'), '**改好了**');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await done(store, '编辑「笔记」（2 处修改）');
    const notes = store.getState().config!.pages.find((p) => p.id === 'notes')!;
    expect(notes.components.map((c) => c.id)).toEqual(['b', 'a']);
    expect(await screen.findByText('改好了')).toBeTruthy();
    expect(screen.getByTestId('page-edit')).toBeTruthy();
  });

  it('long-pressing a button opens the menu instead of following the button', async () => {
    const { store } = await renderApp();
    await commit(
      store,
      [
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'go-tools',
            type: 'button',
            props: { label: '去工具', target: 'tools', variant: 'filled' },
          },
        },
      ],
      '按钮',
    );
    await fireEvent(await screen.findByText('去工具'), 'longPress');
    expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
    expect(store.getState().tab).toBeNull();
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-label'), '打开工具');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await done(store, '编辑「首页」（1 处修改）');
    expect(await screen.findByText('打开工具')).toBeTruthy();
  });

  it('a draft is limited to one change request; invalid edits are refused', async () => {
    const { store } = await renderApp();
    store.getState().startEditing('home');
    expect(
      store
        .getState()
        .editOps([
          { op: 'setComponentProps', pageId: 'home', componentId: 'welcome', props: { title: '' } },
        ]),
    ).toMatchObject({ ok: false, issues: expect.any(Array) });
    expect(store.getState().editing!.ops).toHaveLength(0);
    const toggle = (componentId: string, hidden: boolean) =>
      store.getState().editOps([{ op: 'setComponentHidden', pageId: 'home', componentId, hidden }]);
    for (let i = 0; i < 15; i++) {
      expect(toggle('welcome', i % 2 === 0)).toEqual({ ok: true });
      expect(toggle('catalog', i % 2 === 0)).toEqual({ ok: true });
    }
    expect(store.getState().editing!.ops).toHaveLength(30);
    expect(toggle('welcome', true)).toEqual({ ok: false, full: true });
    expect(store.getState().editing!.ops).toHaveLength(30);
  });

  it('long-press and the Edit button do nothing in a draft (D-190)', async () => {
    const { store } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '首页改成文件工作台');
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('draft-bar')).toBeTruthy();
    expect(screen.queryByTestId('page-edit')).toBeNull();
    const headId = store.getState().head!.id;
    await fireEvent(screen.getByTestId('component-welcome'), 'longPress');
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(store.getState().editing).toBeNull();
    expect(store.getState().head!.id).toBe(headId);
  });
});
