import {
  BUILTIN_TOOLS,
  allComponents,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
} from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { createWorkspaceStore, shownConfig, type WorkspaceStore } from '../workspace/store';

// AI 修改的草稿（D-190）：一句一句地改、退一步、离开再回来、应用成一个版本、删除、重启后还在。

const registry = createRegistry(BUILTIN_TOOLS);

function makeStore(repo: MemoryWorkspaceRepo): WorkspaceStore {
  return createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: 'zh',
    now: () => new Date(2026, 9, 24, 9, 0),
  });
}

async function booted(repo = new MemoryWorkspaceRepo()) {
  const store = makeStore(repo);
  await store.getState().boot();
  return { repo, store };
}

async function say(store: WorkspaceStore, input: string) {
  const result = await store.getState().draftChange(input);
  if (result.kind !== 'drafted') throw new Error(`${input}: ${JSON.stringify(result)}`);
  return result.step;
}

const draftConfig = (store: WorkspaceStore) => store.getState().draft!.steps.at(-1)!.config;

describe('AI change drafts (D-190)', () => {
  it('a request makes a draft; the real app does not change until it is applied', async () => {
    const { store } = await booted();
    const before = store.getState().config!;
    const headId = store.getState().head!.id;
    await say(store, '主题换成绿色');
    const draft = store.getState().draft!;
    expect(draft.open).toBe(true);
    expect(draftConfig(store).theme.primaryColor).toBe('#2F9E44');
    expect(store.getState().config).toBe(before);
    expect(store.getState().head!.id).toBe(headId);
    // 外壳显示草稿；离开后显示正式的 App。
    expect(shownConfig(store.getState())!.theme.primaryColor).toBe('#2F9E44');
    store.getState().closeDraft();
    expect(shownConfig(store.getState())).toBe(before);
  });

  it('each sentence is a step on top of the draft; step back drops the last one', async () => {
    const { store } = await booted();
    await say(store, '首页改成文件工作台');
    await say(store, '主题换成绿色');
    expect(store.getState().draft!.steps).toHaveLength(2);
    expect(draftConfig(store).pages.find((p) => p.id === 'home')!.title).toBe('文件工作台');
    expect(draftConfig(store).theme.primaryColor).toBe('#2F9E44');

    await store.getState().stepBack();
    expect(store.getState().draft!.steps).toHaveLength(1);
    expect(draftConfig(store).theme.primaryColor).not.toBe('#2F9E44');
    // 只剩一步时不能再退（要整个丢掉就删除草稿）。
    await store.getState().stepBack();
    expect(store.getState().draft!.steps).toHaveLength(1);
  });

  it('“undo” in the draft steps back; on the first step it explains how to delete', async () => {
    const { store } = await booted();
    await say(store, '首页改成文件工作台');
    expect(await store.getState().draftChange('撤销刚才的修改')).toMatchObject({
      kind: 'rejected',
      message: expect.stringMatching(/删除草稿/),
    });
    await say(store, '主题换成绿色');
    expect(await store.getState().draftChange('撤销')).toEqual({ kind: 'steppedBack' });
    expect(store.getState().draft!.steps).toHaveLength(1);
  });

  it('applying commits all steps as one AI revision that can be undone', async () => {
    const { store, repo } = await booted();
    const baseId = store.getState().head!.id;
    await say(store, '首页改成文件工作台');
    await say(store, '主题换成绿色');
    const applied = await store.getState().applyDraft();
    expect(applied).toEqual({ addedWorkflowIds: [], addedCollectionIds: [], origin: {} });
    expect(store.getState().draft).toBeNull();
    const head = store.getState().head!;
    expect(head.parentId).toBe(baseId);
    expect(head.source).toBe('ai');
    expect(head.summary).toBe('首页改成文件工作台；主题换成绿色');
    expect(store.getState().config!.theme.primaryColor).toBe('#2F9E44');
    await store.getState().markRendered(head.id);
    expect(store.getState().banner).toMatchObject({ kind: 'applied', undoTo: baseId });
    expect(await repo.getMeta('draft')).toBe('');
    await store.getState().undo();
    expect(store.getState().config!.theme.primaryColor).not.toBe('#2F9E44');
  });

  it('the draft survives a restart and is rebased onto the latest version', async () => {
    const repo = new MemoryWorkspaceRepo();
    const first = makeStore(repo);
    await first.getState().boot();
    await say(first, '首页改成文件工作台');
    await say(first, '主题换成绿色');

    const second = makeStore(repo);
    await second.getState().boot();
    const draft = second.getState().draft!;
    expect(draft.open).toBe(false);
    expect(draft.steps.map((s) => s.input)).toEqual(['首页改成文件工作台', '主题换成绿色']);
    expect(draft.steps.at(-1)!.config.theme.primaryColor).toBe('#2F9E44');
    // 回到草稿时打开草稿模式；新的一句接着改这份草稿。
    second.getState().openDraft();
    expect(second.getState().draft!.open).toBe(true);
    await say(second, '字体大一点');
    expect(second.getState().draft!.steps).toHaveLength(3);
  });

  it('steps that no longer fit after the app changed are dropped with a notice', async () => {
    const repo = new MemoryWorkspaceRepo();
    const store = createWorkspaceStore({
      repo,
      provider: createMockAIProvider(),
      registry,
      locale: 'zh',
      now: () => new Date(2026, 9, 24, 9, 0),
      seed: createStarterWorkspace,
    });
    await store.getState().boot();
    await say(store, '字体大一点');
    await say(store, '把 PDF 放到最上面');
    store.getState().closeDraft();
    // 离开草稿期间移除了 PDF 工具：第二步要挪的卡片没有了，第一步还在。
    await store.getState().proposeOps([{ op: 'uninstallTool', toolId: 'pdf' }], '移除 PDF');
    await store.getState().confirm();
    store.getState().openDraft();
    expect(store.getState().draft!.steps.map((s) => s.input)).toEqual(['字体大一点']);
    expect(store.getState().draftNotice).toMatch(/1 步套不上/);
    expect(JSON.parse((await repo.getMeta('draft'))!).steps).toHaveLength(1);
  });

  it('deleting the draft leaves the app as it was', async () => {
    const { store, repo } = await booted();
    const before = store.getState().config;
    await say(store, '主题换成绿色');
    await store.getState().deleteDraft();
    expect(store.getState().draft).toBeNull();
    expect(store.getState().config).toBe(before);
    expect(await repo.getMeta('draft')).toBe('');
  });

  it('a draft that cannot be shown loses its last step', async () => {
    const { store } = await booted();
    await say(store, '首页改成文件工作台');
    await say(store, '主题换成绿色');
    await store.getState().draftRenderFailed(new Error('boom'));
    expect(store.getState().draft!.steps).toHaveLength(1);
    expect(store.getState().draftNotice).toMatch(/撤掉/);
    await store.getState().draftRenderFailed(new Error('boom'));
    expect(store.getState().draft).toBeNull();
  });

  it('without a draft, “undo” goes straight back to the previous version', async () => {
    const { store } = await booted();
    await say(store, '主题换成绿色');
    await store.getState().applyDraft();
    await store.getState().markRendered(store.getState().head!.id);
    expect(await store.getState().draftChange('撤销刚才的修改')).toEqual({ kind: 'restored' });
    expect(store.getState().config!.theme.primaryColor).not.toBe('#2F9E44');
    expect(store.getState().draft).toBeNull();
  });
});

