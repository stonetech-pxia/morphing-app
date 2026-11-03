import {
  type AIProvider,
  BUILTIN_TOOLS,
  checkTools,
  createRegistry,
  openItems,
  type Plan,
  type PlanContext,
  remindersOf,
  sessionProblems,
} from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 大工程步骤化（D-415）和工具清单（D-414）。用假的 planner，不发真实请求。

const registry = createRegistry(BUILTIN_TOOLS);

const table = (id: string): Plan => ({
  kind: 'ops',
  ops: [
    {
      op: 'addData',
      table: { id, name: id, fields: [{ id: 'title', name: '名字', type: 'text' }] },
    },
  ],
});

const page = (id: string): Plan => ({
  kind: 'ops',
  ops: [
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: `${id}-add`,
        look: 'button',
        show: { label: '添加', variant: 'filled' },
        tools: [{ do: 'create', table: id, ask: 'all' }],
      },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: `${id}-list`,
        look: 'list',
        source: { table: id, limit: 30 },
        show: { title: 'title' },
      },
    },
  ],
});

const green: Plan = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

const reminder: Plan = {
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
        opens: 'page:home',
      },
    },
  ],
};

const STEPS = [
  { id: 'data', kind: 'record', title: '书单表', request: '建书单表' },
  { id: 'page', kind: 'look', title: '书单列表', request: '放书单列表' },
  { id: 'remind', kind: 'record', title: '每天提醒', request: '每天提醒看书' },
  { id: 'theme', kind: 'look', title: '绿色主题', request: '主题换成绿色' },
] as const;

const SCRIPT: Record<string, Plan> = {
  建书单表: table('books'),
  放书单列表: page('books'),
  每天提醒看书: reminder,
  主题换成绿色: green,
  '搭建读书 App': { kind: 'build', summary: '一个读书 App', steps: [...STEPS] },
};

/** planFails：这些句子第一次抛错。 */
function setup(
  options: {
    repo?: MemoryWorkspaceRepo;
    fails?: string[];
    script?: Record<string, Plan>;
    /** 「把这些补上」发出去的请求回什么。 */
    fixPlan?: Plan;
  } = {},
) {
  const repo = options.repo ?? new MemoryWorkspaceRepo();
  const fails = new Set(options.fails ?? []);
  const calls: { input: string; ctx: PlanContext }[] = [];
  const hooks: { before?: (input: string) => void | Promise<void> } = {};
  const provider: AIProvider = {
    plan: async (input, ctx) => {
      calls.push({ input, ctx });
      await hooks.before?.(input);
      if (fails.delete(input)) throw new Error('model down');
      if (input.startsWith('Fix these') && options.fixPlan) return options.fixPlan;
      const plan = { ...SCRIPT, ...options.script }[input];
      if (!plan) throw new Error(`no script: ${input}`);
      return plan;
    },
  };
  const store = createWorkspaceStore({
    repo,
    provider,
    registry,
    locale: 'zh',
    now: () => new Date(2026, 10, 3, 9, 0),
  });
  return { repo, store, calls, hooks };
}

async function booted(options: Parameters<typeof setup>[0] = {}) {
  const t = setup(options);
  await t.store.getState().boot();
  return t;
}

const phase = (store: WorkspaceStore) => store.getState().build?.phase;
const statuses = (store: WorkspaceStore) => store.getState().build?.steps.map((s) => s.status);
const planned = (store: WorkspaceStore) =>
  store.getState().draft?.steps.at(-1)?.config ?? store.getState().config!;

