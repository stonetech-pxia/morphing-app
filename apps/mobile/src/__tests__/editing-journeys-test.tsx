import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';
import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  type KnownComponent,
  type Op,
  quickActionsOf,
  templateOps,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
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

// 单组件编辑的工具栏量到位置后才显示；替身直接给一个位置（真机上由原生回调）。
beforeEach(() => {
  jest
    .requireActual('@react-native/jest-preset/jest/MockNativeMethods')
    .default.measureLayout.mockImplementation(
      (_to: unknown, success: (x: number, y: number, w: number, h: number) => void) =>
        success(20, 100, 320, 40),
    );
});

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
  });
  return { repo, store };
}

const home = (store: WorkspaceStore) => store.getState().config!.containers.pages[0]!;
const order = (store: WorkspaceStore) =>
  home(store).blocks.map((c) =>
    c.look === 'group' ? `${c.id}[${c.children.map((x) => x.id).join(',')}]` : c.id,
  );

/** 用 store 直接准备页面，等新版本渲染出来。 */
async function commit(store: WorkspaceStore, ops: Op[], summary: string) {
  expect((await store.getState().proposeOps(ops, summary)).kind).toBe('preview');
  await store.getState().confirm();
  expect(await screen.findByText(`已改好：${summary}`)).toBeTruthy();
}

