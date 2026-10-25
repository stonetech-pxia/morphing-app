import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  BUILTIN_TOOLS,
  THEME_PRESETS,
  createMockAIProvider,
  createRegistry,
  type AIProvider,
} from '@morph/core';
import { act, fireEvent, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { DraftChatSheet } from '../draft/DraftBar';
import { useDraftUi } from '../draft/ui';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import AISettingsRoute from '../app/ai-settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import ReadyRoute from '../app/ready/[workflowId]';
import RunRoute from '../app/run/[workflowId]';
import WorkflowsRoute from '../app/workflows';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';
import { APPLIED_BANNER_MS } from '../shell/Shell';
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

async function renderApp(
  repo = new MemoryWorkspaceRepo(),
  files = new FakeFiles(),
  provider: AIProvider = createMockAIProvider(),
) {
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider,
    registry,
    locale: 'zh',
    now: () => new Date(2026, 9, 22, 9, 0),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack />
          </GestureHandlerRootView>
          <DraftChatSheet />
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
    'ai-settings': AISettingsRoute,
    'run/[workflowId]': RunRoute,
    workflows: WorkflowsRoute,
    'ready/[workflowId]': ReadyRoute,
  });
  return { repo, store, files, aiSettings };
}

/** 卸载工具要在系统确认框里确认；测试中直接点“应用更改”。其他工具操作直接应用。 */
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

/** 草稿模式（D-190）底部的「应用」。 */
async function applyDraft() {
  await fireEvent.press(await screen.findByTestId('draft-apply'));
}

