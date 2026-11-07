import { describe, expect, it } from 'vitest';

import { prepareOps, type ChangeContext } from './change';
import type { Op } from './ops';
import { applyOps } from './ops';
import type { WorkspaceConfig } from './schema';
import { createStarterWorkspace } from './starter';
import { registry } from './test-helpers';

// 在 app 里改（D-485，暂定规则）：只能改这个 app 自己的东西，超出的整个拒绝；不带 scope（主页）改整个工作区。

const ctx = (appId?: string): ChangeContext => ({
  registry,
  locale: 'en',
  now: new Date(2026, 10, 7),
  fromAI: true,
  ...(appId ? { scope: { appId } } : {}),
});

const text = (id: string) => ({ id, name: id, type: 'text' as const });
const table = (id: string, app?: string) => ({
  id,
  name: id,
  ...(app ? { app } : {}),
  fields: [text('title')],
});

/** 主页 + 两个 app（fit、cook），主页有一张共用的表 notes，每个 app 各有一张自己的表。 */
function world(): WorkspaceConfig {
  const ops: Op[] = [
    { op: 'addContainer', app: { id: 'fit', name: 'Fitness' } },
    { op: 'addContainer', app: { id: 'cook', name: 'Cooking' } },
    { op: 'addData', table: table('notes') } as never,
    { op: 'addData', table: table('workouts', 'fit') } as never,
    { op: 'addData', table: table('recipes', 'cook') } as never,
    { op: 'addContainer', page: { id: 'fit-home', title: 'Today', app: 'fit', blocks: [] } },
    { op: 'addContainer', page: { id: 'cook-home', title: 'Menu', app: 'cook', blocks: [] } },
    { op: 'updateContainer', app: { id: 'fit', bar: ['page:fit-home', 'ai'] } },
    { op: 'updateContainer', app: { id: 'cook', bar: ['page:cook-home', 'ai'] } },
  ];
  const result = applyOps(createStarterWorkspace('en', registry), ops, { registry, locale: 'en' });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

const listOf = (id: string, tableId: string) => ({
  id,
  look: 'list',
  source: { table: tableId, limit: 10 },
  show: { title: 'title' },
});

const issuesOf = (config: WorkspaceConfig, ops: Op[], appId?: string) => {
  const result = prepareOps(config, ops, ctx(appId));
  return result.ok ? [] : result.issues;
};

describe('app 范围（D-485）', () => {
  it('lets the app change its own pages, tables, bar and style', () => {
    const config = world();
    const result = prepareOps(
      config,
      [
        { op: 'addContainer', page: 'fit-home', block: listOf('w-list', 'workouts') as never },
        { op: 'updateData', table: 'workouts', changes: { name: 'Sessions' } },
        { op: 'setTheme', app: 'fit', primaryColor: '#2255aa' },
        { op: 'updateContainer', app: { id: 'fit', name: 'Gym' } },
      ],
      ctx('fit'),
    );
    expect(result.ok).toBe(true);
  });

  it('tags a new page, table and quick action with the app, and puts the page in its bar', () => {
    const config = world();
    const result = prepareOps(
      config,
      [
        { op: 'addData', table: table('plans') } as never,
        { op: 'addContainer', page: { id: 'fit-plan', title: 'Plan', blocks: [] } },
      ],
      ctx('fit'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.data.tables.find((t) => t.id === 'plans')!.app).toBe('fit');
    expect(result.after.containers.pages.find((p) => p.id === 'fit-plan')!.app).toBe('fit');
    expect(result.after.nav.apps!.find((a) => a.id === 'fit')!.bar).toEqual([
      'page:fit-home',
      'page:fit-plan',
      'ai',
    ]);
    // 主页没有被补入口，也没动。
    expect(result.after.containers.pages.find((p) => p.id === 'home')).toEqual(
      config.containers.pages.find((p) => p.id === 'home'),
    );
  });

  it('rejects changes to the home page, the home bar and the home style', () => {
    const config = world();
    const homeBlock = {
      id: 'hi',
      look: 'text',
      show: { text: 'hi' },
    } as never;
    expect(
      issuesOf(config, [{ op: 'addContainer', page: 'home', block: homeBlock }], 'fit'),
    ).not.toEqual([]);
    expect(
      issuesOf(config, [{ op: 'updateContainer', nav: { bar: ['page:home', 'settings'] } }], 'fit'),
    ).not.toEqual([]);
    expect(issuesOf(config, [{ op: 'setTheme', primaryColor: '#ff0000' }], 'fit')).not.toEqual([]);
    // 同样的操作从主页改是可以的。
    expect(issuesOf(config, [{ op: 'setTheme', primaryColor: '#ff0000' }])).toEqual([]);
  });

  it('rejects touching another app, even through a cascade', () => {
    const config = world();
    expect(
      issuesOf(config, [{ op: 'setTheme', app: 'cook', primaryColor: '#ff0000' }], 'fit'),
    ).not.toEqual([]);
    expect(issuesOf(config, [{ op: 'removeContainer', page: 'cook-home' }], 'fit')).not.toEqual([]);
    expect(
      issuesOf(config, [{ op: 'updateData', table: 'recipes', changes: { name: 'X' } }], 'fit'),
    ).not.toEqual([]);
    // 删一张别人在用的共用表：连带清理了主页和别的 app 的块，整个拒绝。
    const withUse = applyOps(
      config,
      [{ op: 'addContainer', page: 'home', block: listOf('n-list', 'notes') as never }],
      { registry, locale: 'en' },
    );
    if (!withUse.ok) throw new Error(withUse.error);
    expect(issuesOf(withUse.config, [{ op: 'removeData', table: 'notes' }], 'fit')).not.toEqual([]);
  });

  it('rejects removing itself or moving a thing to another app', () => {
    const config = world();
    expect(issuesOf(config, [{ op: 'removeContainer', app: 'fit' }], 'fit')).not.toEqual([]);
    expect(
      issuesOf(config, [{ op: 'addContainer', app: { id: 'extra', name: 'Extra' } }], 'fit'),
    ).not.toEqual([]);
    expect(
      issuesOf(
        config,
        [{ op: 'addContainer', page: { id: 'sneaky', title: 'S', app: 'cook', blocks: [] } }],
        'fit',
      ),
    ).not.toEqual([]);
  });

  it('only points at its own tables or the home tables', () => {
    const config = world();
    const own = issuesOf(
      config,
      [{ op: 'addContainer', page: 'fit-home', block: listOf('a', 'workouts') as never }],
      'fit',
    );
    const home = issuesOf(
      config,
      [{ op: 'addContainer', page: 'fit-home', block: listOf('b', 'notes') as never }],
      'fit',
    );
    const other = issuesOf(
      config,
      [{ op: 'addContainer', page: 'fit-home', block: listOf('c', 'recipes') as never }],
      'fit',
    );
    expect(own).toEqual([]);
    expect(home).toEqual([]);
    expect(other).not.toEqual([]);
  });

  it('home (no scope) can still change everything, including other apps', () => {
    const config = world();
    expect(
      issuesOf(config, [
        { op: 'setTheme', app: 'cook', primaryColor: '#ff0000' },
        { op: 'removeContainer', app: 'fit' },
      ]),
    ).toEqual([]);
  });

  it('a new page made from home for an app gets a way in from that app bar', () => {
    const config = world();
    const result = prepareOps(
      config,
      [{ op: 'addContainer', page: { id: 'fit-log', title: 'Log', app: 'fit', blocks: [] } }],
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.after.nav.apps!.find((a) => a.id === 'fit')!.bar).toContain('page:fit-log');
  });
});