/** 保留的整页编辑入口：打开编辑模式和组件操作面板。 */
async function longPress(testID: string) {
  const id = testID.replace('component-', '');
  await fireEvent.press(await screen.findByTestId('page-edit'));
  await fireEvent.press(await screen.findByTestId(`arrange-edit-${id}`));
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

const draftHome = (store: WorkspaceStore) => store.getState().editing!.config.containers.pages[0]!;
const draftHomeOrHome = (store: WorkspaceStore) =>
  store.getState().editing?.config.containers.pages[0] ?? home(store);

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
  // 整页编辑入口继续关闭（D-235）；这里单独打开它，保留旧视图的回归测试。
  beforeAll(() => {
    directEditEntry.pageButton = true;
  });
  afterAll(() => {
    directEditEntry.pageButton = false;
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
    expect((draftHome(store).blocks[0]! as { show: object }).show).toEqual({
      title: '家庭账本',
    });

    // 外观：面板保持打开，可以连续试。
    await tapInEditor('catalog');
    await fireEvent.press(screen.getByTestId('edit-tone-primary'));
    expect(screen.getByTestId('edit-tone-primary')).toBeSelected();
    await fireEvent.press(screen.getByTestId('edit-close'));

    // 还没保存：没有新版本。
    expect(store.getState().head!.id).toBe(headId);
    expect((home(store).blocks[0]! as { show: object }).show).toMatchObject({
      title: '我的工作台',
    });

    await done(store, '编辑「首页」（2 处修改）');
    expect(store.getState().head!.id).toBe(headId + 1);
    expect((home(store).blocks[0]! as { show: object }).show).toEqual({ title: '家庭账本' });
    expect((home(store).blocks[1]! as KnownComponent).style).toEqual({ tone: 'primary' });
    expect(await screen.findByTestId('component-welcome')).toBeTruthy();
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'committed' });

    // 一次撤销回到编辑之前。
    await undo(store);
    expect(await screen.findByText('我的工作台')).toBeTruthy();
    expect((home(store).blocks[1]! as KnownComponent).style).toBeUndefined();
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
    expect((home(store).blocks[1]! as KnownComponent).style).toEqual({
      align: 'center',
      size: 'large',
    });
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
          op: 'addContainer',
          page: 'home',
          index: 1,
          block: {
            id: 'row',
            look: 'group',
            show: { layout: 'row' },
            children: [{ id: 'go', look: 'divider' }],
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
      draftHome(store).blocks.map((c) =>
        c.look === 'group' ? `${c.id}[${c.children.map((x) => x.id).join(',')}]` : c.id,
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
    const page = store.getState().config!.containers.pages.find((p) => p.id !== 'home')!;
    const list = page.blocks.find((c) => c.look === 'checklist')!;
    const collectionId = store.getState().config!.data.tables[0]!.id;
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
        { op: 'addContainer', page: { id: 'notes', title: '笔记', blocks: [] } },
        {
          op: 'addContainer',
          page: 'notes',
          block: { id: 'a', look: 'header', show: { title: '第一' } },
        },
        {
          op: 'addContainer',
          page: 'notes',
          block: { id: 'b', look: 'text', show: { text: '第二' } },
        },
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'open-notes',
            look: 'button',
            show: { label: '打开笔记', variant: 'filled' },
            opens: 'page:notes',
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
    const notes = store.getState().config!.containers.pages.find((p) => p.id === 'notes')!;
    expect(notes.blocks.map((c) => c.id)).toEqual(['b', 'a']);
    expect(await screen.findByText('改好了')).toBeTruthy();
    expect(screen.getByTestId('page-edit')).toBeTruthy();
  });

  it('long-pressing a button opens the menu instead of following the button', async () => {
    const { store } = await renderApp();
    await commit(
      store,
      [
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'go-tools',
            look: 'button',
            show: { label: '去工具', variant: 'filled' },
            opens: 'tools',
          },
        },
      ],
      '按钮',
    );
    await fireEvent(await screen.findByText('去工具'), 'longPress');
    expect(await screen.findByTestId('single-toolbar-go-tools')).toBeTruthy();
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(store.getState().tab).toBeNull();
    await fireEvent.press(screen.getByTestId('single-edit-go-tools'));
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-label'), '打开工具');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await fireEvent.press(screen.getByTestId('single-done-go-tools'));
    expect(await screen.findByText('已改好：编辑「首页」（1 处修改）')).toBeTruthy();
    expect(await screen.findByText('打开工具')).toBeTruthy();
  });

  it('a draft is limited to one change request; invalid edits are refused', async () => {
    const { store } = await renderApp();
    store.getState().startEditing('home');
    expect(
      store.getState().editOps([
        {
          op: 'updateContainer',
          page: 'home',
          block: 'welcome',
          changes: { show: { title: '' } },
        },
      ]),
    ).toMatchObject({ ok: false, issues: expect.any(Array) });
    expect(store.getState().editing!.ops).toHaveLength(0);
    const toggle = (componentId: string, hidden: boolean) =>
      store
        .getState()
        .editOps([
          { op: 'updateContainer', page: 'home', block: componentId, changes: { hidden } },
        ]);
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

describe('single-component editing', () => {
  it('long-press selects only that component, blocks normal actions and saves one undoable version', async () => {
    const { store } = await renderApp();
    const before = store.getState().head!.id;
    expect(screen.queryByTestId('page-edit')).toBeNull();
    await fireEvent(screen.getByTestId('component-welcome'), 'longPress');
    expect(await screen.findByTestId('single-toolbar-welcome')).toBeTruthy();
    expect(screen.queryByTestId('arrange-bar')).toBeNull();
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(store.getState().editing).toMatchObject({ mode: 'single', ops: [] });
    await fireEvent.press(screen.getByText('添加工具'));
    expect(store.getState().tab).toBeNull();
    await fireEvent.press(screen.getByTestId('single-edit-welcome'));
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-title'), '新工作台');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(screen.getByTestId('single-toolbar-welcome')).toBeTruthy();
    expect(store.getState().head!.id).toBe(before);
    // 换一个组件时沿用同一份草稿。
    await fireEvent(screen.getByTestId('component-catalog'), 'longPress');
    expect(screen.getByTestId('single-toolbar-catalog')).toBeTruthy();
    expect(screen.queryByTestId('single-toolbar-welcome')).toBeNull();
    await fireEvent.press(screen.getByTestId('single-edit-catalog'));
    await fireEvent.press(screen.getByTestId('edit-tone-primary'));
    await fireEvent.press(screen.getByTestId('edit-close'));
    await fireEvent.press(screen.getByTestId('single-done-catalog'));
    expect(await screen.findByText('已改好：编辑「首页」（2 处修改）')).toBeTruthy();
    expect(store.getState().head!.id).toBe(before + 1);
    expect(store.getState().editing).toBeNull();
    await undo(store);
    expect((home(store).blocks[0]! as { show: object }).show).toMatchObject({
      title: '我的工作台',
    });
    expect((home(store).blocks[1]! as KnownComponent).style).toBeUndefined();
  });

  it('keeps a selected group opaque and dims other groups only once', async () => {
    const { store } = await renderApp();
    await commit(
      store,
      [
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'group',
            look: 'group',
            show: { layout: 'stack', title: '分组' },
            children: [{ id: 'child', look: 'text', show: { text: '组里的文字' } }],
          },
        },
      ],
      '分组',
    );
    await fireEvent(screen.getByTestId('component-group'), 'longPress');
    expect(screen.getByTestId('single-content-child')).toHaveStyle({ opacity: 1 });
    await fireEvent(screen.getByTestId('component-welcome'), 'longPress');
    expect(screen.getByTestId('single-content-group')).toHaveStyle({ opacity: 0.5 });
    expect(screen.getByTestId('single-content-child')).toHaveStyle({ opacity: 1 });
    await fireEvent.press(screen.getByTestId('single-done-welcome'));
  });

  it('finishing an unchanged selection on blank space creates no version', async () => {
    const { store } = await renderApp();
    const before = store.getState().head!.id;
    await fireEvent(screen.getByTestId('component-welcome'), 'longPress');
    expect(await screen.findByTestId('single-toolbar-welcome')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('single-blank'));
    expect(store.getState().editing).toBeNull();
    expect(store.getState().head!.id).toBe(before);
  });

  it('hiding the selected component still leaves Edit and Done on screen', async () => {
    const { store } = await renderApp();
    await fireEvent(screen.getByTestId('component-welcome'), 'longPress');
    await fireEvent.press(await screen.findByTestId('single-edit-welcome'));
    await fireEvent.press(screen.getByTestId('edit-hide'));
    expect(screen.queryByTestId('component-welcome')).toBeNull();
    // 组件不在页面上了，工具栏固定在可见区域顶部；还能打开面板把它显示回来。
    await fireEvent.press(screen.getByTestId('single-edit-welcome'));
    expect(screen.getByTestId('edit-hide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-close'));
    await fireEvent.press(screen.getByTestId('single-done-welcome'));
    expect(await screen.findByText('已改好：编辑「首页」（1 处修改）')).toBeTruthy();
    expect(home(store).blocks.find((c) => c.id === 'welcome')!.hidden).toBe(true);
  });
});

