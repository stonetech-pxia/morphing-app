import { BUILTIN_TOOLS, createMockAIProvider, createRegistry } from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 在真实路由和渲染器上走一遍用户旅程（数据存储换成内存实现）。

const registry = createRegistry(BUILTIN_TOOLS);

async function renderApp(repo = new MemoryWorkspaceRepo()) {
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: 'zh',
    now: () => new Date(2026, 9, 22, 9, 0),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <WorkspaceProvider value={{ store, registry, locale: 'zh' }}>
        <Stack />
      </WorkspaceProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
  });
  return { repo, store };
}

/** 工具目录里的操作用系统确认框；测试中直接点“应用更改”。 */
function acceptNextAlert() {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
}

async function askAi(text: string) {
  await fireEvent.press(screen.getByTestId('nav-ai'));
  await fireEvent.changeText(await screen.findByTestId('change-input'), text);
  await fireEvent.press(screen.getByTestId('change-submit'));
}

describe('user journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('B + A + undo: install PDF, reshape the home page with preview, then undo', async () => {
    const { store } = await renderApp();

    // 旅程 B：在工具目录安装 PDF，首页出现入口。
    await fireEvent.press(screen.getByTestId('nav-tools'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('install-pdf'));
    await fireEvent.press(await screen.findByTestId('nav-page:home'));
    expect(await screen.findByTestId('component-card-pdf')).toBeTruthy();

    // 旅程 A：自然语言 → 计划与预览。
    await askAi('把首页改成文件工作台，导航栏只保留首页、工具、设置');
    expect(await screen.findByTestId('plan-line-0')).toBeTruthy();
    expect(screen.getAllByText(/不能删除，已改为浮动按钮/)).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('preview-before'));
    await fireEvent.press(screen.getByTestId('preview-after'));
    // 预览期间 App 本身没有变化。
    expect(store.getState().config!.shell.nav).toHaveLength(5);

    await fireEvent.press(screen.getByTestId('change-apply'));

    // 同一个 App 的首页立即变化：标题、导航、受保护入口改为浮动按钮。
    // 页面标题与导航标签都已更新。
    expect(await screen.findAllByText('文件工作台')).toHaveLength(2);
    expect(screen.queryByTestId('nav-ai')).toBeNull();
    expect(screen.getByTestId('floating-ai')).toBeTruthy();
    expect(screen.getByTestId('floating-history')).toBeTruthy();
    expect(await screen.findByTestId('banner')).toBeTruthy();

    // 应用后可撤销。
    await fireEvent.press(screen.getByText('撤销'));
    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(store.getState().head).toMatchObject({ source: 'restore' });
  });

  it('cancel keeps the app unchanged', async () => {
    const { store } = await renderApp();
    await askAi('主题换成绿色');
    await fireEvent.press(await screen.findByTestId('change-cancel'));
    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(store.getState().config!.theme.primaryColor).toBe('#3B5BDB');
    expect(store.getState().head!.id).toBe(1);
  });

  it('unknown requests show a clear message and no preview', async () => {
    await renderApp();
    await askAi('帮我订一张机票');
    expect(await screen.findByTestId('change-feedback')).toBeTruthy();
    expect(screen.getByText(/暂时无法理解/)).toBeTruthy();
    expect(screen.queryByTestId('change-apply')).toBeNull();
  });

  it('D: restore an earlier version from History (reachable as a floating button)', async () => {
    const { store } = await renderApp();
    await askAi('导航栏只保留首页、工具、设置');
    await fireEvent.press(await screen.findByTestId('change-apply'));

    await fireEvent.press(await screen.findByTestId('floating-history'));
    await fireEvent.press(await screen.findByTestId('restore-1'));
    expect(await screen.findByText(/你的文件不受影响/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('change-apply'));

    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(store.getState().head).toMatchObject({ id: 3, source: 'restore' });
  });
});
