import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  createStarterWorkspace,
  type WorkspaceConfig,
} from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

const registry = createRegistry(BUILTIN_TOOLS);

function makeStore(repo: MemoryWorkspaceRepo): WorkspaceStore {
  return createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: 'zh',
    now: () => new Date(2026, 9, 22, 9, 0),
  });
}

async function booted(repo = new MemoryWorkspaceRepo()) {
  const store = makeStore(repo);
  await store.getState().boot();
  return { repo, store };
}

/** 提议 → 确认 → 模拟渲染成功。 */
async function applyText(store: WorkspaceStore, input: string) {
  const result = await store.getState().propose(input);
  if (result.kind !== 'preview')
    throw new Error(`no preview for “${input}”: ${JSON.stringify(result)}`);
  expect(await store.getState().confirm()).toBe(true);
  await store.getState().markRendered(store.getState().head!.id);
  return result.proposal;
}

async function installPdf(store: WorkspaceStore) {
  const result = await store
    .getState()
    .proposeOps([{ op: 'installTool', toolId: 'pdf' }], '安装 PDF');
  expect(result.kind).toBe('preview');
  await store.getState().confirm();
  await store.getState().markRendered(store.getState().head!.id);
}

const nav = (store: WorkspaceStore) => store.getState().config!.shell.nav;

