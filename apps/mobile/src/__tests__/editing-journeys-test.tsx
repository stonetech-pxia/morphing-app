import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  templateOps,
  type Op,
} from '@morph/core';
import { fireEvent, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import RecordRoute from '../app/record/[collectionId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 直接编辑（D-052）：长按组件修改文字、颜色、隐藏、删除、调整顺序。每个操作都经过校验，
// 生成 source 为 user 的新版本，提示条上可以撤销；预览里长按无效。

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
  expect(await screen.findByText(`已应用：${summary}`)).toBeTruthy();
}

async function longPress(testID: string) {
  await fireEvent(await screen.findByTestId(testID), 'longPress');
  expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
}

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
  afterEach(() => jest.restoreAllMocks());

  it('long-press → edit the title and subtitle; undo restores them', async () => {
    const { store, repo } = await renderApp();
    await longPress('component-welcome');
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-title'), '  家庭账本 ');
    await fireEvent.changeText(screen.getByTestId('edit-field-subtitle'), '');
    await fireEvent.press(screen.getByTestId('edit-save'));

    expect(await screen.findByText('家庭账本')).toBeTruthy();
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(home(store).components[0]!.props).toEqual({ title: '家庭账本' });
    expect(store.getState().head).toMatchObject({
      source: 'user',
      summary: '修改标题「我的工作台」的文字',
    });
    expect(screen.getByTestId('banner')).toHaveTextContent(/已应用：修改标题「我的工作台」的文字/);
    // 和 AI 的修改一样记录了修改请求。
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'committed' });

    await undo(store);
    expect(await screen.findByText('我的工作台')).toBeTruthy();
    expect(home(store).components[0]!.props).toMatchObject({ subtitle: expect.any(String) });
  });

  it('a required text cannot be emptied; cancelling changes nothing', async () => {
    const { store } = await renderApp();
    const headId = store.getState().head!.id;
    await longPress('component-welcome');
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-title'), '   ');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(screen.getByText('不能为空')).toBeTruthy();
    await fireEvent.press(screen.getByText('取消'));
    await fireEvent.press(screen.getByTestId('edit-close'));
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(store.getState().head!.id).toBe(headId);
  });

  it('changes color, alignment and size; choosing the default clears the setting', async () => {
    const { store } = await renderApp();
    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-tone-primary'));
    expect(home(store).components[1]!.style).toEqual({ tone: 'primary' });
    expect(store.getState().head).toMatchObject({
      source: 'user',
      summary: '调整「添加工具」入口的外观',
    });

    await longPress('component-catalog');
    expect(screen.getByTestId('edit-tone-primary')).toBeSelected();
    await fireEvent.press(screen.getByTestId('edit-align-center'));
    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-size-large'));
    expect(home(store).components[1]!.style).toEqual({
      tone: 'primary',
      align: 'center',
      size: 'large',
    });

    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-tone-default'));
    expect(home(store).components[1]!.style).toEqual({ align: 'center', size: 'large' });

    await undo(store);
    expect(home(store).components[1]!.style).toEqual({
      tone: 'primary',
      align: 'center',
      size: 'large',
    });
  });

  it('hides a component and shows it again from the reorder view', async () => {
    const { store } = await renderApp();
    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-hide'));
    expect(screen.queryByTestId('component-catalog')).toBeNull();
    expect(store.getState().head).toMatchObject({
      source: 'user',
      summary: '隐藏「添加工具」入口',
    });

    // 隐藏的组件在「调整顺序」里仍然看得到，可以重新显示。
    await longPress('component-welcome');
    await fireEvent.press(screen.getByTestId('edit-arrange'));
    expect(await screen.findByTestId('arrange-catalog')).toBeTruthy();
    expect(screen.getByText('已隐藏')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('arrange-edit-catalog'));
    await fireEvent.press(await screen.findByTestId('edit-hide'));
    expect(home(store).components[1]!.hidden).toBeUndefined();
    await fireEvent.press(await screen.findByTestId('arrange-done'));
    expect(await screen.findByTestId('component-catalog')).toBeTruthy();
  });

  it('deletes a component only after confirming; undo brings it back', async () => {
    const { store } = await renderApp();
    const headId = store.getState().head!.id;
    pressInNextAlert('取消');
    await longPress('component-recent-files');
    await fireEvent.press(screen.getByTestId('edit-delete'));
    expect(store.getState().head!.id).toBe(headId);
    expect(screen.getByTestId('component-recent-files')).toBeTruthy();

    pressInNextAlert('删除');
    await longPress('component-recent-files');
    await fireEvent.press(screen.getByTestId('edit-delete'));
    expect(screen.queryByTestId('component-recent-files')).toBeNull();
    expect(store.getState().head).toMatchObject({
      source: 'user',
      summary: '删除文件列表「最近文件」',
    });
    expect(order(store)).toEqual(['welcome', 'catalog']);

    await undo(store);
    expect(await screen.findByTestId('component-recent-files')).toBeTruthy();
  });

  it('reorders with the arrows, into and out of a group, one undoable version per move', async () => {
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
    expect(order(store)).toEqual(['welcome', 'row[go]', 'catalog', 'recent-files']);

    await longPress('component-catalog');
    await fireEvent.press(screen.getByTestId('edit-arrange'));
    expect(await screen.findByTestId('arrange-bar')).toBeTruthy();
    expect(screen.getByTestId('arrange-up-welcome')).toBeDisabled();

    const versions: number[] = [];
    const step = async (testID: string, expected: string[]) => {
      await fireEvent.press(await screen.findByTestId(testID));
      expect(order(store)).toEqual(expected);
      expect(store.getState().head).toMatchObject({ source: 'user' });
      versions.push(store.getState().head!.id);
    };
    await step('arrange-up-catalog', ['welcome', 'row[go,catalog]', 'recent-files']);
    await step('arrange-up-catalog', ['welcome', 'row[catalog,go]', 'recent-files']);
    await step('arrange-up-catalog', ['welcome', 'catalog', 'row[go]', 'recent-files']);
    await step('arrange-down-go', ['welcome', 'catalog', 'row[]', 'go', 'recent-files']);
    expect(new Set(versions).size).toBe(4);
    expect(store.getState().head).toMatchObject({ summary: '移动分隔线' });
    // 每次修改都会重新挂载外壳，「调整顺序」模式保持不变。
    expect(screen.getByTestId('arrange-bar')).toBeTruthy();

    await undo(store);
    expect(order(store)).toEqual(['welcome', 'catalog', 'row[go]', 'recent-files']);

    await fireEvent.press(screen.getByTestId('arrange-done'));
    expect(screen.queryByTestId('arrange-bar')).toBeNull();
    expect(screen.getByTestId('component-catalog')).toBeTruthy();
  });

  it('the long-press menu also moves a component up and down', async () => {
    const { store } = await renderApp();
    await longPress('component-recent-files');
    expect(screen.getByTestId('edit-down')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('edit-up'));
    expect(order(store)).toEqual(['welcome', 'recent-files', 'catalog']);
    expect(store.getState().head).toMatchObject({
      source: 'user',
      summary: '移动文件列表「最近文件」',
    });
  });

  it('data components: no text editing; color, hiding and deleting keep the records', async () => {
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
    const styled = store.getState().config!.pages.find((p) => p.id === page.id)!;
    expect(styled.components.find((c) => c.id === list.id)!.style).toEqual({ tone: 'secondary' });

    pressInNextAlert('删除');
    await longPress(`component-${list.id}`);
    await fireEvent.press(screen.getByTestId('edit-delete'));
    expect(Alert.alert).toHaveBeenCalledWith(
      expect.stringContaining('记录列表'),
      expect.stringContaining('记录不会被删除'),
      expect.anything(),
    );
    expect(screen.queryByTestId(`component-${list.id}`)).toBeNull();
    expect(await repo.listRecords(collectionId)).toHaveLength(1);
  });

  it('separate pages: the header Edit button toggles reordering', async () => {
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
    await fireEvent.press(await screen.findByTestId('arrange-down-a'));
    expect(store.getState().config!.pages[1]!.components.map((c) => c.id)).toEqual(['b', 'a']);
    expect(screen.getByTestId('page-edit')).toHaveTextContent('完成');
    await fireEvent.press(screen.getByTestId('page-edit'));
    expect(screen.queryByTestId('arrange-bar')).toBeNull();

    // 长按按钮打开操作面板，而不是打开按钮指向的页面。
    await longPress('component-b');
    await fireEvent.press(screen.getByTestId('edit-text'));
    await fireEvent.changeText(screen.getByTestId('edit-field-text'), '**改好了**');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByText('改好了')).toBeTruthy();
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
    expect(await screen.findByText('打开工具')).toBeTruthy();
  });

  it('long-press does nothing in the preview', async () => {
    const { store } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '首页改成文件工作台');
    await fireEvent.press(screen.getByTestId('change-submit'));
    const preview = await screen.findByTestId('preview');
    const headId = store.getState().head!.id;
    await fireEvent(within(preview).getByTestId('component-welcome'), 'longPress');
    expect(screen.queryByTestId('edit-sheet')).toBeNull();
    expect(store.getState().head!.id).toBe(headId);
  });
});
