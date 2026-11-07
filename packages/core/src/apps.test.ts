import { describe, expect, it } from 'vitest';

import { entryKind } from './components';
import { appOfPage, appViewOf, firstTarget } from './app-view';
import { migrateWorkspace } from './migrate';
import { applyOps, isFunctionOp, type Op } from './ops';
import { CURRENT_SCHEMA_VERSION, type WorkspaceConfig } from './schema';
import { createStarterWorkspace } from './starter';
import { registry } from './test-helpers';
import { validateWorkspace } from './validate';

// D-485：多个 app。主页是顶层的 bar + theme，其他 app 在 nav.apps；页面、表、快捷操作用 app 字段说属于谁。
const base = () => createStarterWorkspace('en', registry);

/** 一个有健身 app 的配置：自己的页面、表、底栏（app 页面 + Tink）和主题。 */
function withFitness(config: WorkspaceConfig = base()): WorkspaceConfig {
  const next = structuredClone(config);
  next.nav.apps = [
    {
      id: 'fit',
      name: 'Fitness',
      bar: ['page:fit-home', 'page:fit-plan', 'ai'],
      theme: structuredClone(next.theme),
    },
  ];
  next.containers.pages.push(
    { id: 'fit-home', title: 'Today', app: 'fit', blocks: [] },
    { id: 'fit-plan', title: 'Plan', app: 'fit', blocks: [] },
  );
  return next;
}

const codes = (config: unknown) => {
  const result = validateWorkspace(config, registry);
  return result.ok ? [] : result.issues.map((i) => i.code);
};

describe('apps（D-485）', () => {
  it('a config with an app is valid; the home config alone is unchanged', () => {
    expect(codes(withFitness())).toEqual([]);
    expect(base().nav.apps).toBeUndefined();
  });

  it('migrating a v38 config only raises the version (底线 12)', () => {
    const old = { ...structuredClone(base()), schemaVersion: 38 };
    const result = migrateWorkspace(old);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({ ...old, schemaVersion: CURRENT_SCHEMA_VERSION });
    }
  });

  it('an app, its tables and quick actions may use app:<id> buttons from home', () => {
    const config = withFitness();
    const home = config.containers.pages.find((p) => p.id === 'home')!;
    home.blocks.push({
      id: 'open-fit',
      look: 'button',
      show: { label: 'Fitness', variant: 'row' },
      opens: 'app:fit',
    } as never);
    expect(codes(config)).toEqual([]);
  });

  it('rejects an app: button that points at a missing app', () => {
    const config = withFitness();
    const home = config.containers.pages.find((p) => p.id === 'home')!;
    home.blocks.push({
      id: 'open-x',
      look: 'button',
      show: { label: 'X', variant: 'row' },
      opens: 'app:nope',
    } as never);
    expect(codes(config)).toContain('unknown-app');
  });

  it('rejects an owner that does not exist (底线 18)', () => {
    const config = withFitness();
    config.containers.pages.find((p) => p.id === 'fit-home')!.app = 'ghost';
    expect(codes(config)).toContain('unknown-app');
  });

  it('rejects a bar entry that is missing or belongs to another app / the home', () => {
    const missing = withFitness();
    missing.nav.apps![0]!.bar = ['page:nope', 'ai'];
    expect(codes(missing)).toContain('unknown-page');

    const foreign = withFitness();
    foreign.nav.apps![0]!.bar = ['page:home', 'ai'];
    expect(codes(foreign)).toContain('app-nav');
  });

  it('rejects an app page in the home bar, and a home page that belongs to an app', () => {
    const config = withFitness();
    config.nav.bar = ['page:home', 'page:fit-home', 'settings'];
    expect(codes(config)).toContain('app-nav');

    const home = withFitness();
    home.containers.pages.find((p) => p.id === 'home')!.app = 'fit';
    expect(codes(home)).toContain('app-home');
  });

  it('does not allow system pages other than Tink in an app bar', () => {
    const config = withFitness();
    (config.nav.apps![0]!.bar as string[]).push('settings');
    expect(codes(config)).toContain('schema');
  });

  it('rejects duplicate app ids', () => {
    const dup = withFitness();
    dup.nav.apps!.push({ ...structuredClone(dup.nav.apps![0]!) });
    expect(codes(dup)).toContain('duplicate');
  });
});

// ---- 操作（沿用 addContainer / updateContainer / removeContainer / setTheme，加 app 键）----

const run = (config: WorkspaceConfig, ops: Op[]) => {
  const result = applyOps(config, ops, { registry, locale: 'en' });
  if (!result.ok) throw new Error(result.error);
  return result;
};

/** 用操作搭一个健身 app：页面、一张表、一个快捷操作，主页上有入口。 */
function buildFitness(): WorkspaceConfig {
  const table = {
    id: 'workouts',
    name: 'Workouts',
    app: 'fit',
    fields: [{ id: 'name', name: 'Name', type: 'text' }],
  };
  return run(base(), [
    { op: 'addContainer', app: { id: 'fit', name: 'Fitness' } },
    { op: 'addData', table } as never,
    { op: 'addContainer', page: { id: 'fit-home', title: 'Today', app: 'fit', blocks: [] } },
    { op: 'updateContainer', app: { id: 'fit', bar: ['page:fit-home', 'ai'] } },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'open-fit',
        look: 'button',
        show: { label: 'Fitness', variant: 'row' },
        opens: 'app:fit',
      } as never,
    },
  ]).config;
}

