import { BUILTIN_TOOLS, createMockAIProvider, createRegistry } from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import AISettingsRoute from '../app/ai-settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 在真实路由和渲染器上走一遍用户旅程（数据存储换成内存实现）。

const registry = createRegistry(BUILTIN_TOOLS);

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

async function renderApp(repo = new MemoryWorkspaceRepo(), files = new FakeFiles()) {
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
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
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
          <Stack />
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'ai-settings': AISettingsRoute,
  });
  return { repo, store, files, aiSettings };
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

  it('B: install PDF, merge two real PDFs, uninstall — the files stay', async () => {
    const { repo, files } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('install-pdf'));

    // 从首页的工具入口打开同一个 App 里的 PDF 工具页。
    await fireEvent.press(await screen.findByTestId('nav-page:home'));
    await fireEvent.press((await screen.findAllByText('PDF'))[0]!);
    expect(await screen.findByTestId('step-name')).toBeTruthy();

    files.nextPick = [
      files.offer('报告.pdf', await makePdf(1)),
      files.offer('附录.pdf', await makePdf(2)),
    ];
    await fireEvent.press(screen.getByTestId('run-pdf-merge'));
    // “输入文件名”步骤：确认建议的名字。
    expect(await screen.findByDisplayValue('报告-合并')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByText('已保存「报告-合并.pdf」（3 页）')).toBeTruthy();
    expect(await screen.findByTestId('file-报告-合并.pdf')).toBeTruthy();

    // 卸载工具：入口和页面消失，文件全部保留，授权被撤销。
    const merged = (await repo.listAssets())[0]!;
    await testRouter.back();
    await fireEvent.press(await screen.findByTestId('nav-tools'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('uninstall-pdf'));
    await fireEvent.press(await screen.findByTestId('nav-page:home'));
    expect(screen.queryByTestId('component-card-pdf')).toBeNull();
    expect(await screen.findByTestId('file-报告-合并.pdf')).toBeTruthy();
    expect((await repo.listAssets()).map((a) => a.name)).toEqual([
      '报告-合并.pdf',
      '附录.pdf',
      '报告.pdf',
    ]);
    expect(await repo.hasGrant('pdf', merged.id)).toBe(false);
  });

  it('C: reshape the installed PDF tool through AI from its own page; the new flow runs', async () => {
    const { store, files } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('install-pdf'));
    await fireEvent.press(await screen.findByTestId('open-pdf'));
    expect(await screen.findByTestId('step-name')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('page-ai'));
    await fireEvent.changeText(
      await screen.findByTestId('change-input'),
      '把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名',
    );
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByText(/去掉步骤「输入文件名」/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('change-apply'));

    // 回到同一个工具页：命名步骤和说明文字消失，仍然只有一个工具实例。
    expect(await screen.findByTestId('step-select')).toBeTruthy();
    expect(screen.queryByTestId('step-name')).toBeNull();
    expect(screen.queryByTestId('component-pdf-intro')).toBeNull();
    expect(store.getState().config!.tools).toHaveLength(1);
    expect(store.getState().config!.workflows).toHaveLength(1);

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];
    await fireEvent.press(screen.getByTestId('run-pdf-merge'));
    expect(await screen.findByText(/^已保存「合并-\d{4}-\d{2}-\d{2}\.pdf」（2 页）$/)).toBeTruthy();
    expect(screen.queryByTestId('prompt-input')).toBeNull();
  });

  it('Settings → AI: switch to my own key; bad keys are refused, good keys are kept on device', async () => {
    const { aiSettings } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-settings'));
    await fireEvent.press(await screen.findByText('内置规则（离线 mock）'));
    await fireEvent.press(await screen.findByTestId('ai-mode-byok'));

    await fireEvent.changeText(await screen.findByTestId('api-key-input'), 'not-a-key');
    await fireEvent.press(screen.getByTestId('api-key-save'));
    expect(await screen.findByText(/应以 sk-ant- 开头/)).toBeTruthy();

    await fireEvent.changeText(
      screen.getByTestId('api-key-input'),
      `sk-ant-api03-${'k'.repeat(40)}9a1z`,
    );
    await fireEvent.press(screen.getByTestId('api-key-save'));
    expect(await screen.findByText('已保存（末四位 9a1z）')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('model-claude-haiku-5-5'));
    expect(aiSettings.getState()).toMatchObject({
      mode: 'byok',
      model: 'claude-haiku-5-5',
      keyHint: '9a1z',
    });
  });
});
