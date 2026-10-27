import {
  BUILTIN_TOOLS,
  PROTECTED_TARGETS,
  THEME_PRESET_IDS,
  applyOps,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  prepareOps,
  templateOps,
  validateWorkspace,
  type DataRecord,
  type Locale,
  type NavTarget,
  type Op,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 性质测试（§5.1、§7E）：带种子的随机修改序列，依次应用、撤销、恢复历史版本。
// ① 记录一条不少、内容不变；② 撤销和恢复后配置和当时的快照一样；③ 受保护的入口一直找得到。
// 失败时报出种子：PROPERTY_SEED=<种子> npx jest undo-property 只跑那一个。

const registry = createRegistry(BUILTIN_TOOLS);

/** mulberry32：小而确定的伪随机数，同一个种子每次得到同一串数。 */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const subset = <T,>(xs: readonly T[], min: number, max: number): T[] => {
    const pool = [...xs];
    const out: T[] = [];
    const n = Math.min(pool.length, min + int(max - min + 1));
    while (out.length < n) out.push(pool.splice(int(pool.length), 1)[0]!);
    return out;
  };
  return { next, int, pick, subset };
}
type Rng = ReturnType<typeof rng>;

/** 有一张账目表的起点：记录只在本机数据库里。 */
function seedBudget(locale: Locale, reg: Registry): WorkspaceConfig {
  const base = createDefaultWorkspace(locale);
  const result = applyOps(base, templateOps('budget', base, locale), { registry: reg, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

const RECORDS: DataRecord[] = [
  { amount: 30, category: 'food', note: '午饭', date: '2026-10-20' },
  { amount: 12.5, category: 'transport', date: '2026-10-21' },
  { amount: 99.99, note: 'a, "b"', date: '2026-01-01' },
  { amount: 0 },
  { category: 'food', note: '—' },
].map((values, i) => ({
  id: `r${i}`,
  collectionId: 'expenses',
  values,
  createdAt: i,
  updatedAt: i,
}));

const COLORS = ['#2F9E44', '#1C7ED6', '#E8590C', '#7048E8', '#C2255C', '#111111'];

/** 按当前配置随机出一步修改；可能不合法，不合法的会被校验拒绝（这也是要测的）。 */
function randomOps(r: Rng, c: WorkspaceConfig, n: number): Op[] {
  const pages = c.pages.filter((p) => !p.toolId);
  const page = r.pick(pages);
  const top = page.components;
  const lists = c.pages.flatMap((p) =>
    p.components.filter((x) => x.type === 'recordList').map((x) => ({ pageId: p.id, id: x.id })),
  );
  const targets: NavTarget[] = [
    'tools',
    'ai',
    'history',
    'settings',
    'quickActions',
    ...pages.map((p) => `page:${p.id}` as NavTarget),
  ];
  const kinds = [
    'theme',
    'preset',
    'nav',
    'floating',
    'addPage',
    'removePage',
    'addComponent',
    'removeComponent',
    'moveComponent',
    'display',
  ] as const;
  switch (r.pick(kinds)) {
    case 'theme':
      return [
        {
          op: 'setTheme',
          primaryColor: r.pick(COLORS),
          fontScale: Math.round((0.85 + r.next() * 0.65) * 100) / 100,
          density: r.pick(['compact', 'comfortable', 'spacious'] as const),
        },
      ];
    case 'preset':
      return [{ op: 'applyThemePreset', preset: r.pick(THEME_PRESET_IDS) }];
    case 'nav':
      return [{ op: 'setNavItems', items: r.subset(targets, 1, 5) }];
    case 'floating':
      return [{ op: 'setFloatingItems', items: r.subset(targets, 0, 3) }];
    case 'addPage': {
      const id = `p${n}`;
      return [
        {
          op: 'addPage',
          page: {
            id,
            title: `Page ${n}`,
            components: [{ id: 'title', type: 'header', props: { title: `Page ${n}` } }],
          },
        },
      ];
    }
    case 'removePage':
      return [{ op: 'removePage', pageId: r.pick(pages).id }];
    case 'addComponent':
      return [
        {
          op: 'addComponent',
          pageId: page.id,
          component: { id: `s${n}`, type: 'spacer', props: { size: 'small' } },
          index: r.int(top.length + 1),
        },
      ];
    case 'removeComponent':
      return top.length
        ? [{ op: 'removeComponent', pageId: page.id, componentId: r.pick(top).id }]
        : [];
    case 'moveComponent':
      return top.length
        ? [
            {
              op: 'moveComponent',
              pageId: page.id,
              componentId: r.pick(top).id,
              toIndex: r.int(top.length),
            },
          ]
        : [];
    case 'display': {
      if (!lists.length) return [];
      const list = r.pick(lists);
      return [
        {
          op: 'setComponentProps',
          pageId: list.pageId,
          componentId: list.id,
          props: { display: r.pick(['list', 'cards', 'table', 'checklist'] as const) },
        },
      ];
    }
  }
}

const clone = (c: WorkspaceConfig): WorkspaceConfig => JSON.parse(JSON.stringify(c));

/** 应用一步并确认渲染成功；被拒绝时返回 false。 */
async function commit(store: WorkspaceStore, ops: Op[]): Promise<boolean> {
  const result = await store.getState().proposeOps(ops, 'step');
  if (result.kind !== 'preview') {
    if (store.getState().proposal) await store.getState().cancel();
    return false;
  }
  await store.getState().confirm();
  await store.getState().markRendered(store.getState().head!.id);
  return true;
}

async function restore(store: WorkspaceStore, revisionId: number) {
  const result = await store.getState().proposeRestore(revisionId);
  expect(result.kind).toBe('preview');
  await store.getState().confirm();
  await store.getState().markRendered(store.getState().head!.id);
}

function protectedReachable(c: WorkspaceConfig): string | null {
  if (!validateWorkspace(c, registry).ok) return 'the configuration does not validate';
  for (const target of PROTECTED_TARGETS) {
    if (!c.shell.nav.includes(target) && !c.shell.floating.includes(target))
      return `${target} is neither in the nav bar nor a floating button`;
  }
  return null;
}

async function runSeed(seed: number, steps: number) {
  const r = rng(seed);
  const repo = new MemoryWorkspaceRepo();
  for (const record of RECORDS) await repo.insertRecord(record);
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: r.pick(['zh', 'en', 'fr'] as const),
    now: () => new Date(2026, 9, 27, 9),
    seed: seedBudget,
  });
  await store.getState().boot();
  /** 每个版本提交时的配置。 */
  const snapshots = new Map<number, WorkspaceConfig>();
  const remember = () => snapshots.set(store.getState().head!.id, clone(store.getState().config!));
  remember();
  let applied = 0;

  for (let n = 0; n < steps; n++) {
    const before = clone(store.getState().config!);
    const ops = randomOps(r, before, n);
    if (!ops.length || !(await commit(store, ops))) {
      // 被拒绝的修改不能改动任何东西。
      expect(store.getState().config).toEqual(before);
      continue;
    }
    applied++;
    remember();
    expect(protectedReachable(store.getState().config!)).toBeNull();
    // 有时马上撤销：回到这一步之前的样子。
    if (r.next() < 0.25) {
      await store.getState().undo();
      await store.getState().markRendered(store.getState().head!.id);
      expect(store.getState().config).toEqual(before);
      remember();
    }
  }

  // ② 撤销最近 N 步（恢复到 N 步之前的版本）、恢复到任意一个历史版本。
  const ids = [...snapshots.keys()].sort((a, b) => b - a);
  const back = ids[Math.min(ids.length - 1, 1 + r.int(4))]!;
  const targets = [back, r.pick(ids), ids[ids.length - 1]!];
  for (const id of targets) {
    await restore(store, id);
    expect(store.getState().config).toEqual(snapshots.get(id));
    expect(protectedReachable(store.getState().config!)).toBeNull();
  }

  // ① 记录一条不少、内容不变（撤销和恢复只管界面配置，§7E）。
  const records = await repo.listRecords('expenses');
  expect([...records].sort((a, b) => a.id.localeCompare(b.id))).toEqual(RECORDS);
  return applied;
}

const SEEDS = process.env.PROPERTY_SEED
  ? [Number(process.env.PROPERTY_SEED)]
  : Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);

