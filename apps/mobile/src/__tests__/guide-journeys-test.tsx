import {
  BUILTIN_TOOLS,
  allComponents,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
} from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { LOOK_PROMPTS, useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide, openPick } from '../test-utils/render-app';

// 新手引导（D-149、D-231）：划屏介绍 → 第 1 步加两个文件入口（直接生效）→ 第 2 步打开图片或文件
// → 第 3 步样板 App（D-260，另见 sample-apps-test.tsx）。

const TYPED = { timeout: 4000 };

async function startGuide(stage?: 'goal' | 'samples', seed = createStarterWorkspace) {
  const repo = new MemoryWorkspaceRepo();
  if (stage) await repo.setMeta('guide', stage);
  const files = new FakeFiles();
  await act(() => useGuide.getState().load(repo));
  return renderToolsApp(repo, files, { seed });
}

describe('first-run guide', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useGuide.setState({ stage: null, repo: null });
  });

  it('the step 1 sentences are ones the offline rules understand', async () => {
    const registry = createRegistry(BUILTIN_TOOLS);
    const ai = createMockAIProvider();
    for (const locale of ['zh', 'en'] as const) {
      for (const prompt of LOOK_PROMPTS) {
        const config = createStarterWorkspace(locale, registry);
        const plan = await ai.plan(prompt[locale], { config, registry, locale });
        expect([prompt[locale], plan.kind]).toEqual([prompt[locale], 'ops']);
      }
    }
  });

  it('shows the intro first; skipping it leads to step 1 on the home page', async () => {
    const { repo } = await startGuide();
    expect(await screen.findByTestId('welcome')).toHaveTextContent(/拍下纸质文件/);
    await fireEvent.press(screen.getByTestId('welcome-next'));
    await fireEvent.press(screen.getByTestId('welcome-skip'));
    expect(await screen.findByTestId('guide-look')).toHaveTextContent(/空荡荡/);
    expect(await repo.getMeta('guide')).toBe('look');
  });

  it('the intro has three pages; "Start" on the last one leads to step 1', async () => {
    const { repo } = await startGuide();
    await screen.findByTestId('welcome');
    for (const i of [0, 1, 2]) expect(screen.getByTestId(`welcome-page-${i}`)).toBeTruthy();
    expect(screen.queryByTestId('welcome-page-3')).toBeNull();
    expect(screen.getByTestId('welcome-art-scan')).toBeTruthy();
    expect(screen.getByTestId('welcome-page-0')).toHaveTextContent(/文件只在你的手机上处理/);
    expect(screen.getByTestId('welcome-art-records')).toHaveTextContent(/名片/);
    expect(screen.getByTestId('welcome-art-style')).toHaveTextContent(/换成霓虹风/);
    for (let i = 0; i < 2; i++) await fireEvent.press(screen.getByTestId('welcome-next'));
    expect(screen.getByTestId('welcome-next')).toHaveTextContent('开始');
    await fireEvent.press(screen.getByTestId('welcome-next'));
    expect(await screen.findByTestId('guide-look')).toHaveTextContent(/空荡荡/);
    expect(await repo.getMeta('guide')).toBe('look');
  });

  const filePicks = (store: Awaited<ReturnType<typeof startGuide>>['store']) =>
    allComponents(store.getState().config!.containers.pages.find((p) => p.id === 'home')!).filter(
      // 两个入口：扫描（首页宫格里的内设「扫描成 PDF」，D-487）和打开文件。
      (c) =>
        c.look === 'picker' ||
        (c.look === 'action' && c.tools.some((u) => 'tool' in u && u.tool === 'scan-camera')),
    );

  it('step 1: the sentence fills the box and waits; sending adds both buttons without a draft', async () => {
    const { repo, store } = await startGuide();
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    expect(await screen.findByTestId('guide-look')).toHaveTextContent(/空荡荡/);
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    // 打完字停在 AI 页面，由用户自己发送（D-231）。
    await waitFor(
      () => expect(screen.getByTestId('change-input').props.editable).toBe(true),
      TYPED,
    );
    expect(screen.getByTestId('change-input')).toHaveProp('value', LOOK_PROMPTS[0]!.zh);
    expect(filePicks(store)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('change-submit'));
    // 直接生效，不进草稿；回到首页显示第 2 步。引导里的修改顶部不出「已改好 · 撤销」（D-239）。
    expect(await screen.findByTestId('guide-goal')).toHaveTextContent(
      /搭好了，以后你想改什么都可以和我说哦/,
    );
    expect(store.getState().draft).toBeNull();
    expect(filePicks(store)).toHaveLength(2);
    expect(screen.getByTestId('file-pick-open')).toBeTruthy();
    expect(screen.getByTestId('run-scan-camera')).toBeTruthy();
    expect(store.getState().banner).toBeNull();
    expect(screen.queryByTestId('banner')).toBeNull();
    expect(screen.queryByTestId('guide-undo-hint')).toBeNull();
    expect(screen.queryByTestId('guide-goal-trip-photos')).toBeNull();
    expect(await repo.getMeta('guide')).toBe('goal');
  });

  // D-447：第一步是 Tink 说的一句话，不写「第 1 步」；首页右上角的 Tink 在动，点它和点气泡一样。
  it('step 1 is Tink speaking, not a numbered card; tapping the moving Tink opens the same sentence', async () => {
    await startGuide();
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    const bubble = await screen.findByTestId('guide-look');
    expect(bubble).toHaveTextContent(/点击我，我给你搭一个工作台吧/);
    expect(bubble).not.toHaveTextContent(/第 1 步/);
    expect(screen.getByTestId('tink-lively')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('page-ai'));
    await waitFor(
      () => expect(screen.getByTestId('change-input')).toHaveProp('value', LOOK_PROMPTS[0]!.zh),
      TYPED,
    );
  });

  it('after the Tink bubbles the entry stops moving and opens the AI page as usual', async () => {
    await startGuide('samples');
    expect(await screen.findByTestId('page-ai')).toBeTruthy();
    expect(screen.queryByTestId('tink-lively')).toBeNull();
  });

  // D-448：AI 页的发送按钮就是白色的 Tink，输入框左边不再有图标；忙的时候 Tink 动，旁边一句短话跟着规划的阶段。
  it('the send button is Tink; while busy it moves and says what the planner is doing', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const { store } = await startGuide('goal');
    await fireEvent.press(await screen.findByTestId('page-ai'));
    const send = await screen.findByTestId('change-submit');
    expect(within(send).getByTestId('tink-hammer')).toBeTruthy();
    expect(screen.queryByTestId('change-progress')).toBeNull();
    await act(async () => store.setState({ busy: true, planProgress: null }));
    expect(screen.getByTestId('change-progress')).toHaveTextContent('收到！让我想想…');
    expect(within(send).getByTestId('tink-lively')).toBeTruthy();
    await act(async () => store.setState({ planProgress: 'style' }));
    expect(screen.getByTestId('change-progress')).toHaveTextContent('挑颜色挑到眼花…');
    await act(async () => store.setState({ planProgress: 'checking' }));
    expect(screen.getByTestId('change-progress')).toHaveTextContent('敲敲打打，检查一遍…');
    await act(async () => store.setState({ busy: false, planProgress: null }));
    expect(screen.queryByTestId('change-progress')).toBeNull();
  });

  it('the Tink in the guide has a glowing halo; the bubble has no step number', async () => {
    await startGuide();
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await screen.findByTestId('guide-look');
    expect(screen.getByTestId('tink-halo')).toBeTruthy();
  });

  // D-228：内置规则不认法语。设置里选的是内置规则时，法语引导照旧发英文句子。
  it('in French with the built-in rules, step 1 still adds both buttons', async () => {
    const repo = new MemoryWorkspaceRepo();
    await act(() => useGuide.getState().load(repo));
    const { store } = await renderToolsApp(repo, new FakeFiles(), {
      locale: 'fr',
      seed: createStarterWorkspace,
    });
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    await waitFor(
      () => expect(screen.getByTestId('change-input').props.editable).toBe(true),
      TYPED,
    );
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('guide-goal')).toBeTruthy();
    expect(filePicks(store)).toHaveLength(2);
  });

  it('rerunning step 1 when both buttons are already there moves on to step 2', async () => {
    const { store } = await startGuide(undefined, starterAfterGuide);
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    await waitFor(
      () => expect(screen.getByTestId('change-input').props.editable).toBe(true),
      TYPED,
    );
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('guide-goal')).toBeTruthy();
    expect(filePicks(store)).toHaveLength(2);
  });

  it('skipping the guide adds both buttons directly', async () => {
    const { repo, store } = await startGuide();
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-skip'));
    await waitFor(() => expect(filePicks(store)).toHaveLength(2));
    expect(store.getState().draft).toBeNull();
    expect(screen.queryByTestId('guide-look')).toBeNull();
    // 顶部不出「已改好 · 撤销」（D-239）。
    expect(store.getState().banner).toBeNull();
    expect(screen.queryByTestId('banner')).toBeNull();
    expect(await repo.getMeta('guide')).toBe('done');
  });

  it('step 2 ends the guide when the user opens pictures or files', async () => {
    const { repo, files } = await startGuide('goal', starterAfterGuide);
    expect(await screen.findByTestId('guide-goal')).toHaveTextContent(/搭好了/);
    files.nextMedia = [files.offerImage('a.jpg', 400, 300)];
    await openPick('media');
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(await repo.getMeta('guide')).toBe('done');
  });

  it('“got it” on step 2 closes the bubble and ends the guide (no step 3)', async () => {
    const { repo } = await startGuide('goal');
    await fireEvent.press(await screen.findByTestId('guide-later'));
    expect(screen.queryByTestId('guide-goal')).toBeNull();
    expect(screen.queryByTestId('guide-task')).toBeNull();
    expect(screen.queryByTestId('guide-samples')).toBeNull();
    expect(await repo.getMeta('guide')).toBe('done');
  });

  // D-447：第 1、2 步的气泡浮在首页上（不在页面里排版），下面轻微虚化；第 2 步右下角是「我知道了」。
  it('the bubbles float over a slightly blurred home page; step 2 has “got it”', async () => {
    await startGuide('goal');
    const overlay = await screen.findByTestId('guide-overlay');
    expect(within(overlay).getByTestId('guide-blur')).toBeTruthy();
    expect(within(overlay).getByTestId('guide-goal')).toBeTruthy();
    expect(within(overlay).getByTestId('guide-later')).toHaveTextContent('我知道了');
    expect(screen.getByTestId('guide-goal')).not.toHaveTextContent(/第 2 步/);
    expect(screen.getByTestId('tink-lively')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-later'));
    expect(screen.queryByTestId('guide-overlay')).toBeNull();
  });
});
