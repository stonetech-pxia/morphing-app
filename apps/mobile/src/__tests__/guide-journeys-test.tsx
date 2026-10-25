import {
  BUILTIN_TOOLS,
  GUIDE_GOALS,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import * as samples from '../guide/samples';
import { LOOK_PROMPTS, useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, makePdf } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 新手引导（D-149）：划屏介绍 → 第 1 步改界面 → 第 2 步「我有什么，我想要什么」→ 示例文件跑通。

const TYPED = { timeout: 4000 };

async function startGuide(stage?: 'goal') {
  const repo = new MemoryWorkspaceRepo();
  if (stage) await repo.setMeta('guide', stage);
  const files = new FakeFiles();
  await act(() => useGuide.getState().load(repo));
  return renderToolsApp(repo, files);
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
    expect(await screen.findByTestId('welcome')).toHaveTextContent(/属于你的 App/);
    await fireEvent.press(screen.getByTestId('welcome-next'));
    await fireEvent.press(screen.getByTestId('welcome-skip'));
    expect(await screen.findByTestId('guide-look')).toHaveTextContent(/第 1 步/);
    expect(await repo.getMeta('guide')).toBe('look');
  });

  it('the intro has four pages; "Start" on the last one leads to step 1', async () => {
    const { repo } = await startGuide();
    await screen.findByTestId('welcome');
    for (const i of [0, 1, 2, 3]) expect(screen.getByTestId(`welcome-page-${i}`)).toBeTruthy();
    expect(screen.getByTestId('welcome-art-style')).toHaveTextContent(/换成赛博霓虹风/);
    expect(screen.getByTestId('welcome-art-quick')).toHaveTextContent(/发旅行照片给朋友/);
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('welcome-next'));
    expect(screen.getByTestId('welcome-next')).toHaveTextContent('开始');
    await fireEvent.press(screen.getByTestId('welcome-next'));
    expect(await screen.findByTestId('guide-look')).toHaveTextContent(/第 1 步/);
    expect(await repo.getMeta('guide')).toBe('look');
  });

  it('step 1: a tapped sentence types itself, lands in a draft, and applying keeps it', async () => {
    const { repo, store } = await startGuide();
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    // 打字的时候不能改、也不能发送；打完自动用内置规则处理，直接进入草稿（D-190）。
    expect(screen.getByTestId('change-input').props.editable).toBe(false);
    await screen.findByTestId('draft-bar', {}, TYPED);
    expect(screen.getByTestId('draft-guide-hint')).toHaveTextContent(/点「应用」保留/);
    // 草稿里引导卡片不显示；还没应用，第 1 步还没完成。
    expect(screen.queryByTestId('guide-look')).toBeNull();
    expect(await repo.getMeta('guide')).toBe('look');
    await fireEvent.press(screen.getByTestId('draft-apply'));
    expect(store.getState().config!.theme.cardStyle).not.toBe('soft');
    // 第 2 步出现，并告诉用户可以撤销刚才的修改。
    expect(await screen.findByTestId('guide-goal')).toHaveTextContent(/第 2 步/);
    expect(screen.getByTestId('guide-undo-hint')).toHaveTextContent(/撤销/);
    expect(await repo.getMeta('guide')).toBe('goal');
  });

  // D-228：内置规则不认法语。设置里选的是内置规则时，法语引导照旧发英文句子，照样进草稿。
  it('in French with the built-in rules, step 1 still lands in a draft', async () => {
    const repo = new MemoryWorkspaceRepo();
    await act(() => useGuide.getState().load(repo));
    const { store } = await renderToolsApp(repo, new FakeFiles(), { locale: 'fr' });
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-look-0'));
    await screen.findByTestId('draft-bar', {}, TYPED);
    await fireEvent.press(screen.getByTestId('draft-apply'));
    expect(store.getState().config!.theme.cardStyle).toBe('glow');
  });

  it('step 2: one sentence grows a 7-step quick action that runs on sample photos', async () => {
    const { repo, store, files } = await startGuide('goal');
    const photos = [1, 2, 3].map((i) => files.offerImage(`trip-${i}.jpg`, 4032, 3024));
    const load = jest.spyOn(samples, 'loadSamples').mockResolvedValue(photos);
    const trip = GUIDE_GOALS[0]!;

    await fireEvent.press(await screen.findByTestId(`guide-goal-${trip.id}`));
    // 快捷操作是功能，直接做好（D-191），不进草稿：「做好了」页面列出步骤，AI 补上的标出来（D-149）。
    expect(await screen.findByTestId('ready-run', {}, TYPED)).toHaveTextContent('用我自己的文件');
    expect(store.getState().draft).toBeNull();
    expect(screen.getByTestId('ready-name')).toHaveTextContent('发旅行照片给朋友');
    expect(screen.getByTestId('ready-added-jpg')).toBeTruthy();
    expect(screen.getByTestId('ready-added-clean')).toBeTruthy();
    expect(screen.queryByTestId('ready-added-zip')).toBeNull();
    expect(screen.getByTestId('ready-note-1')).toHaveTextContent(/别人看不到你在哪拍的/);
    expect(await repo.getMeta('guide')).toBe('done');
    const added = store.getState().config!.workflows.find((w) => w.name === '发旅行照片给朋友')!;
    expect(added.steps).toHaveLength(7);
    // 默认放到首页。
    const home = store.getState().config!.pages.find((p) => p.id === 'home')!;
    expect(home.components.some((c) => c.type === 'workflowRunner')).toBe(true);

    await fireEvent.press(screen.getByTestId('ready-sample'));
    expect(load).toHaveBeenCalledWith('photos');
    expect(await screen.findByTestId('run-step-pick')).toHaveTextContent(/示例照片（3 张）/);
    expect(await screen.findByTestId('run-try-own', {}, TYPED)).toBeTruthy();
    // 一次分享出去了一个 ZIP；示例文件没有被当成分享进来的文件删掉。
    expect(files.shared.some((uri) => uri.endsWith('.zip'))).toBe(true);
  });

  it('step 2 also offers the contracts sentence, which runs on sample contracts', async () => {
    const { files } = await startGuide('goal');
    const pdfs = [files.offer('a.pdf', await makePdf(3)), files.offer('b.pdf', await makePdf(2))];
    jest.spyOn(samples, 'loadSamples').mockResolvedValue(pdfs);
    await fireEvent.press(await screen.findByTestId('guide-goal-contracts'));
    await screen.findByTestId('ready-sample', {}, TYPED);
    expect(screen.getByTestId('ready-added-compress')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ready-sample'));
    expect(await screen.findByTestId('run-step-pick')).toHaveTextContent(/示例合同（2 份）/);
    expect(await screen.findByTestId('run-try-own', {}, TYPED)).toBeTruthy();
  });

  it('the video sentence has no samples: “ready” runs it on the user’s own video', async () => {
    await startGuide('goal');
    await fireEvent.press(await screen.findByTestId('guide-goal-big-video'));
    expect(await screen.findByTestId('ready-run', {}, TYPED)).toHaveTextContent('现在就用一次');
    expect(screen.queryByTestId('ready-sample')).toBeNull();
  });

  it('“later” leaves a small starter task that brings step 2 back', async () => {
    const { repo } = await startGuide('goal');
    await fireEvent.press(await screen.findByTestId('guide-later'));
    await fireEvent.press(await screen.findByTestId('guide-task'));
    expect(await screen.findByTestId('guide-goal')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-later'));
    await fireEvent.press(await screen.findByTestId('guide-task-close'));
    expect(screen.queryByTestId('guide-task')).toBeNull();
    expect(await repo.getMeta('guide')).toBe('done');
  });

  it('settings can show the guide again', async () => {
    await startGuide();
    await fireEvent.press(await screen.findByTestId('welcome-skip'));
    await fireEvent.press(await screen.findByTestId('guide-skip'));
    expect(screen.queryByTestId('guide-look')).toBeNull();
    await fireEvent.press(screen.getByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-guide'));
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });
});
