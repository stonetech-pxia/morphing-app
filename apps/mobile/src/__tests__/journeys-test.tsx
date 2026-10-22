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
import RunRoute from '../app/run/[workflowId]';
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
    'run/[workflowId]': RunRoute,
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
    await fireEvent.press(screen.getByTestId('preview-before'));
    await fireEvent.press(screen.getByTestId('preview-after'));
    // 预览期间 App 本身没有变化。
    expect(store.getState().config!.shell.nav).toHaveLength(5);

    await fireEvent.press(screen.getByTestId('change-apply'));

    // 同一个 App 的首页立即变化：页面标题与导航标签都已更新，AI 和历史不在导航栏里。
    expect(await screen.findAllByText('文件工作台')).toHaveLength(2);
    expect(screen.queryByTestId('nav-ai')).toBeNull();
    expect(screen.queryByTestId('nav-history')).toBeNull();
    expect(screen.queryByTestId('floating-ai')).toBeNull();
    expect(await screen.findByTestId('banner')).toBeTruthy();

    // AI 修改和历史仍然可以从设置里打开。
    await fireEvent.press(screen.getByTestId('nav-settings'));
    expect(await screen.findByTestId('settings-ai')).toBeTruthy();
    expect(screen.getByTestId('settings-history')).toBeTruthy();

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
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect(store.getState().head!.id).toBe(1);
  });

  it('unknown requests show a clear message and no preview', async () => {
    await renderApp();
    await askAi('帮我订一张机票');
    expect(await screen.findByTestId('change-feedback')).toBeTruthy();
    expect(screen.getByText(/暂时无法理解/)).toBeTruthy();
    expect(screen.queryByTestId('change-apply')).toBeNull();
  });

  it('D: restore an earlier version from History (reachable from Settings)', async () => {
    const { store } = await renderApp();
    await askAi('导航栏只保留首页、工具、设置');
    await fireEvent.press(await screen.findByTestId('change-apply'));

    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-history'));
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
    // 运行页面打开即开始；「命名」步骤：确认建议的名字。
    expect(await screen.findByDisplayValue('报告-合并')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByText('已保存「报告-合并.pdf」（3 页）')).toBeTruthy();
    await testRouter.back();
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
    // 只有合并结果成为用户文件（D-063）。
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['报告-合并.pdf']);
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
    expect(await screen.findByText(/「命名」不再询问/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('change-apply'));

    // 回到同一个工具页：说明文字消失，命名不再询问，仍然只有一个工具实例。
    expect(await screen.findByTestId('step-select')).toBeTruthy();
    expect(screen.queryByTestId('component-pdf-intro')).toBeNull();
    expect(store.getState().config!.tools).toHaveLength(1);
    expect(store.getState().config!.workflows).toHaveLength(1);

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];
    await fireEvent.press(screen.getByTestId('run-pdf-merge'));
    expect(await screen.findByText(/^已保存「合并-\d{4}-\d{2}-\d{2}\.pdf」（2 页）$/)).toBeTruthy();
    expect(screen.queryByTestId('prompt-ok')).toBeNull();
  });

  it('AI can leave the navigation entirely; Settings still opens AI and History to undo', async () => {
    const { store } = await renderApp();
    await askAi('把 AI 入口删掉，把历史从导航栏移除');
    await fireEvent.press(await screen.findByTestId('change-apply'));
    expect(await screen.findByTestId('banner')).toBeTruthy();
    expect(screen.queryByTestId('nav-ai')).toBeNull();
    expect(screen.queryByTestId('nav-history')).toBeNull();
    expect(screen.queryByTestId('floating-ai')).toBeNull();

    // 从设置进入 AI 修改，把它们恢复回来。
    await fireEvent.press(screen.getByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '撤销刚才的修改');
    await fireEvent.press(screen.getByTestId('change-submit'));
    await fireEvent.press(await screen.findByTestId('change-apply'));
    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(store.getState().config!.shell.nav).toContain('history');
  });

  it('Settings itself cannot be removed', async () => {
    await renderApp();
    await askAi('把设置删掉');
    expect(await screen.findByText(/「设置」不能移除/)).toBeTruthy();
    expect(screen.queryByTestId('change-apply')).toBeNull();
  });

  it('a new page gets an entry (the nav bar is full, so a home shortcut) and the theme restyles', async () => {
    const { store } = await renderApp();
    await askAi('新建一个叫「记账」的页面，字体大一点，去掉阴影');
    expect(await screen.findByText(/新建页面「记账」/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('change-apply'));

    expect(await screen.findByTestId('component-shortcut-page-1')).toBeTruthy();
    await fireEvent.press(screen.getByText('记账'));
    expect(await screen.findByTestId('component-header')).toBeTruthy();
    expect(store.getState().config!.theme).toMatchObject({ fontScale: 1.15, cardStyle: 'flat' });
  });

  it('shortcuts and buttons open pages outside the nav bar, and system entries in the shell', async () => {
    const { store } = await renderApp();
    const result = await store.getState().proposeOps(
      [
        {
          op: 'addPage',
          page: {
            id: 'notes',
            title: '笔记',
            icon: 'bookmark',
            components: [
              { id: 'notes-title', type: 'header', props: { title: '笔记' } },
              {
                id: 'to-settings',
                type: 'button',
                props: { label: '打开设置', target: 'settings', variant: 'outline' },
              },
            ],
          },
        },
        {
          op: 'addComponent',
          pageId: 'home',
          index: 1,
          component: {
            id: 'quick',
            type: 'group',
            props: { layout: 'grid', columns: 2 },
            children: [
              {
                id: 'go-notes',
                type: 'shortcut',
                props: { title: '去笔记', icon: 'bookmark', target: 'page:notes' },
              },
              {
                id: 'go-history',
                type: 'shortcut',
                props: { title: '看历史', icon: 'history', target: 'history' },
              },
            ],
          },
        },
      ],
      '添加笔记页',
    );
    expect(result.kind).toBe('preview');
    await store.getState().confirm();

    // 网格里的快捷入口：笔记页不在导航栏里，推入一个新页面。
    await fireEvent.press(await screen.findByText('去笔记'));
    expect(await screen.findByTestId('component-notes-title')).toBeTruthy();
    // 页面里的按钮打开外壳里的设置。
    await fireEvent.press(screen.getByText('打开设置'));
    expect(await screen.findByTestId('settings-ai')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('nav-page:home'));
    await fireEvent.press(await screen.findByText('看历史'));
    expect(await screen.findByTestId('revision-2')).toBeTruthy();
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
