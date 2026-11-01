import {
  type AIProvider,
  allComponents,
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  type PlanContext,
  quickActionsOf,
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
    expect(draftConfig(store).containers.pages.find((p) => p.id === 'home')!.title).toBe(
      '文件工作台',
    );
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
    expect(applied).toEqual({
      addedWorkflowIds: [],
      addedCollectionIds: [],
      homeScreenWorkflowIds: [],
      origin: {},
    });
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
    });
    await store.getState().boot();
    // 新用户的首页没有工具卡片（D-182）：先添加图片和 PDF 工具，PDF 卡片排在第二。
    await store.getState().proposeOps(
      [
        { op: 'setPackage', package: 'image', do: 'add' },
        { op: 'setPackage', package: 'pdf', do: 'add' },
      ],
      '添加图片和 PDF',
    );
    await store.getState().confirm();
    await say(store, '字体大一点');
    await say(store, '把 PDF 放到最上面');
    store.getState().closeDraft();
    // 离开草稿期间移除了 PDF 工具：第二步要挪的卡片没有了，第一步还在。
    await store
      .getState()
      .proposeOps([{ op: 'setPackage', package: 'pdf', do: 'remove' }], '移除 PDF');
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

async function change(store: WorkspaceStore, input: string, planner?: AIProvider) {
  const result = await store.getState().change(input, planner);
  if (result.kind !== 'applied') throw new Error(`${input}: ${JSON.stringify(result)}`);
  return result.applied;
}

describe('function changes go straight in (D-191)', () => {
  it('a new quick action is applied right away, with its home entry, and can be undone', async () => {
    const { store } = await booted();
    const baseId = store.getState().head!.id;
    // 带说明（notes）的新快捷操作：内置规则不再有目标句（D-265），用一个固定的计划。
    const withNotes: AIProvider = {
      plan: async () => ({
        kind: 'ops',
        ops: [
          {
            op: 'addTool',
            tool: {
              kind: 'quickAction',
              id: 'trip-photos',
              name: '发旅行照片给朋友',
              steps: [
                { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 50 } },
                { id: 'share', action: 'out.share', params: {} },
              ],
            },
          },
        ],
        notes: ['去掉了照片里的定位。'],
      }),
    };
    const applied = await change(store, '我有一堆旅行照片，想发给朋友', withNotes);
    expect(applied.addedWorkflowIds).toEqual(['trip-photos']);
    expect(applied.notes?.length).toBeGreaterThan(0);
    expect(store.getState().draft).toBeNull();
    const home = store.getState().config!.containers.pages.find((p) => p.id === 'home')!;
    expect(allComponents(home).some((c) => c.look === 'action')).toBe(true);
    const head = store.getState().head!;
    expect(head).toMatchObject({ parentId: baseId, source: 'ai' });
    await store.getState().markRendered(head.id);
    expect(store.getState().banner).toMatchObject({ kind: 'applied', undoTo: baseId });
    await store.getState().undo();
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'trip-photos')).toBe(
      false,
    );
  });

  it('a sentence with both does the function first and keeps the rest as the next request', async () => {
    const { store, repo } = await booted();
    await change(store, '主题换成绿色，添加签证照片快捷操作');
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'visa-photo')).toBe(true);
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
    expect(store.getState().config!.containers.pages.some((p) => p.id === 'budget')).toBe(false);
    expect(store.getState().next).toBe('增加记账页面');
    const result = await store.getState().change('增加记账页面');
    expect(result).toMatchObject({ kind: 'drafted' });
    expect(draftConfig(store).containers.pages.some((p) => p.id === 'budget')).toBe(true);
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
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'visa-photo')).toBe(true);
    store.getState().openDraft();
    const shown = shownConfig(store.getState())!;
    expect(shown.theme.primaryColor).toBe('#2F9E44');
    expect(quickActionsOf(shown).some((w) => w.id === 'visa-photo')).toBe(true);
  });
});

describe('the draft chat remembers what was said (D-207)', () => {
  /** 记下每次交给 AI 的上下文。 */
  async function recorded(repo = new MemoryWorkspaceRepo()) {
    const mock = createMockAIProvider();
    const contexts: PlanContext[] = [];
    const provider: AIProvider = {
      plan: (input, ctx) => {
        contexts.push(ctx);
        return mock.plan(input, ctx);
      },
    };
    const store = createWorkspaceStore({
      repo,
      provider,
      registry,
      locale: 'zh',
      now: () => new Date(2026, 9, 24, 9, 0),
    });
    await store.getState().boot();
    return { store, contexts };
  }

  it('earlier sentences of this draft go to the AI with what came of them', async () => {
    const { store, contexts } = await recorded();
    await say(store, '首页改成文件工作台');
    expect(contexts[0]!.earlier).toBeUndefined();
    const lines = store.getState().draft!.steps[0]!.lines;
    const refused = await store.getState().draftChange('撤销刚才的修改');
    await say(store, '主题换成绿色');
    expect(contexts[2]!.earlier).toEqual([
      { input: '首页改成文件工作台', done: true, reply: lines.join('; ') },
      {
        input: '撤销刚才的修改',
        done: false,
        reply: refused.kind === 'rejected' ? refused.message : '',
      },
    ]);
  });

  it('only the last five sentences are sent; stepping back is not one of them', async () => {
    const { store, contexts } = await recorded();
    for (const input of [
      '主题换成绿色',
      '主题换成蓝色',
      '主题换成红色',
      '字体大一点',
      '字体小一点',
    ])
      await say(store, input);
    await store.getState().draftChange('撤销');
    await say(store, '主题换成紫色');
    expect(contexts.at(-1)!.earlier!.map((e) => e.input)).toEqual([
      '主题换成绿色',
      '主题换成蓝色',
      '主题换成红色',
      '字体大一点',
    ]);
    await say(store, '主题换成橙色');
    await say(store, '主题换成粉色');
    expect(contexts.at(-1)!.earlier!.map((e) => e.input)).toEqual([
      '主题换成蓝色',
      '主题换成红色',
      '字体大一点',
      '主题换成紫色',
      '主题换成橙色',
    ]);
  });

  it('“Change this app” starts fresh even with a draft around', async () => {
    const { store, contexts } = await recorded();
    await say(store, '主题换成绿色');
    await store.getState().change('首页改成文件工作台');
    expect(contexts.at(-1)!.earlier).toBeUndefined();
  });

  it('replies are kept with the draft, survive a restart and go with the steps they follow', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { store } = await recorded(repo);
    await say(store, '首页改成文件工作台');
    await store.getState().draftChange('撤销刚才的修改');
    await say(store, '主题换成绿色');
    await store.getState().draftChange('添加签证照片快捷操作');
    expect(store.getState().draft!.replies).toMatchObject([
      { afterSteps: 1, input: '撤销刚才的修改', kind: 'rejected' },
      { afterSteps: 2, input: '添加签证照片快捷操作', kind: 'functionInDraft' },
    ]);

    const { store: again } = await recorded(repo);
    expect(again.getState().draft!.replies).toEqual(store.getState().draft!.replies);
    again.getState().openDraft();
    // 退一步：排在退掉的那一步后面的回复一起去掉。
    await again.getState().stepBack();
    expect(again.getState().draft!.replies.map((r) => r.input)).toEqual(['撤销刚才的修改']);

    await again.getState().applyDraft();
    await say(again, '字体大一点');
    expect(again.getState().draft!.replies).toEqual([]);
  });
});