async function gestureAct(callback: () => void) {
  await act(async () => {
    callback();
    jest.runAllTicks();
  });
}

describe('single-component gesture sessions', () => {
  beforeEach(() => {
    // 真实原生测量返回窗口坐标；替身也保留各组件不同的位置和尺寸。
    const methods = jest.requireActual('@react-native/jest-preset/jest/MockNativeMethods').default;
    methods.measureInWindow.mockImplementation(function (
      this: { props: { testID?: string } },
      callback: (x: number, y: number, w: number, h: number) => void,
    ) {
      const id = this.props.testID;
      const y = id === 'single-frame-welcome' ? 100 : id === 'single-frame-catalog' ? 220 : 340;
      if (id?.startsWith('single-frame-')) callback(20, y, 320, 90);
      else callback(0, 0, 360, 600);
    });
  });
  afterEach(() => {
    jest
      .requireActual('@react-native/jest-preset/jest/MockNativeMethods')
      .default.measureInWindow.mockReset();
  });

  it('selects and moves on the same touch, keeps selection, then saves one undoable version', async () => {
    const { store } = await renderApp();
    const before = store.getState().head!.id;
    const gesture = createGestureController('single-drag-welcome');
    await gestureAct(() => {
      gesture.begin({ absoluteX: 100, absoluteY: 140 });
      gesture.activate({ absoluteX: 100, absoluteY: 140 });
    });
    expect(screen.getByTestId('single-toolbar-welcome')).toBeTruthy();
    await gestureAct(() => gesture.update({ absoluteX: 100, absoluteY: 420, translationY: 280 }));
    expect(screen.getByTestId('single-drop-line')).toBeTruthy();
    await gestureAct(() => gesture.end());
    expect(draftHome(store).blocks.map((c) => c.id)).toEqual([
      'catalog',
      'recent-files',
      'welcome',
    ]);
    expect(screen.getByTestId('single-toolbar-welcome')).toBeTruthy();
    expect(store.getState().head!.id).toBe(before);
    await fireEvent.press(screen.getByTestId('single-done-welcome'));
    expect(await screen.findByText('已改好：编辑「首页」（1 处修改）')).toBeTruthy();
    expect(store.getState().head!.id).toBe(before + 1);
    await undo(store);
    expect(order(store)).toEqual(['welcome', 'catalog', 'recent-files']);
  });

  it('swaps both sides of a rendered workflow grid and keeps one draft', async () => {
    const { store } = await renderApp();
    await commit(store, [{ op: 'setPackage', package: 'pdf', do: 'add' }], '准备 PDF');
    const workflows = quickActionsOf(store.getState().config!);
    await commit(
      store,
      [
        ...home(store).blocks.map((c) => ({
          op: 'removeContainer' as const,
          page: 'home',
          block: c.id,
        })),
        ...['left', 'right'].map((id, i) => ({
          op: 'addContainer' as const,
          page: 'home',
          block: {
            id,
            look: 'action' as const,
            tools: [{ tool: workflows[i]!.id }],
          },
        })),
      ],
      '宫格',
    );
    const methods = jest.requireActual('@react-native/jest-preset/jest/MockNativeMethods').default;
    methods.measureInWindow.mockImplementation(function (
      this: { props: { testID?: string } },
      callback: (x: number, y: number, w: number, h: number) => void,
    ) {
      const id = this.props.testID;
      const ids = draftHomeOrHome(store).blocks.map((c) => `single-frame-${c.id}`);
      const i = ids.indexOf(id ?? '');
      if (i >= 0) callback(20 + i * 160, 100, 140, 110);
      else callback(0, 0, 360, 600);
    });
    const gesture = createGestureController('single-drag-left');
    await gestureAct(() => {
      gesture.begin({ absoluteX: 80, absoluteY: 150 });
      gesture.activate({ absoluteX: 80, absoluteY: 150 });
    });
    await gestureAct(() => gesture.update({ absoluteX: 300, absoluteY: 150, translationX: 220 }));
    await gestureAct(() => gesture.end());
    expect(draftHome(store).blocks.map((c) => c.id)).toEqual(['right', 'left']);
    expect(screen.getByTestId('single-toolbar-left')).toBeTruthy();
    // 重排使宫格的 React 行变化，新的 detector 仍然能继续拖。
    const again = createGestureController('single-drag-left');
    await gestureAct(() => {
      again.begin({ absoluteX: 240, absoluteY: 150 });
      again.activate({ absoluteX: 240, absoluteY: 150 });
    });
    await gestureAct(() => again.update({ absoluteX: 30, absoluteY: 150, translationX: -210 }));
    await gestureAct(() => again.end());
    expect(draftHome(store).blocks.map((c) => c.id)).toEqual(['left', 'right']);
    await fireEvent.press(screen.getByTestId('single-done-left'));
    expect(store.getState().editing).toBeNull();
  });

  it('auto-scrolls only after moving and stops immediately when the gesture is cancelled', async () => {
    const { store } = await renderApp();
    const scroll = screen.getByTestId('editable-scroll');
    await fireEvent(scroll, 'contentSizeChange', 360, 1800);
    const gesture = createGestureController('single-drag-welcome');
    await gestureAct(() => {
      gesture.begin({ absoluteX: 100, absoluteY: 140 });
      gesture.activate({ absoluteX: 100, absoluteY: 140 });
    });
    await gestureAct(() => gesture.update({ absoluteX: 100, absoluteY: 590, translationY: 450 }));
    const beforeScroll = screen.getByTestId('single-drop-line').props.style[1].top;
    await act(async () => {
      jest.advanceTimersByTime(80);
      jest.runAllTicks();
    });
    expect(screen.getByTestId('single-drop-line').props.style[1].top).toBeLessThan(beforeScroll);
    await gestureAct(() => gesture.cancel());
    expect(screen.queryByTestId('single-drop-line')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(80);
    });
    expect(screen.queryByTestId('single-drop-line')).toBeNull();
    expect(store.getState().editing!.ops).toEqual([]);
    await fireEvent.press(screen.getByTestId('single-done-welcome'));
  });

  it('cancellation and dropping back in place leave the draft unchanged', async () => {
    const { store } = await renderApp();
    const gesture = createGestureController('single-drag-welcome');
    await gestureAct(() => {
      gesture.begin({ absoluteX: 100, absoluteY: 140 });
      gesture.activate({ absoluteX: 100, absoluteY: 140 });
    });
    await gestureAct(() => gesture.update({ absoluteX: 100, absoluteY: 400, translationY: 260 }));
    await gestureAct(() => gesture.cancel());
    expect(store.getState().editing!.ops).toEqual([]);
    expect(screen.queryByTestId('single-drop-line')).toBeNull();
    // 已选中后再次按住即可拖，不需要重新开草稿。
    await gestureAct(() => {
      gesture.begin({ absoluteX: 100, absoluteY: 140 });
      gesture.activate({ absoluteX: 100, absoluteY: 140 });
    });
    await gestureAct(() => gesture.update({ absoluteX: 110, absoluteY: 150, translationY: 10 }));
    await gestureAct(() => gesture.end());
    expect(store.getState().editing!.ops).toEqual([]);
    await fireEvent.press(screen.getByTestId('single-done-welcome'));
    expect(store.getState().editing).toBeNull();
  });
});

