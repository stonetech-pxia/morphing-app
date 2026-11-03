import {
  type AIProvider,
  allComponents,
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  type Plan,
  quickActionsOf,
  remindersOf,
  validateWorkspace,
  type WorkspaceConfig,
} from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 功能修改依赖草稿（D-413）：在草稿的样子上说的功能修改，操作在草稿上合法，但应用到正式版本时套不上。

const registry = createRegistry(BUILTIN_TOOLS);

const SCRIPT: Record<string, Plan> = {
  建书单表: {
    kind: 'ops',
    ops: [
      {
        op: 'addData',
        table: {
          id: 'books',
          name: '书单',
          fields: [
            { id: 'title', name: '书名', type: 'text' },
            { id: 'author', name: '作者', type: 'text' },
          ],
        },
      },
    ],
  },
  放一个书单页: {
    kind: 'ops',
    ops: [
      {
        op: 'addContainer',
        page: {
          id: 'shelf',
          title: '书架',
          blocks: [{ id: 'shelf-title', look: 'header', show: { title: '书架' } }],
        },
      } as never,
    ],
  },
  列表放到书架: {
    kind: 'ops',
    ops: [
      {
        op: 'addContainer',
        page: 'shelf',
        block: {
          id: 'books-list',
          look: 'list',
          source: { table: 'books', limit: 30 },
          show: { title: 'title', subtitles: ['author'] },
        },
      },
    ],
  },
  删作者字段: {
    kind: 'ops',
    ops: [
      { op: 'removeData', table: 'books', field: 'author' },
      {
        op: 'updateContainer',
        page: 'shelf',
        block: 'books-list',
        changes: { show: { subtitles: null } },
      },
    ],
  },
  每天提醒看书架: {
    kind: 'ops',
    ops: [
      {
        op: 'addTool',
        tool: {
          kind: 'reminder',
          id: 'read',
          title: '看书',
          enabled: true,
          when: { every: 'day', at: '09:00' },
          opens: 'page:shelf',
        },
      },
    ],
  },
};

function scripted(calls: string[] = []): AIProvider {
  const mock = createMockAIProvider();
  return {
    plan: async (input, ctx) => {
      calls.push(input);
      return SCRIPT[input] ?? mock.plan(input, ctx);
    },
  };
}

async function makeStore(repo = new MemoryWorkspaceRepo(), calls: string[] = []) {
  const store = createWorkspaceStore({
    repo,
    provider: scripted(calls),
    registry,
    locale: 'zh',
    now: () => new Date(2026, 10, 3, 9, 0),
  });
  await store.getState().boot();
  return store;
}

/** 表在正式版本里，页面和列表只在草稿里。 */
async function withDraftPage(store: WorkspaceStore) {
  expect(await store.getState().change('建书单表')).toMatchObject({ kind: 'applied' });
  expect(await store.getState().change('放一个书单页')).toMatchObject({ kind: 'drafted' });
  expect(await store.getState().draftChange('列表放到书架')).toMatchObject({ kind: 'drafted' });
}

const draftConfig = (store: WorkspaceStore) => store.getState().draft!.steps.at(-1)!.config;
const shelfList = (config: ReturnType<typeof draftConfig>) =>
  allComponents(config.containers.pages.find((p) => p.id === 'shelf')!).find(
    (c) => c.id === 'books-list',
  ) as { show: Record<string, unknown> };

