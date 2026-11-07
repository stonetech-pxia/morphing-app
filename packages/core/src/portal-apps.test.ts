import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appFileFromWorkspace, appFileOps, readAppFile, type AppFile } from './app-file';
import { prepareOps } from './change';
import { newFileRefs } from './file-refs';
import { referenceProblems } from './reference-checks';
import { applyOps } from './ops';
import {
  CURRENT_SCHEMA_VERSION,
  CUSTOM_ICON_NAMES,
  HOME_PAGE_ID,
  quickActionsOf,
  remindersOf,
  type WorkspaceConfig,
} from './schema';
import { createStarterWorkspace } from './starter';
import { registry } from './test-helpers';
import { checkTools } from './tool-check';

// 门户网站的展示预设（App 文件，tinkrum-app，D-485）：每个预设是一个 App，导入时加到现有的工作区里。
// 每一份都要能读、能导入、不撞 ID、不带用户文件，导入后配置自洽；九个可以一起装（D-487 加了 Clay）。

const DIR = join(__dirname, 'fixtures', 'portal-apps');
interface Entry {
  id: string;
  name: string;
  file: string;
  icon: string;
  pages: string[];
  tables: string[];
  reminders: number;
  quickActions: number;
}
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { apps: Entry[] };
const text = (file: string) => readFileSync(join(DIR, file), 'utf8');
const NOW = new Date(2026, 10, 7);
const ctx = { registry, locale: 'en' as const, now: NOW };
const starter = () => createStarterWorkspace('en', registry);

function importApp(config: WorkspaceConfig, file: AppFile): WorkspaceConfig {
  const plan = appFileOps(file, config);
  if (!plan.ok) throw new Error(plan.error);
  const result = prepareOps(config, plan.ops, ctx);
  if (!result.ok) throw new Error(result.issues.join('\n'));
  return result.after;
}