describe('quick gesture release', () => {
  it('still applies a drop when native measurements finish after the finger is lifted', async () => {
    const methods = jest.requireActual('@react-native/jest-preset/jest/MockNativeMethods').default;
    methods.measureInWindow.mockImplementation(function (
      this: { props: { testID?: string } },
      callback: (x: number, y: number, w: number, h: number) => void,
    ) {
      const id = this.props.testID;
      const y = id === 'single-frame-welcome' ? 100 : id === 'single-frame-catalog' ? 220 : 340;
      callback(
        0,
        id?.startsWith('single-frame-') ? y : 0,
        360,
        id?.startsWith('single-frame-') ? 90 : 600,
      );
    });
    try {
      const { store } = await renderApp();
      const gesture = createGestureController('single-drag-welcome');
      await gestureAct(() => {
        gesture.begin({ absoluteX: 100, absoluteY: 140 });
        gesture.activate({ absoluteX: 100, absoluteY: 140 });
        gesture.update({ absoluteX: 100, absoluteY: 420, translationY: 280 });
        gesture.end();
      });
      expect(draftHome(store).blocks.map((c) => c.id)).toEqual([
        'catalog',
        'recent-files',
        'welcome',
      ]);
      await fireEvent.press(screen.getByTestId('single-done-welcome'));
    } finally {
      methods.measureInWindow.mockReset();
    }
  });
});