async function change(store: WorkspaceStore, input: string) {
  const result = await store.getState().change(input);
  if (result.kind !== 'applied') throw new Error(`${input}: ${JSON.stringify(result)}`);
  return result.applied;
}

describe('function changes go straight in (D-191)', () => {
  it('a new quick action is applied right away, with its home entry, and can be undone', async () => {
    const { store } = await booted();
    const baseId = store.getState().head!.id;
    const applied = await change(store, '我有一堆旅行照片，想发给朋友');
    expect(applied.addedWorkflowIds).toEqual(['trip-photos']);
    expect(applied.notes?.length).toBeGreaterThan(0);
    expect(store.getState().draft).toBeNull();
    const home = store.getState().config!.pages.find((p) => p.id === 'home')!;
    expect(allComponents(home).some((c) => c.type === 'workflowRunner')).toBe(true);
    const head = store.getState().head!;
    expect(head).toMatchObject({ parentId: baseId, source: 'ai' });
    await store.getState().markRendered(head.id);
    expect(store.getState().banner).toMatchObject({ kind: 'applied', undoTo: baseId });
    await store.getState().undo();
    expect(store.getState().config!.workflows.some((w) => w.id === 'trip-photos')).toBe(false);
  });

  it('a sentence with both does the function first and keeps the rest as the next request', async () => {
    const { store, repo } = await booted();
    await change(store, '主题换成绿色，添加签证照片快捷操作');
    expect(store.getState().config!.workflows.some((w) => w.id === 'visa-photo')).toBe(true);
    expect(store.getState().config!.theme.primaryColor).not.toBe('#2F9E44');
    expect(store.getState().next).toBe('主题换成绿色');
    expect(await repo.getMeta('next')).toBe('主题换成绿色');
    // 重启后还在；点了之后进草稿，用掉就清掉。
    const again = makeStore(repo);
    await again.getState().boot();
    expect(again.getState().next).toBe('主题换成绿色');
    expect(await again.getState().change('主题换成绿色')).toMatchObject({ kind: 'drafted' });
    expect(again.getState().next).toBeNull();
    expect(await repo.getMeta('next')).toBe('');
  });

  it('a data page is the table first, then the page in a draft', async () => {
    const { store } = await booted();
    const applied = await change(store, '新建一个记账页面');
    expect(applied.addedCollectionIds).toEqual(['expenses']);
    expect(store.getState().config!.pages.some((p) => p.id === 'budget')).toBe(false);
    expect(store.getState().next).toBe('增加记账页面');
    const result = await store.getState().change('增加记账页面');
    expect(result).toMatchObject({ kind: 'drafted' });
    expect(draftConfig(store).pages.some((p) => p.id === 'budget')).toBe(true);
  });

  it('a new function change replaces the next request; undoing it clears it', async () => {
    const { store } = await booted();
    await change(store, '新建一个记账页面');
    await change(store, '添加签证照片快捷操作');
    expect(store.getState().next).toBeNull();
    await change(store, '主题换成绿色，添加扫描文档快捷操作');
    expect(store.getState().next).toBe('主题换成绿色');
    await store.getState().markRendered(store.getState().head!.id);
    await store.getState().undo();
    expect(store.getState().next).toBeNull();
  });

  it('the draft chat refuses function changes and leaves the draft alone', async () => {
    const { store } = await booted();
    await say(store, '主题换成绿色');
    const headId = store.getState().head!.id;
    expect(await store.getState().draftChange('添加签证照片快捷操作')).toMatchObject({
      kind: 'functionInDraft',
      message: expect.stringMatching(/草稿里只改外观/),
    });
    expect(store.getState().draft!.steps).toHaveLength(1);
    expect(store.getState().head!.id).toBe(headId);
  });

  it('a function change with a draft around goes into the real app; the draft is kept on top', async () => {
    const { store } = await booted();
    await say(store, '主题换成绿色');
    await change(store, '添加签证照片快捷操作');
    const draft = store.getState().draft!;
    expect(draft.open).toBe(false);
    expect(store.getState().config!.workflows.some((w) => w.id === 'visa-photo')).toBe(true);
    store.getState().openDraft();
    const shown = shownConfig(store.getState())!;
    expect(shown.theme.primaryColor).toBe('#2F9E44');
    expect(shown.workflows.some((w) => w.id === 'visa-photo')).toBe(true);
  });
});