describe('展示预设（App 文件）', () => {
  it('lists nine apps, each with its own drawn icon, and every file exists', () => {
    expect(manifest.apps).toHaveLength(9);
    expect(new Set(manifest.apps.map((a) => a.id)).size).toBe(9);
    expect(manifest.apps.map((a) => a.icon).sort()).toEqual([...CUSTOM_ICON_NAMES].sort());
    for (const a of manifest.apps) expect(() => text(a.file)).not.toThrow();
  });

  describe.each(manifest.apps.map((a) => [a.name, a] as const))('%s', (_name, entry) => {
    const file = readAppFile(text(entry.file));

    it('reads, and is on the current version', () => {
      expect(file).not.toBeNull();
      expect(file!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(file!.app.id).toBe(entry.id);
      expect(file!.app.icon).toBe(entry.icon);
    });

    it('imports into a new user workspace as one app, replacing nothing', () => {
      const before = starter();
      const after = importApp(before, file!);
      const app = after.nav.apps!.find((a) => a.id === entry.id)!;
      expect(app.name).toBe(entry.name);
      expect(app.bar[0]).toMatch(/^page:/);
      expect(app.bar.at(-1)).toBe('ai');
      const mine = (owner: string | undefined) => owner === entry.id;
      // 数量和说明对得上；全部属于这个 App。
      expect(after.containers.pages.filter((p) => mine(p.app)).map((p) => p.title)).toEqual(
        entry.pages,
      );
      expect(after.data.tables.filter((t) => mine(t.app)).map((t) => t.name)).toEqual(entry.tables);
      expect(remindersOf(after).filter((r) => mine(r.app))).toHaveLength(entry.reminders);
      expect(quickActionsOf(after).filter((q) => mine(q.app))).toHaveLength(entry.quickActions);
      // 原来的页面、表、快捷操作一个没少；主页只多了一个入口。
      for (const p of before.containers.pages) {
        const now = after.containers.pages.find((x) => x.id === p.id)!;
        if (p.id !== HOME_PAGE_ID) expect(now).toEqual(p);
      }
      const home = after.containers.pages.find((p) => p.id === HOME_PAGE_ID)!;
      expect(home.blocks).toHaveLength(
        before.containers.pages.find((p) => p.id === HOME_PAGE_ID)!.blocks.length + 1,
      );
      expect(JSON.stringify(home.blocks.at(-1))).toContain(`app:${entry.id}`);
      expect(after.theme).toEqual(before.theme);
    });

    it('is self-contained: no user files, no dangling references, nothing the tool check blocks (底线 3、14、18)', () => {
      const before = starter();
      const after = importApp(before, file!);
      expect(newFileRefs(before, after)).toEqual([]);
      expect(referenceProblems(after, registry)).toEqual([]);
      expect(checkTools(after, registry).issues.filter((i) => i.severity === 'blocker')).toEqual(
        [],
      );
    });

    it("cannot be imported twice (ids are the app's own)", () => {
      const once = importApp(starter(), file!);
      const again = appFileOps(file!, once);
      expect(again.ok).toBe(false);
      expect(!again.ok && again.error).toMatch(/already exist/);
    });

    it('can be removed again, keeping its tables (底线 5, 18)', () => {
      const once = importApp(starter(), file!);
      const removed = applyOps(once, [{ op: 'removeContainer', app: entry.id }], ctx);
      expect(removed.ok).toBe(true);
      if (!removed.ok) return;
      expect(removed.config.nav.apps).toBeUndefined();
      expect(removed.config.data.tables.length).toBe(once.data.tables.length);
      const check = prepareOps(once, [{ op: 'removeContainer', app: entry.id }], ctx);
      expect(check.ok).toBe(true);
    });
  });

  it('all nine can live in one workspace', () => {
    let config = starter();
    for (const a of manifest.apps) config = importApp(config, readAppFile(text(a.file))!);
    expect(config.nav.apps).toHaveLength(9);
    expect(referenceProblems(config, registry)).toEqual([]);
  });

  it('migrates an older file (底线 12)', () => {
    const old = text('tinkrum-app-habits.json').replace(
      `"schemaVersion": ${CURRENT_SCHEMA_VERSION}`,
      '"schemaVersion": 38',
    );
    const file = readAppFile(old);
    expect(file?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => importApp(starter(), file!)).not.toThrow();
  });

  it('ignores a file that is not an app file, and a whole-workspace config', () => {
    expect(readAppFile('nope')).toBeNull();
    expect(
      readAppFile(JSON.stringify({ format: 'morph-app-config', version: 1, config: {} })),
    ).toBeNull();
    expect(readAppFile(JSON.stringify({ format: 'tinkrum-app', version: 1 }))).toBeNull();
  });
});

describe('appFileFromWorkspace', () => {
  it('prefixes ids and moves references, but leaves field ids, block ids and text alone', () => {
    const config = applyOps(
      starter(),
      [
        {
          op: 'addData',
          table: {
            id: 'tasks',
            name: 'tasks',
            fields: [{ id: 'tasks', name: 'tasks', type: 'text' }],
          },
        } as never,
        {
          op: 'addContainer',
          page: {
            id: 'board',
            title: 'tasks',
            blocks: [
              {
                id: 'tasks',
                look: 'list',
                source: { table: 'tasks', limit: 5 },
                show: { title: 'tasks' },
              },
            ],
          },
        },
        { op: 'updateContainer', nav: { bar: ['page:home', 'page:board', 'settings'] } },
      ],
      { registry, locale: 'en' },
    );
    if (!config.ok) throw new Error(config.error);
    const file = appFileFromWorkspace(config.config, { id: 'todo', name: 'To-do', icon: 'check' });
    expect(file.app.bar).toEqual(['page:todo-home', 'page:todo-board', 'ai']);
    const table = file.tables.find((t) => t.id === 'todo-tasks')!;
    expect(table.fields[0]!.id).toBe('tasks');
    const page = file.pages.find((p) => p.id === 'todo-board')!;
    const block = page.blocks.find((b) => b.id === 'tasks') as {
      id: string;
      source: { table: string };
      show: { title: string };
    };
    expect(block.id).toBe('tasks');
    expect(block.source.table).toBe('todo-tasks');
    expect(block.show.title).toBe('tasks');
    expect(() => importApp(starter(), file as AppFile)).not.toThrow();
  });
});
