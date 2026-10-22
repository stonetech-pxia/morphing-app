import { describe, expect, it } from 'vitest';

import { prepareSnapshot } from './change';
import { migrateWorkspace, type Migration } from './migrate';
import { registry, workspace } from './test-helpers';

// 目前只有 schemaVersion 1，所以用一个虚构的 v0 → v1 迁移来验证迁移机制本身。
// 第一次真正提升版本时，应在这里加入真实的旧版本快照作为回归测试。
const v0Snapshot = (() => {
  const { schemaVersion: _, theme, ...rest } = workspace('zh', { withPdf: true });
  return { ...rest, schemaVersion: 0, accentColor: theme.primaryColor, darkMode: false };
})();

const testMigrations: Record<number, Migration> = {
  0: ({ accentColor, darkMode, ...rest }) => ({
    ...rest,
    schemaVersion: 1,
    theme: { primaryColor: accentColor, mode: darkMode ? 'dark' : 'system' },
  }),
};

describe('migrateWorkspace', () => {
  it('upgrades an old snapshot step by step into a valid current config', () => {
    const result = migrateWorkspace(v0Snapshot, testMigrations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(0);
    expect(result.config).toEqual(workspace('zh', { withPdf: true }));
  });

  it('refuses snapshots it cannot migrate', () => {
    expect(migrateWorkspace(v0Snapshot, {})).toEqual({
      ok: false,
      error: 'no migration from schemaVersion 0',
    });
    expect(migrateWorkspace({ schemaVersion: 7 }).ok).toBe(false);
    expect(migrateWorkspace('garbage').ok).toBe(false);
  });

  it('refuses a migration that does not bump the version', () => {
    const broken: Record<number, Migration> = { 0: (c) => c };
    expect(migrateWorkspace(v0Snapshot, broken).ok).toBe(false);
  });

  it('prepareSnapshot accepts current snapshots and rejects invalid ones', () => {
    expect(prepareSnapshot(workspace(), registry).ok).toBe(true);
    const invalid = { ...workspace(), shell: { nav: ['page:home'], floating: [] } };
    const result = prepareSnapshot(invalid, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('validate');
  });
});
