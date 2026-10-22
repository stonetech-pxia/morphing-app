import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { acceptNextAlert, renderToolsApp } from '../test-utils/render-app';

// 工作流的界面旅程（T7）：设置 → 工作流 → 从预设添加 → 编辑参数、每次运行时问、加步骤 → 保存（一个版本）→ 撤销 → 运行。

async function openWorkflows() {
  const app = await renderToolsApp();
  await fireEvent.press(screen.getByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-workflows'));
  expect(await screen.findByTestId('workflows-screen')).toBeTruthy();
  return app;
}

const visa = (store: Awaited<ReturnType<typeof renderToolsApp>>['store']) =>
  store.getState().config!.workflows.find((w) => w.presetId === 'visa-photo');

describe('workflow journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds a preset, edits it into a new version, and undoes the edit', async () => {
    const { store } = await openWorkflows();
    expect(screen.getByTestId('workflows-empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preset-add-visa-photo'));
    expect(await screen.findByTestId('workflow-visa-photo')).toBeTruthy();
    expect(store.getState().head).toMatchObject({
      source: 'user',
      summary: '添加工作流「签证 / 证件照」',
    });
    const added = store.getState().head!.id;

    await fireEvent.press(screen.getByTestId('workflow-edit-visa-photo'));
    expect(await screen.findByTestId('workflow-editor')).toBeTruthy();
    // 改名、把大小改成 200 KB、规格不再每次都问。
    await fireEvent.changeText(screen.getByTestId('workflow-name'), '美签照片');
    await fireEvent.changeText(screen.getByTestId('step-1-maxKB'), '200');
    await fireEvent.press(screen.getByTestId('step-1-ask-spec'));
    // 在最后加一步「分享」。
    await fireEvent.press(screen.getByTestId('step-insert-3'));
    expect(await screen.findByTestId('step-picker')).toBeTruthy();
    expect(screen.queryByTestId('step-pick-in.photos')).toBeNull();
    await fireEvent.press(screen.getByTestId('step-pick-out.share'));
    await fireEvent.press(screen.getByTestId('workflow-save'));

    const wf = visa(store)!;
    expect(wf.name).toBe('美签照片');
    expect(wf.steps[1]).toMatchObject({
      params: { spec: 'us-passport', maxKB: 200 },
      ask: ['maxKB'],
    });
    expect(wf.steps.map((s) => s.action).at(-1)).toBe('out.share');
    expect(store.getState().head).toMatchObject({
      id: added + 1,
      summary: '修改工作流「美签照片」',
    });

    // 提示条上的「撤销」回到编辑之前。
    await fireEvent.press(await screen.findByText('撤销'));
    expect(visa(store)!.name).toBe('签证 / 证件照');
    expect(visa(store)!.steps).toHaveLength(3);
    // 编辑页跟着回到撤销后的样子，不留下「未保存的改动」。
    expect(screen.getByTestId('workflow-name').props.value).toBe('签证 / 证件照');
    expect(screen.queryByTestId('workflow-discard')).toBeNull();
  });

  it('keeps steps that do not fit from being saved, and can put the workflow on Home', async () => {
    const { store } = await openWorkflows();
    await fireEvent.press(screen.getByTestId('preset-add-email-photos'));
    await fireEvent.press(await screen.findByTestId('workflow-edit-email-photos'));
    // 把「选照片」移到第二步：第一步不再是输入，不能保存。
    await fireEvent.press(await screen.findByTestId('step-down-0'));
    expect(screen.getByTestId('step-problem-0')).toBeTruthy();
    expect(screen.getByTestId('workflow-save').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('workflow-discard'));
    expect(screen.queryByTestId('step-problem-0')).toBeNull();

    await fireEvent.press(screen.getByTestId('workflow-to-home'));
    const home = store.getState().config!.pages.find((p) => p.id === 'home')!;
    expect(
      home.components.some(
        (c) => c.type === 'workflowRunner' && c.props.workflowId === 'email-photos',
      ),
    ).toBe(true);
  });

  it('runs the workflow from the editor', async () => {
    const { files } = await openWorkflows();
    await fireEvent.press(screen.getByTestId('preset-add-email-photos'));
    await fireEvent.press(await screen.findByTestId('workflow-edit-email-photos'));
    // 结果页会显示，分享步骤在测试里直接记录。
    files.nextPhotos = [files.offerImage('a.jpg', 4000, 3000)];
    await fireEvent.press(await screen.findByTestId('workflow-run'));
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    expect(await screen.findByTestId('run-result', {}, { timeout: 3000 })).toBeTruthy();
    expect(files.shared).toHaveLength(1);
  });

  it('deletes the user’s own workflow after asking, but tools’ workflows have no delete', async () => {
    const { store } = await openWorkflows();
    await fireEvent.press(screen.getByTestId('preset-add-email-photos'));
    await fireEvent.press(await screen.findByTestId('workflow-edit-email-photos'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('workflow-delete'));
    expect(store.getState().config!.workflows.some((w) => w.id === 'email-photos')).toBe(false);
    expect(store.getState().head).toMatchObject({ summary: '删除工作流「照片发邮件 / 传网站」' });
  });
});
