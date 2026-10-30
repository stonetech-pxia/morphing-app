import { quickActionsOf } from '@morph/core';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { acceptNextAlert, renderToolsApp } from '../test-utils/render-app';

// 工作流的界面旅程（T7）：设置 → 快捷操作 → 内设的直接运行；编辑参数、每次运行时问、加步骤 → 保存（一个版本）→ 撤销。

async function openWorkflows() {
  const app = await renderToolsApp();
  await fireEvent.press(screen.getByTestId('nav-settings'));
  await fireEvent.press(await screen.findByTestId('settings-workflows'));
  expect(await screen.findByTestId('workflows-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('category-image'));
  expect(await screen.findByTestId('quick-actions-image')).toBeTruthy();
  return app;
}

const visa = (store: Awaited<ReturnType<typeof renderToolsApp>>['store']) =>
  quickActionsOf(store.getState().config!).find((w) => w.preset === 'visa-photo');

describe('workflow journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists built-in quick actions without anything to add (D-236)', async () => {
    const { store } = await openWorkflows();
    expect(screen.getByTestId('workflow-visa-photo')).toBeTruthy();
    expect(screen.getByTestId('workflow-run-visa-photo')).toBeTruthy();
    expect(screen.queryByTestId('preset-add-visa-photo')).toBeNull();
    expect(screen.queryByTestId('workflows-empty')).toBeNull();
    expect(quickActionsOf(store.getState().config!).some((w) => w.preset)).toBe(false);
  });

  it('runs a built-in quick action without changing the app, and remembers the use', async () => {
    const { store, repo, files } = await openWorkflows();
    const head = store.getState().head!.id;
    files.nextPhotos = [files.offerImage('a.jpg', 4000, 3000)];
    await fireEvent.press(screen.getByTestId('workflow-run-email-photos'));
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    expect(await screen.findByTestId('run-result', {}, { timeout: 3000 })).toBeTruthy();
    expect(files.shared).toHaveLength(1);
    expect(store.getState().head!.id).toBe(head);
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'email-photos')).toBe(
      false,
    );
    expect((await repo.countSucceededRuns()).get('email-photos')?.count).toBe(1);
  });

  it('saves an edited built-in under its own id, and undo brings the built-in back', async () => {
    const { store } = await openWorkflows();
    const before = store.getState().head!.id;
    await fireEvent.press(screen.getByTestId('workflow-edit-visa-photo'));
    expect(await screen.findByTestId('workflow-editor')).toBeTruthy();
    // 内设的本来就是原样，没有「恢复原样」；也不能删除。
    expect(screen.queryByTestId('workflow-reset')).toBeNull();
    expect(screen.queryByTestId('workflow-delete')).toBeNull();
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
    // 用同一个 ID：内设时用过的次数接着算。
    expect(wf.id).toBe('visa-photo');
    expect(wf.name).toBe('美签照片');
    expect(wf.steps[1]).toMatchObject({
      params: { spec: 'us-passport', maxKB: 200 },
      ask: ['maxKB'],
    });
    expect(wf.steps.map((s) => s.action).at(-1)).toBe('out.share');
    expect(store.getState().head).toMatchObject({
      id: before + 1,
      summary: '调整了快捷操作「美签照片」',
    });
    expect(await screen.findByTestId('workflow-reset')).toBeTruthy();

    // 提示条上的「撤销」回到编辑之前：又是内设的那个。
    await fireEvent.press(await screen.findByText('撤销'));
    expect(visa(store)).toBeUndefined();
    await waitFor(() =>
      expect(screen.getByTestId('workflow-name').props.value).toBe('签证 / 证件照'),
    );
    expect(screen.queryByTestId('workflow-discard')).toBeNull();
  });

  it('keeps steps that do not fit from being saved, and can put a built-in on Home', async () => {
    const { store } = await openWorkflows();
    await fireEvent.press(screen.getByTestId('workflow-edit-email-photos'));
    // 把「选照片」移到第二步：第一步不再是输入，不能保存。
    await fireEvent.press(await screen.findByTestId('step-down-0'));
    expect(screen.getByTestId('step-problem-0')).toBeTruthy();
    expect(screen.getByTestId('workflow-save').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('workflow-discard'));
    expect(screen.queryByTestId('step-problem-0')).toBeNull();

    const before = store.getState().head!.id;
    await fireEvent.press(screen.getByTestId('workflow-to-home'));
    // 首页的入口要指向配置里的快捷操作：一起存进去，一个版本。
    expect(store.getState().head!.id).toBe(before + 1);
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'email-photos')).toBe(
      true,
    );
    const home = store.getState().config!.containers.pages.find((p) => p.id === 'home')!;
    expect(
      home.blocks.some(
        (c) =>
          c.look === 'action' &&
          (c as { tools: { tool: string }[] }).tools[0]!.tool === 'email-photos',
      ),
    ).toBe(true);
  });

  it('copies a built-in under a new id', async () => {
    const { store } = await openWorkflows();
    await fireEvent.press(screen.getByTestId('workflow-edit-email-photos'));
    await fireEvent.press(await screen.findByTestId('workflow-duplicate'));
    const copy = quickActionsOf(store.getState().config!).find((w) => w.preset === 'email-photos')!;
    expect(copy.id).not.toBe('email-photos');
    // 内设的那个还在。
    await fireEvent.press(await screen.findByText('撤销'));
    expect(quickActionsOf(store.getState().config!)).toHaveLength(0);
  });

  it('deleting an edited built-in returns to the original', async () => {
    const { store } = await openWorkflows();
    await fireEvent.press(screen.getByTestId('workflow-edit-email-photos'));
    await fireEvent.changeText(await screen.findByTestId('workflow-name'), '发邮件');
    await fireEvent.press(screen.getByTestId('workflow-save'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('workflow-delete'));
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'email-photos')).toBe(
      false,
    );
    expect(store.getState().head).toMatchObject({ summary: '删除了快捷操作「发邮件」' });
    expect(await screen.findByTestId('workflow-email-photos')).toBeTruthy();
  });
});
