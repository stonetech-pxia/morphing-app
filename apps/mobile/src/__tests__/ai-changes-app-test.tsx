import { HABIT_RUNS, WORKFLOW_PRESETS, allComponents, presetWorkflow } from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useIncoming } from '../share/incoming';
import { TINY_JPEG } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';
import type { WorkspaceStore } from '../workspace/store';

// AI 只改 App（D-113）：做好后由用户自己点「现在就用一次」、从快捷操作打开 AI 改它、办事类请求给出
// 能做的快捷操作、从使用习惯里提议、收件页面现场搭一个、现成的按场景分组（D-124–D-130）。

async function askAi(text: string) {
  await fireEvent.press(screen.getByTestId('nav-ai'));
  await fireEvent.changeText(await screen.findByTestId('change-input'), text);
  await fireEvent.press(screen.getByTestId('change-submit'));
}

async function addVisa(store: WorkspaceStore) {
  const wf = presetWorkflow(WORKFLOW_PRESETS[0]!, 'zh', 'visa-photo');
  await store.getState().proposeOps([{ op: 'addWorkflow', workflow: wf }], 'add');
  await store.getState().confirm();
}

describe('AI changes the app, the user runs it (UI)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useIncoming.getState().clear();
  });

  it('a new quick action opens “ready”; the user taps “use it now” to run it (D-125)', async () => {
    const { store, files } = await renderToolsApp();
    await askAi('添加签证照片快捷操作');
    // 快捷操作是功能，直接做好（D-191），打开「做好了」。
    expect(await screen.findByTestId('ready-screen')).toHaveTextContent(/快捷操作做好了/);
    expect(screen.getByTestId('ready-name')).toHaveTextContent('签证 / 证件照');
    // AI 没有自己运行。
    expect(screen.queryByTestId('run-screen')).toBeNull();

    files.nextPhotos = [files.offerImage('me.jpg', 1200, 1600)];
    await fireEvent.press(screen.getByTestId('ready-run'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
    expect(store.getState().config!.workflows.map((w) => w.id)).toContain('visa-photo');
  });

  it('“ask AI to change it” opens AI about that quick action; 这个 means it (D-126)', async () => {
    const { store } = await renderToolsApp();
    await addVisa(store);
    await act(() => router.push({ pathname: '/change', params: { workflow: 'visa-photo' } }));
    expect(await screen.findByTestId('change-about')).toHaveTextContent(
      /要改的快捷操作：「签证 \/ 证件照」/,
    );
    // 不列预设的句子（D-233）；风格选择器也不显示。
    expect(screen.queryByText('把这个的大小改成 200KB')).toBeNull();
    expect(screen.queryByTestId('change-pick-style')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('change-input'), '把这个的大小改成 200KB');
    await fireEvent.press(screen.getByTestId('change-submit'));
    // 改快捷操作直接生效（D-191），打开它的「做好了」页面，现在就能再用一次。
    expect(await screen.findByTestId('ready-name')).toHaveTextContent('签证 / 证件照');
    const visa = store.getState().config!.workflows.find((w) => w.id === 'visa-photo')!;
    expect(visa.steps.find((s) => s.action === 'image.idPhoto')!.params.maxKB).toBe(200);
  });

  it('the result page has “ask AI to change it” next to “adjust settings”', async () => {
    const { files } = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-image'));
    await fireEvent.press(await screen.findByTestId('open-image'));
    files.nextPhotos = [files.offerImage('p.jpg', 400, 300)];
    await fireEvent.press(await screen.findByTestId('run-image-compress'));
    await fireEvent.press(await screen.findByTestId('ask-preset-kb-240'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByTestId('run-edit')).toHaveTextContent('调整设置');
    await fireEvent.press(screen.getByTestId('run-ask-ai'));
    expect(await screen.findByTestId('change-about')).toHaveTextContent(/「压缩图片」/);
  });

  it('an errand is refused with quick actions it can make; tapping one fills it in (D-128)', async () => {
    await renderToolsApp();
    await askAi('帮我写一封请假邮件');
    const feedback = await screen.findByTestId('change-feedback');
    expect(feedback).toHaveTextContent(/只会修改这个 App/);
    const chips = screen.getByTestId('change-feedback-examples');
    await fireEvent.press(within(chips).getByText('添加签证照片快捷操作'));
    expect(screen.getByTestId('change-input').props.value).toBe('添加签证照片快捷操作');
  });

  it(`after ${HABIT_RUNS} runs with the same size, offers a quick action on the home page (D-127)`, async () => {
    const { store, files } = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-image'));
    await fireEvent.press(await screen.findByTestId('open-image'));

    for (let i = 1; i <= HABIT_RUNS; i++) {
      files.nextPhotos = [files.offerImage(`p${i}.jpg`, 400, 300)];
      await fireEvent.press(await screen.findByTestId('run-image-compress'));
      await fireEvent.press(await screen.findByTestId('ask-preset-kb-500'));
      await fireEvent.press(screen.getByTestId('prompt-ok'));
      expect(await screen.findByTestId(`result-item-p${i}.jpg`)).toBeTruthy();
      if (i < HABIT_RUNS) {
        expect(screen.queryByTestId('habit-card')).toBeNull();
        await fireEvent.press(screen.getByTestId('run-done'));
      }
    }
    expect(await screen.findByTestId('habit-card')).toHaveTextContent(/经常用「500 KB」？/);
    await fireEvent.press(screen.getByTestId('habit-make'));
    expect(await screen.findByTestId('habit-made')).toBeTruthy();

    const config = store.getState().config!;
    const made = config.workflows.find((w) => !w.toolId)!;
    expect(made.name).toBe('压缩图片 · 500 KB');
    const step = made.steps.find((s) => s.action === 'image.compress')!;
    expect(step.params.maxKB).toBe(500);
    expect(step.ask ?? []).not.toContain('maxKB');
    const home = config.pages.find((p) => p.id === 'home')!;
    expect(
      allComponents(home).some(
        (c) => c.type === 'workflowRunner' && c.props.workflowId === made.id,
      ),
    ).toBe(true);
  });

  it('“no thanks” is remembered', async () => {
    const { files } = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-image'));
    await fireEvent.press(await screen.findByTestId('open-image'));
    const once = async (i: number) => {
      files.nextPhotos = [files.offerImage(`q${i}.jpg`, 400, 300)];
      await fireEvent.press(await screen.findByTestId('run-image-compress'));
      await fireEvent.press(await screen.findByTestId('ask-preset-kb-240'));
      await fireEvent.press(screen.getByTestId('prompt-ok'));
      expect(await screen.findByTestId(`result-item-q${i}.jpg`)).toBeTruthy();
    };
    for (let i = 1; i <= HABIT_RUNS; i++) {
      await once(i);
      if (i < HABIT_RUNS) await fireEvent.press(screen.getByTestId('run-done'));
    }
    await fireEvent.press(await screen.findByTestId('habit-no'));
    expect(screen.queryByTestId('habit-card')).toBeNull();
    await fireEvent.press(screen.getByTestId('run-done'));
    await once(HABIT_RUNS + 1);
    expect(screen.queryByTestId('habit-card')).toBeNull();
  });

  it('the share inbox offers fitting ready-made quick actions and “ask AI to make one” (D-129)', async () => {
    const { store, files } = await renderToolsApp();
    const photo = files.offer('IMG_1.jpg', TINY_JPEG, 'image/jpeg');
    await act(async () => useIncoming.getState().receive([photo]));
    await act(() => router.push('/share'));
    expect(await screen.findByTestId('share-ask-ai')).toHaveTextContent(/我要自己说/);
    // 内设的里，第一步收一张照片的才列出来（签证照片收 1 张；签回表格收 PDF，不列）。
    expect(screen.getByTestId('share-workflow-visa-photo')).toBeTruthy();
    expect(screen.queryByTestId('share-workflow-sign-return')).toBeNull();

    // 让 AI 搭一个：AI 页说明是给分享进来的文件，只知道类型和个数。
    await fireEvent.press(screen.getByTestId('share-ask-ai'));
    expect(await screen.findByTestId('change-about')).toHaveTextContent(/给分享进来的 1 张照片/);
    await fireEvent.changeText(
      screen.getByTestId('change-input'),
      '新建一个快捷操作：选照片，压到 500KB，分享',
    );
    await fireEvent.press(screen.getByTestId('change-submit'));
    // 直接做好（D-191），回到收件页面，新做的排在最前面、标「刚做好」，不会自己运行。
    // 给分享的文件做的不放首页，在收件页面运行。
    const made = await waitFor(() =>
      store.getState().config!.workflows.find((w) => !w.toolId && !w.presetId)!,
    );
    expect(await screen.findByTestId(`share-workflow-${made.id}`)).toHaveTextContent(/刚做好/);
    expect(store.getState().draft).toBeNull();
    const home = store.getState().config!.pages.find((p) => p.id === 'home')!;
    expect(home.components.some((c) => c.type === 'workflowRunner')).toBe(false);
    expect(screen.queryByTestId('ready-screen')).toBeNull();
    expect(screen.queryByTestId('run-screen')).toBeNull();
  });

  it('runs a built-in quick action on the shared files without adding it (D-236)', async () => {
    const { store, files } = await renderToolsApp();
    const head = store.getState().head!.id;
    const photo = files.offer('IMG_2.jpg', TINY_JPEG, 'image/jpeg');
    await act(async () => useIncoming.getState().receive([photo]));
    await act(() => router.push('/share'));
    await fireEvent.press(await screen.findByTestId('share-run-visa-photo'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
    expect(store.getState().config!.workflows.some((w) => w.presetId === 'visa-photo')).toBe(false);
    expect(store.getState().head!.id).toBe(head);
    expect(screen.getByText('分享进来的文件（1 个）')).toBeTruthy();
  });

  it('built-in quick actions are grouped by input type and run directly', async () => {
    await renderToolsApp();
    await act(() => router.push('/workflows'));
    await fireEvent.press(await screen.findByTestId('category-image'));
    expect(await screen.findByTestId('workflow-visa-photo')).toBeTruthy();
    expect(screen.queryByTestId('workflow-sign-return')).toBeNull();
    await fireEvent.press(screen.getByTestId('workflow-run-visa-photo'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
  });
});