describe('apps 的操作（D-485）', () => {
  it('builds an app from ops and the result is valid', () => {
    const config = buildFitness();
    expect(codes(config)).toEqual([]);
    const app = config.nav.apps![0]!;
    expect(app.bar).toEqual(['page:fit-home', 'ai']);
    // 新 app 的风格是主页风格的一份拷贝，不是同一个对象。
    expect(app.theme).toEqual(config.theme);
  });

  it('setTheme with app changes only that app; without app only the home', () => {
    const config = buildFitness();
    const homeBefore = JSON.stringify(config.theme);
    const next = run(config, [{ op: 'setTheme', app: 'fit', primaryColor: '#ff0000' }]).config;
    expect(next.nav.apps![0]!.theme.primaryColor).toBe('#ff0000');
    expect(JSON.stringify(next.theme)).toBe(homeBefore);
    const home = run(next, [{ op: 'setTheme', primaryColor: '#00aa00' }]).config;
    expect(home.theme.primaryColor).toBe('#00aa00');
    expect(home.nav.apps![0]!.theme.primaryColor).toBe('#ff0000');
  });

  it('removing a page takes it off the app bar; an empty bar falls back to Tink', () => {
    const next = run(buildFitness(), [{ op: 'removeContainer', page: 'fit-home' }]).config;
    expect(next.nav.apps![0]!.bar).toEqual(['ai']);
    expect(codes(next)).toEqual([]);
  });

  it('removing an app removes its pages, links and quick actions, and keeps its tables (底线 5, 18)', () => {
    const result = run(buildFitness(), [{ op: 'removeContainer', app: 'fit' }]);
    const next = result.config;
    expect(next.nav.apps).toBeUndefined();
    expect(next.containers.pages.some((p) => p.id === 'fit-home')).toBe(false);
    // 表还在，归到主页；记录按表 ID 存，不受影响。
    const table = next.data.tables.find((t) => t.id === 'workouts')!;
    expect(table.app).toBeUndefined();
    // 打开这个 app 的按钮跟着移除，没有悬空引用。
    const home = next.containers.pages.find((p) => p.id === 'home')!;
    expect(JSON.stringify(home.blocks)).not.toContain('app:fit');
    expect(codes(next)).toEqual([]);
    expect(result.notes).toContainEqual({ kind: 'removedApp', tables: ['Workouts'], links: true });
  });

  it('rejects unknown apps and duplicate app ids', () => {
    const config = buildFitness();
    expect(
      applyOps(config, [{ op: 'removeContainer', app: 'nope' }], { registry, locale: 'en' }).ok,
    ).toBe(false);
    expect(
      applyOps(config, [{ op: 'addContainer', app: { id: 'fit', name: 'Again' } }], {
        registry,
        locale: 'en',
      }).ok,
    ).toBe(false);
    expect(
      applyOps(config, [{ op: 'setTheme', app: 'nope', primaryColor: '#ff0000' }], {
        registry,
        locale: 'en',
      }).ok,
    ).toBe(false);
  });

  it('creating or removing an app, and renaming it, are function changes; its bar and style are looks', () => {
    expect(isFunctionOp({ op: 'addContainer', app: { id: 'a', name: 'A' } })).toBe(true);
    expect(isFunctionOp({ op: 'removeContainer', app: 'a' })).toBe(true);
    expect(isFunctionOp({ op: 'updateContainer', app: { id: 'a', name: 'B' } })).toBe(true);
    expect(isFunctionOp({ op: 'updateContainer', app: { id: 'a', bar: ['ai'] } })).toBe(false);
    expect(isFunctionOp({ op: 'setTheme', app: 'a', primaryColor: '#ff0000' })).toBe(false);
  });
});

describe('当前 app 视图（D-485）', () => {
  it('the home view is the top-level bar and theme; an app view is its own', () => {
    const config = withFitness();
    const home = appViewOf(config, null);
    expect(home.appId).toBeNull();
    expect(home.bar).toBe(config.nav.bar);
    expect(home.theme).toBe(config.theme);
    const fit = appViewOf(config, 'fit');
    expect(fit.bar).toEqual(['page:fit-home', 'page:fit-plan', 'ai']);
    expect(fit.floating).toEqual([]);
    expect(fit.theme).toBe(config.nav.apps![0]!.theme);
    expect(firstTarget(fit)).toBe('page:fit-home');
  });

  it('falls back to the home when the app does not exist', () => {
    expect(appViewOf(withFitness(), 'gone').appId).toBeNull();
  });

  it('a new app with only Tink has nothing to show first', () => {
    const config = run(base(), [
      { op: 'addContainer', app: { id: 'blank', name: 'Blank' } },
    ]).config;
    expect(firstTarget(appViewOf(config, 'blank'))).toBe('ai');
  });

  it('tells which app a page belongs to', () => {
    const config = withFitness();
    expect(appOfPage(config, 'fit-home')).toBe('fit');
    expect(appOfPage(config, 'home')).toBeNull();
    expect(appOfPage(config, 'nope')).toBeUndefined();
  });
});

describe('打开 app 的入口卡片（D-485）', () => {
  it('needs no title or icon: they come from the app', () => {
    const config = withFitness();
    config.containers.pages
      .find((p) => p.id === 'home')!
      .blocks.push({ id: 'fit-card', look: 'entry', opens: 'app:fit' } as never);
    expect(codes(config)).toEqual([]);
    expect(entryKind({ opens: 'app:fit' })).toBe('app');
  });
});