describe('大工程先出计划', () => {
  it('新用户说大工程：看到计划，什么都没改，点「开始」才调模型（底线 16）', async () => {
    const { store, calls } = await booted();
    const headId = store.getState().head!.id;
    expect(await store.getState().change('搭建读书 App')).toEqual({ kind: 'build' });
    expect(phase(store)).toBe('review');
    expect(store.getState().head!.id).toBe(headId);
    expect(calls).toHaveLength(1);
    expect(store.getState().session.items).toEqual([]);
  });

  it('删掉一步再开始：那一步不做', async () => {
    const { store, calls } = await booted();
    await store.getState().change('搭建读书 App');
    await store.getState().removeBuildStep('remind');
    await store.getState().startBuild();
    expect(phase(store)).toBe('finished');
    expect(calls.map((c) => c.input)).toEqual([
      '搭建读书 App',
      '建书单表',
      '放书单列表',
      '主题换成绿色',
    ]);
    expect(remindersOf(store.getState().config!)).toEqual([]);
  });

  it('步骤被删光：计划没了，不能开始', async () => {
    const { store, calls } = await booted();
    await store.getState().change('搭建读书 App');
    for (const s of STEPS) await store.getState().removeBuildStep(s.id);
    expect(store.getState().build).toBeNull();
    await store.getState().startBuild();
    expect(calls).toHaveLength(1);
  });

  it('小改不出计划', async () => {
    const { store } = await booted();
    expect(await store.getState().change('主题换成绿色')).toMatchObject({ kind: 'drafted' });
    expect(store.getState().build).toBeNull();
  });

  it('在草稿聊天框里说大工程也一样出计划', async () => {
    const { store } = await booted();
    await store.getState().change('主题换成绿色');
    expect(await store.getState().draftChange('搭建读书 App')).toEqual({ kind: 'build' });
    expect(phase(store)).toBe('review');
  });
});

describe('一步一步做', () => {
  it('功能直接生效，外观进草稿（底线 7）；每步一次调用，带清单和步骤位置', async () => {
    const { store, calls } = await booted();
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    expect(phase(store)).toBe('finished');
    expect(statuses(store)).toEqual(['done', 'done', 'done', 'done']);

    const { config, draft } = store.getState();
    // 功能进了正式版本。
    expect(config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    expect(remindersOf(config!).map((r) => r.id)).toEqual(['read']);
    // 外观还在草稿里，没有打开，等用户看。
    expect(config!.theme.primaryColor).not.toBe('#2F9E44');
    expect(draft).toMatchObject({ open: false });
    expect(draft!.steps.map((s) => s.input)).toEqual(['放书单列表', '主题换成绿色']);
    expect(draft!.steps.at(-1)!.config.theme.primaryColor).toBe('#2F9E44');

    const steps = calls.slice(1);
    expect(steps.map((c) => c.ctx.session?.step)).toEqual([
      { index: 1, total: 4, remaining: 3 },
      { index: 2, total: 4, remaining: 2 },
      { index: 3, total: 4, remaining: 1 },
      { index: 4, total: 4, remaining: 0 },
    ]);
    expect(steps[0]!.ctx.session!.goal).toBe('一个读书 App');
    // 第二步看得到上一步做好的表。
    expect(steps[1]!.ctx.config.data.tables.some((t) => t.id === 'books')).toBe(true);
    // 正在做的不用再列一遍，后面的都在。
    expect(steps[1]!.ctx.session!.open.map((i) => i.text)).toEqual([
      '每天提醒看书',
      '主题换成绿色',
    ]);
    // 不弹一串「已改好 · 撤销」。
    await store.getState().markRendered(store.getState().head!.id);
    expect(store.getState().banner).toBeNull();
  });

  it('全部结束后整体检查：工具都能用，清单全做好；应用草稿走现有确认', async () => {
    const { store } = await booted();
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    expect(openItems(store.getState().session)).toEqual([]);
    expect(
      checkTools(planned(store), registry).issues.filter((i) => i.severity === 'blocker'),
    ).toEqual([]);
    store.getState().openDraft();
    await store.getState().applyDraft();
    expect(store.getState().config!.theme.primaryColor).toBe('#2F9E44');
    await store.getState().endBuild();
    expect(store.getState().build).toBeNull();
  });

  it('8 步也能走完', async () => {
    const steps = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      kind: 'record' as const,
      title: `表 ${i}`,
      request: `建表${i}`,
    }));
    const script: Record<string, Plan> = { 大的: { kind: 'build', summary: '大的', steps } };
    for (let i = 0; i < 8; i++) script[`建表${i}`] = table(`t${i}`);
    const { store } = await booted({ script });
    await store.getState().change('大的');
    await store.getState().startBuild();
    expect(phase(store)).toBe('finished');
    expect(store.getState().config!.data.tables).toHaveLength(8);
  });

  it('一步里功能做完还剩外观（next）：同一步接着做，不用用户再点', async () => {
    const script: Record<string, Plan> = {
      建书单表: { ...table('books'), next: '放书单列表' } as Plan,
    };
    const { store, calls } = await booted({ script });
    await store.getState().change('搭建读书 App');
    await store.getState().removeBuildStep('page');
    await store.getState().startBuild();
    expect(calls.map((c) => c.input).slice(1, 3)).toEqual(['建书单表', '放书单列表']);
    expect(store.getState().next).toBeNull();
    expect(openItems(store.getState().session)).toEqual([]);
  });
});