describe('删字段的善后操作改的块只在草稿里（D-413）', () => {
  it('功能到正式版本，善后在正式版本上跳过，草稿里的块也清理，配置自洽（底线 18）', async () => {
    const store = await makeStore();
    await withDraftPage(store);
    const result = await store.getState().draftChange('删作者字段');
    expect(result).toMatchObject({ kind: 'applied' });

    const { config, draft, draftNotice } = store.getState();
    const books = config!.data.tables.find((t) => t.id === 'books')!;
    expect(books.fields.map((f) => f.id)).toEqual(['title']);
    expect(config!.containers.pages.some((p) => p.id === 'shelf')).toBe(false);
    // 草稿一步都没丢，块不再读被删的字段。
    expect(draft!.steps).toHaveLength(2);
    expect(draftNotice).toBeNull();
    expect(shelfList(draftConfig(store)).show.subtitles).toBeUndefined();
    expect(validateWorkspace(draftConfig(store), registry).ok).toBe(true);
  });

  it('重启后草稿还套得上，应用后也自洽', async () => {
    const repo = new MemoryWorkspaceRepo();
    const store = await makeStore(repo);
    await withDraftPage(store);
    await store.getState().draftChange('删作者字段');

    const again = await makeStore(repo);
    expect(again.getState().draft!.steps).toHaveLength(2);
    expect(again.getState().draftNotice).toBeNull();
    again.getState().openDraft();
    await again.getState().applyDraft();
    expect(shelfList(again.getState().config!).show.subtitles).toBeUndefined();
    expect(validateWorkspace(again.getState().config!, registry).ok).toBe(true);
  });

  it('草稿离开了（从 AI 修改页说的）也一样', async () => {
    const store = await makeStore();
    await withDraftPage(store);
    store.getState().closeDraft();
    expect(await store.getState().change('删作者字段')).toMatchObject({ kind: 'applied' });
    expect(store.getState().draft!.steps).toHaveLength(2);
    expect(shelfList(draftConfig(store)).show.subtitles).toBeUndefined();
  });
});

describe('提醒要打开只在草稿里的页面（D-413）', () => {
  it('不改任何东西，告诉用户；点了才应用草稿再做这一步（底线 7、16）', async () => {
    const calls: string[] = [];
    const store = await makeStore(undefined, calls);
    await withDraftPage(store);
    const headId = store.getState().head!.id;

    const result = await store.getState().draftChange('每天提醒看书架');
    expect(result).toMatchObject({ kind: 'needsDraft', message: '这一步要用到草稿里的页面。' });
    expect(store.getState().head!.id).toBe(headId);
    expect(remindersOf(store.getState().config!)).toEqual([]);
    expect(store.getState().draft!.steps).toHaveLength(2);
    // 聊天框里说一句，带着可以接着做的这一步。
    const reply = store.getState().draft!.replies.at(-1)!;
    expect(reply).toMatchObject({ kind: 'needsDraft', input: '每天提醒看书架' });
    expect(reply.waiting).toBeDefined();

    const before = calls.length;
    const continued = await store.getState().continueWithDraft(reply.waiting!);
    expect(continued).toMatchObject({ kind: 'applied' });
    // 不用再问一次模型。
    expect(calls).toHaveLength(before);
    expect(store.getState().draft).toBeNull();
    const { config } = store.getState();
    expect(config!.containers.pages.some((p) => p.id === 'shelf')).toBe(true);
    expect(remindersOf(config!).map((r) => r.id)).toEqual(['read']);
  });

  it('从 AI 修改页说的也走这里，重启后聊天框里的那句还能接着做', async () => {
    const repo = new MemoryWorkspaceRepo();
    const store = await makeStore(repo);
    await withDraftPage(store);
    await store.getState().draftChange('每天提醒看书架');
    const again = await makeStore(repo);
    const reply = again.getState().draft!.replies.at(-1)!;
    expect(await again.getState().continueWithDraft(reply.waiting!)).toMatchObject({
      kind: 'applied',
    });
    expect(remindersOf(again.getState().config!).map((r) => r.id)).toEqual(['read']);
  });

  it('没有草稿时还是不合格，不会出这个按钮', async () => {
    const store = await makeStore();
    expect(await store.getState().change('每天提醒看书架')).toMatchObject({ kind: 'invalid' });
  });
});