describe('user journeys (UI)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useDraftUi.setState({ chatOpen: false, seenStep: null });
  });

  it('B + A + undo: install PDF, reshape the home page in a draft, apply, then undo', async () => {
    const { store } = await renderApp();

    // 旅程 B：在工具目录安装 PDF，首页出现入口。
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-pdf'));
    await fireEvent.press(await screen.findByTestId('nav-page:home'));
    expect(await screen.findByTestId('component-card-pdf')).toBeTruthy();

    // 旅程 A：自然语言 → 直接进入草稿模式（D-190）：App 显示改完后的样子，已保存的版本没变。
    await askAi('把首页改成文件工作台，导航栏只保留首页、工具、设置');
    expect(await screen.findByTestId('draft-bar')).toBeTruthy();
    expect(screen.getAllByText('文件工作台').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('nav-ai')).toBeNull();
    expect(store.getState().config!.shell.nav).toHaveLength(5);
    expect(screen.getByTestId('draft-reply')).toHaveTextContent(/改好了/);

    await applyDraft();

    // 同一个 App 的首页立即变化：页面标题与导航标签都已更新，AI 和历史不在导航栏里。
    expect(await screen.findAllByText('文件工作台')).toHaveLength(2);
    expect(screen.queryByTestId('draft-bar')).toBeNull();
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

  it('the applied banner goes away by itself; warnings stay (D-106)', async () => {
    const { store } = await renderApp();
    await askAi('主题换成绿色');
    jest.useFakeTimers();
    try {
      await applyDraft();
      expect(await screen.findByTestId('banner')).toBeTruthy();
      await act(() => jest.advanceTimersByTime(APPLIED_BANNER_MS));
      expect(screen.queryByTestId('banner')).toBeNull();
      await act(() => store.setState({ banner: { kind: 'rolledBack', message: '已回退' } }));
      await act(() => jest.advanceTimersByTime(APPLIED_BANNER_MS * 2));
      expect(screen.getByTestId('banner')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a new workflow is made right away and goes on the home page; “ready” comes first', async () => {
    const { store } = await renderApp();
    // 从设置页打开 AI 修改。快捷操作是功能，不进草稿，直接做好（D-191）。
    await fireEvent.press(screen.getByTestId('nav-settings'));
    await askAi('添加签证照片工作流');
    // 先看到「做好了」（D-125），说明首页上也有入口；「先不用」回到首页，运行卡片就在标题下面。
    expect(await screen.findByTestId('ready-screen')).toHaveTextContent(/首页上也放了入口/);
    expect(screen.getByTestId('ready-name')).toHaveTextContent(/签证 \/ 证件照/);
    // 「做好了」页面上也有「已改好 · 撤销」（不然提示条在下面的 App 里自己消失了）。
    expect(
      await within(screen.getByTestId('ready-screen')).findByTestId('banner'),
    ).toHaveTextContent(/撤销/);
    expect(store.getState().draft).toBeNull();
    expect(store.getState().tab).toBe('page:home');
    const id = store.getState().config!.workflows[0]!.id;
    await fireEvent.press(screen.getByTestId('ready-later'));
    expect(await screen.findByTestId(`run-${id}`)).toBeTruthy();
    // 顶部照常可以撤销。
    expect(await screen.findByTestId('banner')).toHaveTextContent(/撤销/);
  });

  it('a sentence with both does the quick action first; “keep going” drafts the look (D-191)', async () => {
    const { store } = await renderApp();
    await askAi('主题换成绿色，添加签证照片快捷操作');
    expect(await screen.findByTestId('ready-screen')).toBeTruthy();
    expect(store.getState().config!.theme.primaryColor).not.toBe('#2F9E44');
    expect(screen.getByTestId('next-card')).toHaveTextContent(/主题换成绿色/);
    await fireEvent.press(screen.getByTestId('next-go'));
    // 句子自动打进 AI 修改页并发送，外观进草稿。
    expect(await screen.findByTestId('draft-bar', {}, { timeout: 4000 })).toBeTruthy();
    expect(store.getState().draft!.steps[0]!.config.theme.primaryColor).toBe('#2F9E44');
    expect(store.getState().next).toBeNull();
  });

  it('the draft chat refuses a quick action and can take it to Change this app (D-191)', async () => {
    const { store } = await renderApp();
    await askAi('主题换成绿色');
    await fireEvent.press(await screen.findByTestId('draft-edit'));
    await fireEvent.changeText(
      await screen.findByTestId('draft-chat-input'),
      '添加签证照片快捷操作',
    );
    await fireEvent.press(screen.getByTestId('draft-chat-send'));
    expect(await screen.findByTestId('draft-chat-rejected')).toHaveTextContent(
      /添加签证照片快捷操作\s+草稿里只改外观/,
    );
    expect(store.getState().draft!.steps).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('draft-chat-handoff'));
    expect(await screen.findByTestId('change-input')).toHaveProp('value', '添加签证照片快捷操作');
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('ready-screen')).toBeTruthy();
    // 草稿还在，回去时套在新版本上。
    expect(store.getState().draft).toMatchObject({ open: false });
  });

  it('in a draft the app can be browsed but not used (D-190)', async () => {
    const { store } = await renderApp();
    await askAi('添加签证照片工作流');
    await fireEvent.press(await screen.findByTestId('ready-later'));
    const id = store.getState().config!.workflows[0]!.id;
    await askAi('主题换成绿色');
    await screen.findByTestId('draft-bar');
    await fireEvent.press(screen.getByTestId(`run-${id}`));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/应用之后才能用/);
    expect(screen.queryByTestId('run-screen')).toBeNull();
    // 切换页面照常。
    await fireEvent.press(screen.getByTestId('nav-tools'));
    expect(await screen.findByTestId('install-pdf')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('install-pdf'));
    expect(store.getState().config!.tools.map((t) => t.toolId)).not.toContain('pdf');
  });

  it('notes from the AI appear in the reply (D-110)', async () => {
    const mock = createMockAIProvider();
    await renderApp(undefined, undefined, {
      plan: async (input, ctx) => {
        const plan = await mock.plan(input, ctx);
        return plan.kind === 'ops'
          ? { ...plan, notes: ['应用没有定时运行，每月需要你自己点一次。'] }
          : plan;
      },
    });
    // 直接做好的功能：说明在「做好了」页面上；草稿里的外观修改：说明在回复里。
    await askAi('添加签证照片工作流');
    expect(await screen.findByTestId('ready-note-0')).toHaveTextContent(/每月需要你自己点一次/);
    await fireEvent.press(screen.getByTestId('ready-later'));
    await askAi('主题换成绿色');
    expect(await screen.findByTestId('draft-note-0')).toHaveTextContent(/每月需要你自己点一次/);
  });

  it('leave keeps the draft; the AI page continues or deletes it', async () => {
    const { store } = await renderApp();
    await askAi('主题换成绿色');
    // 草稿里点会真的做事的东西只提示；离开时提示一起收掉。
    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-data'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/应用之后才能用/);
    await fireEvent.press(screen.getByTestId('draft-leave'));
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(screen.queryByTestId('draft-bar')).toBeNull();
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect(store.getState().head!.id).toBe(1);
    expect(store.getState().draft!.steps).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('nav-ai'));
    expect(await screen.findByTestId('change-draft')).toHaveTextContent(/你有一份草稿 · 1 步/);
    await fireEvent.press(screen.getByTestId('change-draft-continue'));
    expect(await screen.findByTestId('draft-bar')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('draft-leave'));

    await fireEvent.press(await screen.findByTestId('nav-ai'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('change-draft-delete'));
    expect(store.getState().draft).toBeNull();
    expect(store.getState().head!.id).toBe(1);
  });

  it('each sentence in the chat is a step; step back takes the last one away', async () => {
    const { store } = await renderApp();
    await askAi('首页改成文件工作台');
    expect(screen.getByTestId('draft-back').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(await screen.findByTestId('draft-edit'));
    await fireEvent.changeText(await screen.findByTestId('draft-chat-input'), '主题换成绿色');
    await fireEvent.press(screen.getByTestId('draft-chat-send'));
    const reply = await screen.findByTestId('draft-chat-reply-1');
    expect(within(reply).getByText(/#2F9E44/)).toBeTruthy();
    expect(store.getState().draft!.steps).toHaveLength(2);
    // 做不到的说明原因。
    await fireEvent.changeText(screen.getByTestId('draft-chat-input'), '帮我订一张机票');
    await fireEvent.press(screen.getByTestId('draft-chat-send'));
    const rejected = await screen.findByTestId('draft-chat-rejected');
    expect(within(rejected).getByText(/暂时无法理解/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('draft-chat-close'));
    // 回复记在草稿里（D-207）：再拉开还在；退掉它前面那一步时一起去掉。
    await fireEvent.press(screen.getByTestId('draft-edit'));
    expect(await screen.findByTestId('draft-chat-rejected')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('draft-chat-close'));

    await fireEvent.press(screen.getByTestId('draft-back'));
    expect(store.getState().draft!.steps).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('draft-edit'));
    await screen.findByTestId('draft-chat-reply-0');
    expect(screen.queryByTestId('draft-chat-rejected')).toBeNull();
    await fireEvent.press(screen.getByTestId('draft-chat-close'));
    await applyDraft();
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect(store.getState().config!.pages.find((p) => p.id === 'home')!.title).toBe('文件工作台');
  });

  /** 设置里选的 AI（这里假装是远程模型）：什么都拒绝，用来确认风格选择器的原句没有交给它。 */
  const configuredAI = () => ({
    plan: jest.fn<ReturnType<AIProvider['plan']>, Parameters<AIProvider['plan']>>(async () => ({
      kind: 'reject' as const,
      reason: 'unknown' as const,
      message: '远程 AI 收到了',
      examples: [],
    })),
  });

  it('pick a style: the built-in rules draft it, apply, marked, undo restores', async () => {
    const ai = configuredAI();
    const { store } = await renderApp(undefined, undefined, ai);
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.press(await screen.findByTestId('change-pick-style'));
    expect(await screen.findByText('选一个风格')).toBeTruthy();
    // 默认的 Clay 不是预设，没有格子被标为当前风格。
    expect(screen.getByTestId('style-brutalist').props.accessibilityState.selected).toBe(false);

    await fireEvent.press(screen.getByTestId('style-brutalist'));
    expect(await screen.findByTestId('draft-bar')).toBeTruthy();
    expect(ai.plan).not.toHaveBeenCalled();
    // 草稿期间已保存的版本没有变化。
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');

    await applyDraft();
    expect(await screen.findByTestId('banner')).toHaveTextContent(/已改好：换成新粗野风格/);
    expect(store.getState().config!.theme).toEqual(THEME_PRESETS.brutalist.theme);
    expect(store.getState().head).toMatchObject({ id: 2, source: 'ai' });
    const [latest] = await store.getState().listRevisions();
    expect(latest!.summary).toBe('换成新粗野风格');

    // 回到 AI 页，新粗野被标为当前风格。
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.press(await screen.findByTestId('change-pick-style'));
    expect((await screen.findByTestId('style-brutalist')).props.accessibilityState.selected).toBe(
      true,
    );
    await fireEvent.press(screen.getByTestId('style-ios'));
    await fireEvent.press(await screen.findByTestId('draft-leave'));

    await fireEvent.press(await screen.findByText('撤销'));
    await screen.findByTestId('nav-ai');
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect(store.getState().head).toMatchObject({ source: 'restore' });
  });

  it('a typed sentence goes to the configured AI even when it names a style', async () => {
    const ai = configuredAI();
    const { store } = await renderApp(undefined, undefined, ai);
    await askAi('换成液态玻璃风格，字体大一点');
    expect(await screen.findByText('远程 AI 收到了')).toBeTruthy();
    expect(ai.plan).toHaveBeenCalledTimes(1);
    expect(ai.plan.mock.calls[0]![0]).toBe('换成液态玻璃风格，字体大一点');
    expect(store.getState().head!.id).toBe(1);
    expect(store.getState().draft).toBeNull();
  });

  it('unknown requests show a clear message and no draft', async () => {
    await renderApp();
    await askAi('帮我订一张机票');
    expect(await screen.findByTestId('change-feedback')).toBeTruthy();
    expect(screen.getByText(/暂时无法理解/)).toBeTruthy();
    expect(screen.queryByTestId('draft-bar')).toBeNull();
  });

  it('D: restore an earlier version from History (reachable from Settings)', async () => {
    const { store } = await renderApp();
    await askAi('导航栏只保留首页、工具、设置');
    await applyDraft();

    await fireEvent.press(await screen.findByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-history'));
    // 改动记录（D-112）：没有编号和秒数，说明是谁改的。
    const entry = await screen.findByTestId('revision-2');
    expect(entry).toHaveTextContent(/AI 改的/);
    expect(entry).not.toHaveTextContent(/#\d|:\d\d:\d\d/);
    expect(screen.getByTestId('restore-1')).toHaveTextContent('回到这时候的样子');
    // 先问一句（说明文件不受影响），确认后立即生效（D-190）。
    let message: string | undefined;
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, msg, buttons) => {
      message = msg ?? undefined;
      buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('restore-1'));
    expect(message).toMatch(/你的文件不受影响/);

    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(store.getState().head).toMatchObject({ id: 3, source: 'restore' });
    expect(store.getState().head!.summary).toMatch(/^回到 .+ 的样子$/);
  });

  it('B: install PDF, merge two real PDFs, uninstall — the files stay', async () => {
    const { repo, files } = await renderApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-pdf'));

    // 从首页的工具入口打开同一个 App 里的 PDF 工具页。
    await fireEvent.press(await screen.findByTestId('nav-page:home'));
    await fireEvent.press((await screen.findAllByText('PDF'))[0]!);
    expect(await screen.findByTestId('run-pdf-merge')).toBeTruthy();

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
    await fireEvent.press(await screen.findByTestId('install-pdf'));
    await fireEvent.press(await screen.findByTestId('open-pdf'));
    expect(await screen.findByTestId('run-pdf-merge')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('page-ai'));
    await fireEvent.changeText(
      await screen.findByTestId('change-input'),
      '把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名',
    );
    await fireEvent.press(screen.getByTestId('change-submit'));
    // 改快捷操作是功能，直接生效（D-191）：回到同一个工具页，顶部可以撤销，仍然只有一个工具实例。
    expect(await screen.findByTestId('banner')).toHaveTextContent(/撤销/);
    expect(await screen.findByTestId('run-pdf-merge')).toBeTruthy();
    expect(store.getState().draft).toBeNull();
    expect(store.getState().config!.tools).toHaveLength(1);
    expect(store.getState().config!.workflows.filter((w) => w.id === 'pdf-merge')).toHaveLength(1);

    files.nextPick = [
      files.offer('a.pdf', await makePdf(1)),
      files.offer('b.pdf', await makePdf(1)),
    ];
    await fireEvent.press(screen.getByTestId('run-pdf-merge'));
    expect(await screen.findByText(/^已保存「合并-\d{4}-\d{2}-\d{2}\.pdf」（2 页）$/)).toBeTruthy();
    expect(screen.queryByTestId('prompt-ok')).toBeNull();
  });

  it('AI can leave the navigation entirely; Settings still opens AI and undo is immediate', async () => {
    const { store } = await renderApp();
    await askAi('把 AI 入口删掉，把历史从导航栏移除');
    await applyDraft();
    expect(await screen.findByTestId('banner')).toBeTruthy();
    expect(screen.queryByTestId('nav-ai')).toBeNull();
    expect(screen.queryByTestId('nav-history')).toBeNull();
    expect(screen.queryByTestId('floating-ai')).toBeNull();

    // 从设置进入 AI 修改说「撤销」：没有草稿时直接回到上一个版本。
    await fireEvent.press(screen.getByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '撤销刚才的修改');
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('nav-ai')).toBeTruthy();
    expect(store.getState().config!.shell.nav).toContain('history');
    expect(store.getState().draft).toBeNull();
  });

  it('Settings itself cannot be removed', async () => {
    await renderApp();
    await askAi('把设置删掉');
    expect(await screen.findByText(/「设置」不能移除/)).toBeTruthy();
    expect(screen.queryByTestId('draft-bar')).toBeNull();
  });

  it('a new page gets an entry (the nav bar is full, so a home shortcut) and the theme restyles', async () => {
    const { store } = await renderApp();
    await askAi('新建一个叫「记账」的页面，字体大一点，去掉阴影');
    expect(await screen.findByTestId('draft-reply')).toHaveTextContent(/新建页面「记账」/);
    await applyDraft();

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