describe('workspace store', () => {
  it('seeds the default workspace on first launch', async () => {
    const { repo, store } = await booted();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().head).toMatchObject({ id: 1, source: 'seed' });
    expect((await repo.listRevisions(10)).length).toBe(1);
  });

  it('the app seeds the starter tools as the first version (D-104)', async () => {
    const repo = new MemoryWorkspaceRepo();
    const store = createWorkspaceStore({
      repo,
      provider: createMockAIProvider(),
      registry,
      locale: 'zh',
      now: () => new Date(2026, 9, 22, 9, 0),
      seed: createStarterWorkspace,
    });
    await store.getState().boot();
    const config = store.getState().config!;
    expect(config.tools.map((t) => t.toolId)).toEqual([
      'image',
      'pdf',
      'video',
      'scan',
      'ocr',
      'qr',
    ]);
    expect(config.shell.nav).toEqual(['page:home', 'ai', 'settings']);
    expect((await repo.listRevisions(10)).map((r) => r.source)).toEqual(['seed']);
  });

  it('journey A: preview does not change the app; confirm does, and survives a restart', async () => {
    const { repo, store } = await booted();
    const result = await store.getState().propose('导航栏只保留首页、工具、设置');
    expect(result.kind).toBe('preview');
    // 预览阶段：当前配置不变，也没有新版本。
    expect(nav(store)).toEqual(['page:home', 'tools', 'ai', 'history', 'settings']);
    expect((await repo.listRevisions(10)).length).toBe(1);

    await store.getState().confirm();
    await store.getState().markRendered(store.getState().head!.id);
    expect(nav(store)).toEqual(['page:home', 'tools', 'settings']);
    expect(store.getState().config!.shell.floating).toEqual([]);
    expect(store.getState().banner).toMatchObject({ kind: 'applied', undoTo: 1 });
    expect(await repo.getChangeRequest(1)).toMatchObject({
      status: 'committed',
      resultRevisionId: 2,
    });

    // “重启”：用同一个存储新建 store。
    const { store: restarted } = await booted(repo);
    expect(nav(restarted)).toEqual(['page:home', 'tools', 'settings']);
  });

  it('cancel leaves no trace except the cancelled request', async () => {
    const { repo, store } = await booted();
    await store.getState().propose('主题换成绿色');
    await store.getState().cancel();
    expect(store.getState().proposal).toBeNull();
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect((await repo.listRevisions(10)).length).toBe(1);
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'cancelled' });
  });

  it('rejected and unknown requests never create a revision', async () => {
    const { repo, store } = await booted();
    expect(await store.getState().propose('把设置删掉')).toMatchObject({ kind: 'rejected' });
    expect(await store.getState().propose('帮我订机票')).toMatchObject({ kind: 'rejected' });
    expect((await repo.listRevisions(10)).length).toBe(1);
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'rejected' });
  });

  it('blocks an invalid plan (e.g. from a misbehaving model) before it is saved', async () => {
    const repo = new MemoryWorkspaceRepo();
    const store = createWorkspaceStore({
      repo,
      registry,
      locale: 'zh',
      now: () => new Date(),
      provider: {
        plan: async () => ({
          kind: 'ops',
          ops: [{ op: 'setNavItems', items: ['page:missing'] }],
        }),
      },
    });
    await store.getState().boot();
    expect(await store.getState().propose('anything')).toMatchObject({ kind: 'invalid' });
    expect((await repo.listRevisions(10)).length).toBe(1);
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'failed' });
  });

  it('rejects a stale plan when the workspace changed meanwhile (baseRevision)', async () => {
    const { repo, store } = await booted();
    const other = makeStore(repo);
    await other.getState().boot();

    await store.getState().propose('主题换成绿色');
    await applyText(other, '主题换成红色');

    expect(await store.getState().confirm()).toBe(false);
    expect(store.getState().banner).toMatchObject({ kind: 'conflict' });
    expect(store.getState().config!.theme.primaryColor).toBe('#E03131');
  });

  it('journey D: restore the previous version as a new revision, keeping history', async () => {
    const { repo, store } = await booted();
    await installPdf(store);
    await applyText(store, '导航栏只保留首页、工具、设置');

    const result = await store.getState().propose('恢复上一次修改前的界面');
    expect(result.kind).toBe('preview');
    if (result.kind === 'preview') expect(result.proposal.lines.at(-1)).toBe('你的文件不受影响');
    await store.getState().confirm();
    await store.getState().markRendered(store.getState().head!.id);

    expect(nav(store)).toEqual(['page:home', 'tools', 'ai', 'history', 'settings']);
    expect(store.getState().config!.tools.map((t) => t.toolId)).toEqual(['pdf']);
    expect(store.getState().head).toMatchObject({ id: 4, parentId: 3, source: 'restore' });
    expect((await repo.listRevisions(10)).map((r) => r.source)).toEqual([
      'restore',
      'ai',
      'user',
      'seed',
    ]);
  });

  it('restoring a version from before a tool was installed removes only its entry', async () => {
    const { store } = await booted();
    await installPdf(store);
    const result = await store.getState().proposeRestore(1);
    expect(result.kind).toBe('preview');
    if (result.kind === 'preview') {
      expect(result.proposal.lines.some((l) => l.includes('文件都会保留'))).toBe(true);
    }
    await store.getState().confirm();
    expect(store.getState().config!.tools).toEqual([]);
  });

  it.each([
    ['zh', '已改好：安装 PDF'],
    ['en', 'Changed: 安装 PDF'],
    ['fr', 'Modifi\u00e9\u202f: 安装 PDF'],
  ] as const)('the applied banner uses the %s colon', async (locale, message) => {
    const store = createWorkspaceStore({
      repo: new MemoryWorkspaceRepo(),
      provider: createMockAIProvider(),
      registry,
      locale,
      now: () => new Date(2026, 9, 22, 9, 0),
    });
    await store.getState().boot();
    await installPdf(store);
    expect(store.getState().banner?.message).toBe(message);
  });

  it('undo from the banner returns to the previous version', async () => {
    const { store } = await booted();
    await applyText(store, '主题换成绿色');
    await store.getState().undo();
    await store.getState().markRendered(store.getState().head!.id);
    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect(store.getState().head).toMatchObject({ source: 'restore', parentId: 2 });
  });

  it('rolls back automatically when the new version fails to render', async () => {
    const { repo, store } = await booted();
    await store.getState().markRendered(1);
    await store.getState().propose('主题换成绿色');
    await store.getState().confirm();
    await store.getState().reportRenderError(new Error('boom'));

    expect(store.getState().config!.theme.primaryColor).toBe('#C8623A');
    expect(store.getState().banner).toMatchObject({ kind: 'rolledBack' });
    expect(store.getState().head).toMatchObject({ source: 'rollback' });
    expect(await repo.getChangeRequest(1)).toMatchObject({ status: 'rolled_back' });
  });

  it('recovers the last valid version when the latest snapshot is corrupted', async () => {
    const { repo } = await booted();
    const corrupted = { schemaVersion: 1, theme: 'not a theme' } as unknown as WorkspaceConfig;
    repo.forceHead(corrupted);

    const { store } = await booted(repo);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().banner).toMatchObject({ kind: 'recovered' });
    expect(store.getState().head).toMatchObject({ source: 'recovery', parentId: 2 });
    expect(store.getState().config!.pages[0]!.id).toBe('home');
  });

  describe('home entry for workflows the AI creates (D-109)', () => {
    const runners = (config: WorkspaceConfig) =>
      config.pages
        .flatMap((p) => p.components)
        .filter((c) => c.type === 'workflowRunner')
        .map((c) => c.props.workflowId);

    it('offers it ticked; unticking keeps the workflow off every page', async () => {
      const { store } = await booted();
      const result = await store.getState().propose('添加签证照片工作流');
      if (result.kind !== 'preview') throw new Error(JSON.stringify(result));
      const id = result.proposal.after.workflows[0]!.id;
      expect(result.proposal.homeEntry).toEqual({ workflowIds: [id], on: true });
      expect(result.proposal.focusPageId).toBe('home');
      expect(runners(result.proposal.after)).toEqual([id]);
      // 改动清单里不重复列出首页入口：它是单独的勾选项。
      expect(result.proposal.lines.join('\n')).not.toMatch(/首页/);

      store.getState().setHomeEntry(false);
      const off = store.getState().proposal!;
      expect(off.homeEntry).toEqual({ workflowIds: [id], on: false });
      expect(off.focusWorkflowId).toBe(id);
      expect(runners(off.after)).toEqual([]);

      store.getState().setHomeEntry(true);
      expect(runners(store.getState().proposal!.after)).toEqual([id]);
      expect(store.getState().proposal!.focusWorkflowId).toBeUndefined();

      expect(await store.getState().confirm()).toBe(true);
      expect(runners(store.getState().config!)).toEqual([id]);
    });

    it('is not offered when the user already asked for the home page', async () => {
      const { store } = await booted();
      const result = await store.getState().propose('把签证照片放到首页');
      if (result.kind !== 'preview') throw new Error(JSON.stringify(result));
      expect(result.proposal.homeEntry).toBeUndefined();
      expect(runners(result.proposal.after)).toHaveLength(1);
    });

    it('starts unticked when the plan says the user does not want it there', async () => {
      const inner = createMockAIProvider();
      const store = createWorkspaceStore({
        repo: new MemoryWorkspaceRepo(),
        provider: {
          plan: async (input, ctx) => {
            const plan = await inner.plan(input, ctx);
            return plan.kind === 'ops' ? { ...plan, homeEntry: false } : plan;
          },
        },
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 22, 9, 0),
      });
      await store.getState().boot();
      const result = await store.getState().propose('添加签证照片工作流');
      if (result.kind !== 'preview') throw new Error(JSON.stringify(result));
      expect(result.proposal.homeEntry?.on).toBe(false);
      expect(runners(result.proposal.after)).toEqual([]);
    });
  });
});