// 功能和外观混在一个计划（D-419）：功能直接生效，外观不再问模型，直接进草稿；notes 不能说做了却没做。
describe('一个计划里功能和外观都有（D-419）', () => {
  const addBooks = {
    op: 'addData',
    table: { id: 'books', name: '书单', fields: [{ id: 'title', name: '书名', type: 'text' }] },
  };
  const booksAdd = {
    op: 'addContainer',
    page: 'home',
    block: {
      id: 'books-add',
      look: 'button',
      show: { label: '添加', variant: 'filled' },
      tools: [{ do: 'create', table: 'books', ask: 'all' }],
    },
  };
  const booksList = {
    op: 'addContainer',
    page: 'home',
    block: {
      id: 'books-home',
      look: 'list',
      source: { table: 'books', limit: 30 },
      show: { title: 'title' },
    },
  };
  const mixed = (extra: Partial<Extract<Plan, { kind: 'ops' }>> = {}): Plan =>
    ({ kind: 'ops', ops: [addBooks, booksAdd, booksList], ...extra }) as Plan;

  async function storeWith(script: Record<string, Plan>, repo = new MemoryWorkspaceRepo()) {
    const calls: string[] = [];
    const mock = createMockAIProvider();
    const store = createWorkspaceStore({
      repo,
      provider: {
        plan: async (input, ctx) => {
          calls.push(input);
          return script[input] ?? SCRIPT[input] ?? mock.plan(input, ctx);
        },
      },
      registry,
      locale: 'zh',
      now: () => new Date(2026, 10, 3, 9, 0),
    });
    await store.getState().boot();
    return { store, calls };
  }
  const hasBlock = (config: WorkspaceConfig, id: string) =>
    config.containers.pages.some((p) => allComponents(p).some((c) => c.id === id));

  it('没有草稿：功能生效，外观新建一份草稿并打开，不再问模型，确认后都在', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { store, calls } = await storeWith({ 书单: mixed({ notes: ['书单在首页'] }) }, repo);
    const headId = store.getState().head!.id;

    const result = await store.getState().change('书单');
    expect(result).toMatchObject({ kind: 'drafted', focusPageId: 'home' });
    expect(calls).toEqual(['书单']);

    // 功能已经生效，外观还没有（底线 7）。
    const { config, draft, head, next } = store.getState();
    expect(head!.id).not.toBe(headId);
    expect(config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    expect(hasBlock(config!, 'books-home')).toBe(false);
    expect(next).toBeNull();
    expect(draft).toMatchObject({ open: true });
    expect(draft!.steps).toHaveLength(1);
    expect(hasBlock(draftConfig(store), 'books-home')).toBe(true);
    expect(validateWorkspace(draftConfig(store), registry).ok).toBe(true);
    // 用户看得到功能已经生效，AI 的说明也跟着草稿这一步。
    expect(draft!.steps[0]!.notes!.join('\n')).toContain('已经生效');
    expect(draft!.steps[0]!.notes).toContain('书单在首页');

    // 清单看的是用户看到的样子（含草稿）：表有入口，这一句做好了。
    const item = store.getState().session.items.find((i) => i.text === '书单')!;
    expect(item.status).toBe('done');

    // 重启后草稿还在。
    const { store: again } = await storeWith({}, repo);
    expect(again.getState().draft!.steps).toHaveLength(1);

    await store.getState().applyDraft();
    expect(store.getState().draft).toBeNull();
    expect(hasBlock(store.getState().config!, 'books-home')).toBe(true);
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    expect(calls).toEqual(['书单']);
  });

  it('模型同时给了 next：外观进草稿，next 照旧', async () => {
    const { store, calls } = await storeWith({ 书单: mixed({ next: '再换个绿色' }) });
    expect(await store.getState().change('书单')).toMatchObject({ kind: 'drafted' });
    expect(store.getState().next).toBe('再换个绿色');
    expect(hasBlock(draftConfig(store), 'books-home')).toBe(true);
    expect(calls).toEqual(['书单']);
  });

  it('已有草稿：先套到新版本上，外观接在后面', async () => {
    const script: Record<string, Plan> = {
      影单: {
        kind: 'ops',
        ops: [
          {
            op: 'addData',
            table: {
              id: 'films',
              name: '影单',
              fields: [{ id: 'title', name: '片名', type: 'text' }],
            },
          },
          {
            op: 'addContainer',
            page: 'shelf',
            block: {
              id: 'films-list',
              look: 'list',
              source: { table: 'films', limit: 30 },
              show: { title: 'title' },
            },
          },
        ],
      } as Plan,
    };
    const { store, calls } = await storeWith(script);
    await withDraftPage(store);
    const before = calls.length;

    expect(await store.getState().draftChange('影单')).toMatchObject({
      kind: 'drafted',
      focusPageId: 'shelf',
    });
    expect(calls).toHaveLength(before + 1);
    const { config, draft } = store.getState();
    expect(config!.data.tables.some((t) => t.id === 'films')).toBe(true);
    expect(hasBlock(config!, 'films-list')).toBe(false);
    expect(draft!.steps).toHaveLength(3);
    expect(draft!.open).toBe(true);
    // 前面的步骤也在新版本上：应用草稿不会盖掉刚生效的表。
    expect(draft!.steps[0]!.config.data.tables.some((t) => t.id === 'films')).toBe(true);

    await store.getState().applyDraft();
    const after = store.getState().config!;
    expect(after.data.tables.some((t) => t.id === 'films')).toBe(true);
    expect(hasBlock(after, 'books-list')).toBe(true);
    expect(hasBlock(after, 'films-list')).toBe(true);
    expect(validateWorkspace(after, registry).ok).toBe(true);
  });

  it('草稿离开了：也接在后面，草稿回到打开的状态', async () => {
    const { store } = await storeWith({ 书单二: mixed() });
    await store.getState().change('放一个书单页');
    store.getState().closeDraft();
    expect(store.getState().draft!.open).toBe(false);
    expect(await store.getState().change('书单二')).toMatchObject({ kind: 'drafted' });
    expect(store.getState().draft!.steps).toHaveLength(2);
    expect(store.getState().draft!.open).toBe(true);
  });

  // 整个计划合法，单独的外观套不上：快捷操作的首页入口占了块的 ID。
  const clash: Plan = {
    kind: 'ops',
    ops: [
      {
        op: 'addTool',
        tool: {
          kind: 'quickAction',
          id: 'q1',
          name: '发图',
          steps: [{ id: 's0', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } }],
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: { id: 'run-q1', look: 'header', show: { title: '我的工具' } },
      },
    ],
    notes: ['标题放在首页了'],
  } as Plan;

  it('外观套不上：功能照样生效，留一句接着改，告诉用户没做，不说做了', async () => {
    const { store, calls } = await storeWith({ 外观坏了: clash });
    const result = await store.getState().change('外观坏了');
    expect(result).toMatchObject({ kind: 'applied' });
    expect(calls).toEqual(['外观坏了']);
    const { config, draft, next, draftNotice } = store.getState();
    expect(quickActionsOf(config!).map((w) => w.id)).toEqual(expect.arrayContaining(['q1']));
    expect(draft).toBeNull();
    // 接着改的一句话：说得出要做什么。
    expect(next).toBeTruthy();
    expect(draftNotice).toBe('外观部分没做成，功能部分已经生效。可以点「接着改」再试一次。');
    if (result.kind !== 'applied') throw new Error('unreachable');
    expect(result.applied.notes).toEqual([draftNotice]);
    expect(store.getState().session.said.at(-1)!.reply).toContain('外观部分没做成');
  });

  it('外观套不上时有 next：用模型给的 next', async () => {
    const { store } = await storeWith({ 外观坏了: { ...clash, next: '放个标题' } as Plan });
    await store.getState().change('外观坏了');
    expect(store.getState().next).toBe('放个标题');
    expect(store.getState().draftNotice).toBeTruthy();
  });

  it('聊天框里外观套不上：回复里说没做，不说「外观还在草稿里」，草稿接着开着', async () => {
    const { store } = await storeWith({ 外观坏了: clash });
    await withDraftPage(store);
    expect(await store.getState().draftChange('外观坏了')).toMatchObject({ kind: 'applied' });
    const { draft } = store.getState();
    expect(draft!.open).toBe(true);
    expect(draft!.steps).toHaveLength(2);
    const reply = draft!.replies.at(-1)!;
    expect(reply.message).toContain('外观部分没做成');
    expect(reply.message).not.toContain('还在草稿里');
    expect(reply.message).not.toContain('标题放在首页了');
  });
});
