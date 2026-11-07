import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAppConfigFile } from './config-file';
import { prepareSnapshot } from './change';
import { newFileRefs } from './file-refs';
import { referenceProblems } from './reference-checks';
import {
  CURRENT_SCHEMA_VERSION,
  remindersOf,
  quickActionsOf,
  type WorkspaceConfig,
} from './schema';
import { checkTools } from './tool-check';
import { registry } from './test-helpers';

// 门户网站（Tinkrum 展示预设）下载的预设文件：每一份都要能在 App 里导入、迁移到当前版本、通过校验，
// 数量和说明（manifest）对得上，不带用户文件，也没有悬空引用。

const DIR = join(__dirname, 'fixtures', 'portal-presets');
interface Entry {
  id: string;
  name: string;
  file: string;
  pages: string[];
  tables: string[];
  reminders: number;
  quickActions: number;
  includesRecords: boolean;
}
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  presets: Entry[];
};
const text = (file: string) => readFileSync(join(DIR, file), 'utf8');

describe('展示预设（门户）', () => {
  it('lists the eight presets and every file exists', () => {
    expect(manifest.presets.map((p) => p.id).sort()).toHaveLength(8);
    for (const p of manifest.presets) expect(() => text(p.file)).not.toThrow();
  });

  describe.each(manifest.presets.map((p) => [p.name, p] as const))('%s', (_name, p) => {
    const raw = readAppConfigFile(text(p.file));

    it('is an app config file the app can read', () => {
      expect(raw).not.toBeNull();
    });

    const prepared = prepareSnapshot(raw, registry);

    it('migrates to the current version and passes the validator', () => {
      if (!prepared.ok) throw new Error(prepared.issues.join('\n'));
      expect(prepared.after.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('matches what the portal says about it', () => {
      if (!prepared.ok) throw new Error('not valid');
      const config = prepared.after;
      const pages = config.containers.pages.filter((pg) => !pg.id.startsWith('tool-'));
      expect(pages.map((pg) => pg.title)).toEqual(p.pages);
      expect(config.data.tables.map((t) => t.name)).toEqual(p.tables);
      expect(remindersOf(config)).toHaveLength(p.reminders);
      expect(quickActionsOf(config).filter((q) => !q.package)).toHaveLength(p.quickActions);
    });

    it('carries no user files, no records and no dangling references (底线 1、3、14、18)', () => {
      if (!prepared.ok) throw new Error('not valid');
      const config: WorkspaceConfig = prepared.after;
      // 和一份空的配置比：新增的文件引用 = 全部文件引用，必须是 0。
      expect(
        newFileRefs(
          { ...config, containers: { ...config.containers, pages: [] } } as never,
          config,
        ),
      ).toEqual([]);
      expect(referenceProblems(config, registry)).toEqual([]);
      // 严格的配置结构里没有放记录的地方；文件本身也只有这几个键。
      expect(Object.keys(config).sort()).toEqual(
        ['containers', 'data', 'nav', 'packages', 'schemaVersion', 'theme', 'tools'].sort(),
      );
      expect(p.includesRecords).toBe(false);
    });

    it('has no tool problem that would stop it from working (every table can be filled and read)', () => {
      if (!prepared.ok) throw new Error('not valid');
      const issues = checkTools(prepared.after, registry).issues;
      expect(issues.filter((i) => i.severity === 'blocker')).toEqual([]);
    });

    it('has no app of its own and keeps every page reachable from the bar or an entry', () => {
      if (!prepared.ok) throw new Error('not valid');
      const config = prepared.after;
      expect(config.nav.apps).toBeUndefined();
      expect(config.containers.pages.some((pg) => pg.app !== undefined)).toBe(false);
    });
  });
});