describe('一步失败', () => {
  it('模型失败就停下，已做的留着；重试接着做', async () => {
    const { store } = await booted({ fails: ['放书单列表'] });
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    expect(phase(store)).toBe('failed');
    expect(statuses(store)).toEqual(['done', 'failed', 'todo', 'todo']);
    expect(store.getState().build!.steps[1]!.reason).toBe('AI 这一步没有回答，可以重试。');
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    expect(store.getState().session.items.find((i) => i.text === '放书单列表')!.status).toBe(
      'failed',
    );

    await store.getState().resumeBuild();
    expect(phase(store)).toBe('finished');
    expect(openItems(store.getState().session)).toEqual([]);
  });

  it('不合法就停下；跳过接着做后面的', async () => {
    const script: Record<string, Plan> = {
      每天提醒看书: {
        kind: 'ops',
        ops: [{ op: 'removeData', table: 'nothing' }],
      },
    };
    const { store } = await booted({ script });
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    expect(phase(store)).toBe('failed');
    expect(statuses(store)).toEqual(['done', 'done', 'failed', 'todo']);
    await store.getState().skipBuildStep();
    expect(phase(store)).toBe('finished');
    expect(statuses(store)).toEqual(['done', 'done', 'skipped', 'done']);
    expect(store.getState().session.items.find((i) => i.text === '每天提醒看书')!.status).toBe(
      'skipped',
    );
  });

  it('仍有 blocker 就停下，说明原因（最后一步没有后面的步骤放过它）', async () => {
    const script: Record<string, Plan> = {
      只有按钮: {
        kind: 'ops',
        ops: [(page('books') as Extract<Plan, { kind: 'ops' }>).ops[0]!],
      },
      两步: {
        kind: 'build',
        summary: '两步',
        steps: [
          { id: 'a', kind: 'record', title: '表', request: '建书单表' },
          { id: 'b', kind: 'look', title: '按钮', request: '只有按钮' },
        ],
      },
    };
    const { store } = await booted({ script });
    await store.getState().change('两步');
    await store.getState().startBuild();
    expect(phase(store)).toBe('failed');
    expect(store.getState().build!.steps[1]!.reason).toContain('books');
  });

  it('要用到草稿里的页面：卡住，点「应用草稿并继续」才确认草稿（底线 7）', async () => {
    const script: Record<string, Plan> = {
      放书单列表: {
        kind: 'ops',
        ops: [
          {
            op: 'addContainer',
            page: {
              id: 'shelf',
              title: '书架',
              blocks: (page('books') as never as { ops: { block: object }[] }).ops.map(
                (o) => o.block,
              ),
            },
          },
        ],
      } as never,
      每天提醒看书: {
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
    const { store } = await booted({ script });
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    expect(phase(store)).toBe('failed');
    const stuck = store.getState().build!.steps[2]!;
    expect(stuck).toMatchObject({ status: 'failed', needsDraft: true });
    expect(stuck.reason).toBe('这一步要用到草稿里的页面。');
    expect(store.getState().config!.containers.pages.some((p) => p.id === 'shelf')).toBe(false);

    await store.getState().applyDraftForBuild();
    expect(phase(store)).toBe('finished');
    expect(store.getState().config!.containers.pages.some((p) => p.id === 'shelf')).toBe(true);
    expect(remindersOf(store.getState().config!).map((r) => r.id)).toEqual(['read']);
  });

  it('模型在一步里又回计划或撤销：算这一步失败，不会连着开新计划', async () => {
    const script: Record<string, Plan> = {
      放书单列表: { kind: 'build', summary: '又一份', steps: [...STEPS] },
      每天提醒看书: { kind: 'restorePrevious' },
    };
    const { store } = await booted({ script });
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    expect(phase(store)).toBe('failed');
    expect(store.getState().build!.summary).toBe('一个读书 App');
    await store.getState().skipBuildStep();
    expect(phase(store)).toBe('failed');
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
  });
});

describe('停止和继续', () => {
  it('中途停止：模型回来了也不应用，做好的留着；继续从这一步接着做', async () => {
    const { store, hooks } = await booted();
    await store.getState().change('搭建读书 App');
    hooks.before = async (input) => {
      if (input === '放书单列表') await store.getState().stopBuild();
    };
    await store.getState().startBuild();
    hooks.before = undefined;
    expect(phase(store)).toBe('paused');
    expect(statuses(store)).toEqual(['done', 'todo', 'todo', 'todo']);
    expect(store.getState().draft).toBeNull();

    await store.getState().resumeBuild();
    expect(phase(store)).toBe('finished');
    expect(statuses(store)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('重启后不自动继续（底线 16）：一次模型都不调，停在没做完的步骤，用户点了才接着做', async () => {
    const repo = new MemoryWorkspaceRepo();
    const first = await booted({ repo });
    await first.store.getState().change('搭建读书 App');
    first.hooks.before = async (input) => {
      // 第二步做到一半进程没了：不让这一轮结束。
      if (input === '放书单列表') await new Promise(() => {});
    };
    void first.store.getState().startBuild();
    await new Promise((r) => setTimeout(r, 20));
    expect(statuses(first.store)).toEqual(['done', 'running', 'todo', 'todo']);

    const again = await booted({ repo });
    expect(again.calls).toEqual([]);
    expect(phase(again.store)).toBe('paused');
    expect(statuses(again.store)).toEqual(['done', 'todo', 'todo', 'todo']);
    expect(again.store.getState().session.goal).toBe('一个读书 App');

    await again.store.getState().resumeBuild();
    expect(phase(again.store)).toBe('finished');
    expect(again.calls.map((c) => c.input)).toEqual(['放书单列表', '每天提醒看书', '主题换成绿色']);
  });

  it('停下后结束：做好的留着，没做的留在清单里', async () => {
    const { store } = await booted({ fails: ['放书单列表'] });
    await store.getState().change('搭建读书 App');
    await store.getState().startBuild();
    await store.getState().stopBuild();
    expect(phase(store)).toBe('paused');
    await store.getState().endBuild();
    expect(store.getState().build).toBeNull();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    expect(openItems(store.getState().session).map((i) => i.text)).toEqual([
      '放书单列表',
      '每天提醒看书',
      '主题换成绿色',
    ]);
  });

  it('计划看到一半重启：计划还在，没有开始', async () => {
    const repo = new MemoryWorkspaceRepo();
    const first = await booted({ repo });
    await first.store.getState().change('搭建读书 App');
    const again = await booted({ repo });
    expect(phase(again.store)).toBe('review');
    expect(again.calls).toEqual([]);
  });
});

describe('工具清单（D-414）', () => {
  it('不在草稿聊天框里也带上之前说过的话和还差的项', async () => {
    const script: Record<string, Plan> = {
      建书单表: { ...table('books'), next: '放书单列表' } as Plan,
    };
    const { store, calls } = await booted({ script });
    await store.getState().change('建书单表');
    await store.getState().change('每天提醒看书');
    const session = calls.at(-1)!.ctx.session!;
    expect(session.recent[0]).toMatchObject({ input: '建书单表', done: true });
    expect(session.open).toEqual([{ kind: 'look', text: '放书单列表', status: 'todo' }]);
  });

  it('随 App 重启保留；清空后不再发', async () => {
    const repo = new MemoryWorkspaceRepo();
    const first = await booted({ repo });
    await first.store.getState().change('建书单表');
    const again = await booted({ repo });
    expect(again.store.getState().session.items[0]).toMatchObject({
      text: '建书单表',
      status: 'done',
    });
    await again.store.getState().clearSession();
    await again.store.getState().change('每天提醒看书');
    expect(again.calls.at(-1)!.ctx.session).toBeUndefined();
    const third = await booted({ repo });
    expect(third.store.getState().session.said.map((s) => s.input)).toEqual(['每天提醒看书']);
  });

  it('新用户、旧版 App 没有清单：空的，照常用；旧草稿里说过的话接过来', async () => {
    const fresh = await booted();
    expect(fresh.store.getState().session).toEqual({ items: [], said: [] });

    const repo = new MemoryWorkspaceRepo();
    const first = await booted({ repo });
    await first.store.getState().change('主题换成绿色');
    await repo.setMeta('session', '');
    const again = await booted({ repo });
    expect(again.store.getState().session.said.map((s) => s.input)).toEqual(['主题换成绿色']);
    expect(again.store.getState().session.items).toEqual([]);
  });

  it('存坏了也当空的', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.setMeta('session', '{broken');
    await repo.setMeta('build', '{broken');
    const { store } = await booted({ repo });
    expect(store.getState().status).toBe('ready');
    expect(store.getState().session).toEqual({ items: [], said: [] });
    expect(store.getState().build).toBeNull();
  });

  it('模型说做了也没用：还有 blocker 就是 failed，补上后代码判定做好', async () => {
    const script: Record<string, Plan> = {
      只有按钮: {
        kind: 'ops',
        ops: [(page('books') as Extract<Plan, { kind: 'ops' }>).ops[0]!],
      },
      加列表: {
        kind: 'ops',
        ops: [(page('books') as Extract<Plan, { kind: 'ops' }>).ops[1]!],
      },
    };
    const { store } = await booted({ script });
    await store.getState().change('建书单表');
    await store.getState().change('只有按钮');
    const item = store.getState().session.items[1]!;
    expect(item).toMatchObject({ text: '只有按钮', status: 'failed' });
    expect(item.reason).toContain('books');
    // 列表进了草稿：也算改完之后看到的样子。
    await store.getState().draftChange('加列表');
    expect(openItems(store.getState().session)).toEqual([]);
    expect(store.getState().session.items[1]!.reason).toBeUndefined();
  });

  it('撤销之后：那句话告诉模型没做，清单不算做了', async () => {
    const { store, calls } = await booted();
    await store.getState().change('每天提醒看书');
    await store.getState().markRendered(store.getState().head!.id);
    await store.getState().undo();
    await store.getState().change('建书单表');
    expect(calls.at(-1)!.ctx.session!.recent[0]).toMatchObject({
      input: '每天提醒看书',
      done: false,
    });
    expect(store.getState().session.items[0]!.status).toBe('skipped');
  });

  it('草稿退一步、删草稿：那句不算说过', async () => {
    const { store } = await booted();
    await store.getState().change('主题换成绿色');
    await store.getState().deleteDraft();
    expect(store.getState().session.said).toEqual([]);
    expect(store.getState().session.items[0]!.status).toBe('skipped');
  });
});

describe('把这些补上（D-418）', () => {
  /** 有添加按钮、没有地方看的表：books 用不了。 */
  const addOnly = (id: string): Plan => ({
    kind: 'ops',
    ops: [(page(id) as Extract<Plan, { kind: 'ops' }>).ops[0]!],
  });
  const listOnly = (id: string): Plan => ({
    kind: 'ops',
    ops: [(page(id) as Extract<Plan, { kind: 'ops' }>).ops[1]!],
  });
  const FIX = 'Fix these so the app can be used:\n';
  const problems = (store: WorkspaceStore) => {
    const s = store.getState();
    return sessionProblems(s.session, planned(store), registry);
  };
  it('没有问题：不发请求', async () => {
    const { store, calls } = await booted();
    await store.getState().change('主题换成绿色');
    const count = calls.length;
    expect(await store.getState().fixProblems()).toBeNull();
    expect(calls).toHaveLength(count);
  });

  it('点一次发一次请求：模型看到英文的问题，用户记录里是自己的语言，不多一项清单', async () => {
    const t = await booted({
      fixPlan: listOnly('books'),
      script: { 建书单表: table('books'), 放添加按钮: addOnly('books') },
    });
    const { store, calls } = t;
    await store.getState().change('建书单表');
    await store.getState().change('放添加按钮');
    const items = store.getState().session.items.length;
    const count = calls.length;
    const before = problems(store)[0]!;

    expect(await store.getState().fixProblems()).toMatchObject({ kind: 'drafted' });
    expect(calls).toHaveLength(count + 1);
    expect(calls.at(-1)!.input).toBe(`${FIX}- ${before.message}`);
    expect(store.getState().session.said.at(-1)!.input).toBe('把这些补上');
    expect(store.getState().session.items).toHaveLength(items);
    expect(store.getState().draft!.steps.at(-1)!.input).toBe('把这些补上');
    // 外观进草稿（底线 7）：正式版本还没变，草稿里问题没了。
    expect(problems(store)).toEqual([]);
    expect(await store.getState().fixProblems()).toBeNull();
    expect(calls).toHaveLength(count + 1);
  });

  it('功能修改直接生效，能撤销（底线 7）', async () => {
    const { store } = await booted({
      fixPlan: table('films'),
      script: { 建书单表: table('books'), 放添加按钮: addOnly('books') },
    });
    await store.getState().change('建书单表');
    await store.getState().change('放添加按钮');
    const head = store.getState().head!.id;
    expect(await store.getState().fixProblems()).toMatchObject({ kind: 'applied' });
    expect(store.getState().head!.id).not.toBe(head);
    expect(store.getState().config!.data.tables.map((x) => x.id)).toContain('films');
  });

  it('问题还在：可以再点；不自动循环', async () => {
    const t = await booted({
      fixPlan: green,
      script: { 建书单表: table('books'), 放添加按钮: addOnly('books') },
    });
    const { store, calls } = t;
    await store.getState().change('建书单表');
    await store.getState().change('放添加按钮');
    const count = calls.length;
    await store.getState().fixProblems();
    expect(calls).toHaveLength(count + 1);
    expect(problems(store)).not.toEqual([]);
    await store.getState().fixProblems();
    expect(calls).toHaveLength(count + 2);
  });

  it('模型拒绝：什么都没改，还能再点，不多一项清单', async () => {
    const { store } = await booted({
      fixPlan: { kind: 'reject', reason: 'unknown', message: '不会', examples: [] },
      script: { 建书单表: table('books'), 放添加按钮: addOnly('books') },
    });
    await store.getState().change('建书单表');
    await store.getState().change('放添加按钮');
    const items = store.getState().session.items.length;
    expect(await store.getState().fixProblems()).toMatchObject({ kind: 'rejected' });
    expect(store.getState().session.items).toHaveLength(items);
    expect(problems(store)).not.toEqual([]);
  });

  it('会话开始前就有的问题不算；别的会话也不算', async () => {
    const repo = new MemoryWorkspaceRepo();
    const first = await booted({
      repo,
      script: { 建书单表: table('books'), 放添加按钮: addOnly('books') },
    });
    await first.store.getState().change('建书单表');
    await first.store.getState().change('放添加按钮');
    await first.store.getState().clearSession();

    const { store, calls } = await booted({ repo });
    await store.getState().change('主题换成绿色');
    expect(store.getState().session.startIssues).toEqual(['view-missing|table:books']);
    expect(problems(store)).toEqual([]);
    const count = calls.length;
    expect(await store.getState().fixProblems()).toBeNull();
    expect(calls).toHaveLength(count);
  });

  it('草稿里的问题也算：草稿拿掉列表，正式版本还好好的', async () => {
    const remove: Plan = {
      kind: 'ops',
      ops: [{ op: 'removeContainer', page: 'home', block: 'books-list' }],
    };
    const { store } = await booted({
      script: {
        建书单表: table('books'),
        放页面: page('books'),
        拿掉列表: remove,
      },
    });
    await store.getState().change('建书单表');
    await store.getState().change('放页面');
    await store.getState().applyDraft();
    expect(problems(store)).toEqual([]);
    await store.getState().change('拿掉列表');
    expect(store.getState().draft).not.toBeNull();
    expect(
      checkTools(store.getState().config!, registry).issues.filter((i) => i.severity === 'blocker'),
    ).toEqual([]);
    expect(problems(store).map((i) => i.target)).toEqual(['table:books']);
  });

  it('重启后起点还在', async () => {
    const repo = new MemoryWorkspaceRepo();
    const a = await booted({
      repo,
      script: { 建书单表: table('books'), 放添加按钮: addOnly('books') },
    });
    await a.store.getState().change('建书单表');
    await a.store.getState().change('放添加按钮');
    const b = await booted({ repo });
    expect(problems(b.store).map((i) => i.target)).toEqual(['table:books']);
  });
});