describe('random change sequences (property)', () => {
  it.each(SEEDS)('seed %i: records stay, undo and restore match the snapshots', async (seed) => {
    try {
      const applied = await runSeed(seed, 25);
      // 随机序列不能全被拒绝，否则什么也没测到。
      expect(applied).toBeGreaterThan(5);
    } catch (e) {
      throw new Error(
        `seed ${seed} failed (rerun with PROPERTY_SEED=${seed}): ${(e as Error).message}`,
      );
    }
  });

  it('an extreme layout (no other pages, empty home, only the home tab) still reaches AI and History', async () => {
    const extreme = (locale: Locale, reg: Registry) => {
      const ctx = { registry: reg, locale };
      const c = seedBudget(locale, reg);
      // 先删页面（首页上指向它们的入口跟着删掉），再清空首页、只留首页一个标签。
      const pagesGone = applyOps(
        c,
        c.pages
          .filter((p) => p.id !== 'home' && !p.toolId)
          .map((p) => ({ op: 'removePage' as const, pageId: p.id })),
        ctx,
      );
      if (!pagesGone.ok) throw new Error(pagesGone.error);
      const home = pagesGone.config.pages.find((p) => p.id === 'home')!;
      // 走真正的修改协议（prepareOps）：导航栏去掉设置时内核把它改成浮动按钮（§5.1）。
      const result = prepareOps(
        pagesGone.config,
        [
          ...home.components.map((x) => ({
            op: 'removeComponent' as const,
            pageId: 'home',
            componentId: x.id,
          })),
          { op: 'setNavItems', items: ['page:home'] },
        ],
        { ...ctx, now: new Date(2026, 9, 27) },
      );
      if (!result.ok) throw new Error(result.issues.join('; '));
      // 再把浮动按钮也清空：校验器拒绝。
      expect(
        prepareOps(result.after, [{ op: 'setFloatingItems', items: [] }], {
          ...ctx,
          now: new Date(2026, 9, 27),
        }).ok,
      ).toBe(false);
      return result.after;
    };
    const repo = new MemoryWorkspaceRepo();
    for (const record of RECORDS) await repo.insertRecord(record);
    const { store } = await renderToolsApp(repo, undefined, { seed: extreme });
    const config = store.getState().config!;
    expect(config.shell.nav).toEqual(['page:home']);
    expect(config.shell.floating).toEqual(['settings']);
    await fireEvent.press(await screen.findByTestId('floating-settings'));
    expect(await screen.findByTestId('settings-ai')).toBeTruthy();
    expect(screen.getByTestId('settings-history')).toBeTruthy();
    expect((await repo.listRecords('expenses')).length).toBe(RECORDS.length);
  });
});
