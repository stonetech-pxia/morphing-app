import {
  BUILTIN_TOOLS,
  allComponents,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { LOOK_PROMPTS, useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// 新手引导（D-149、D-231）：划屏介绍 → 第 1 步加两个文件入口（直接生效）→ 第 2 步打开图片或文件。

const TYPED = { timeout: 4000 };

async function startGuide(stage?: 'goal', seed = createStarterWorkspace) {
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

  const filePicks = (store: Awaited<ReturnType<typeof startGuide>>['store']) =>
    allComponents(store.getState().config!.pages.find((p) => p.id === 'home')!).filter(
      (c) => c.type === 'filePick',
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
    // 直接生效，不进草稿；回到首页显示第 2 步，并告诉用户可以撤销。
    expect(await screen.findByTestId('guide-goal')).toHaveTextContent(/第 2 步/);
    expect(store.getState().draft).toBeNull();
    expect(filePicks(store)).toHaveLength(2);
    expect(screen.getByTestId('file-pick-media')).toBeTruthy();
    expect(screen.getByTestId('guide-undo-hint')).toHaveTextContent(/撤销/);
    expect(screen.queryByTestId('guide-goal-trip-photos')).toBeNull();
    expect(await repo.getMeta('guide')).toBe('goal');
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
    expect(await repo.getMeta('guide')).toBe('done');
  });

  it('step 2 ends when the user opens pictures or files', async () => {
    const { repo, files } = await startGuide('goal', starterAfterGuide);
    expect(await screen.findByTestId('guide-goal')).toHaveTextContent(/简化繁琐的文件处理/);
    files.nextMedia = [files.offerImage('a.jpg', 400, 300)];
    await fireEvent.press(screen.getByTestId('file-pick-media'));
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(await repo.getMeta('guide')).toBe('done');
  });

  it('“later” on step 2 ends the guide', async () => {
    const { repo } = await startGuide('goal');
    await fireEvent.press(await screen.findByTestId('guide-later'));
    expect(screen.queryByTestId('guide-goal')).toBeNull();
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
