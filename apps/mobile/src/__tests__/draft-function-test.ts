import {
  type AIProvider,
  allComponents,
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  type Plan,
  remindersOf,
  validateWorkspace,
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
