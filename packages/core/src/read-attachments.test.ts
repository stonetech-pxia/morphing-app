import { describe, expect, it } from 'vitest';

import { describeChange } from './describe';
import { CURRENT_SCHEMA_VERSION } from './schema';
import { MIGRATIONS } from './migrate';
import { applyOps } from './ops';
import type { WorkspaceConfig } from './schema';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 表上的「自动读取附件」（D-397）：新记录表单读附件给候选，默认打开，只有写 false 才关。
// 是配置里唯一和它有关的东西：只读、不写，所以不是工作流，也指不到任何工具。

function withTable(): WorkspaceConfig {
  const config = workspace('en');
  config.data.tables.push({
    id: 'receipts',
    name: 'Receipts',
    fields: [{ id: 'photo', name: 'Photo', type: 'file' }],
  });
  return config;
}

describe('readAttachments', () => {
  it('is optional: an old table stays valid, and off is a plain false', () => {
    const config = withTable();
    expect(validateWorkspace(config, registry).ok).toBe(true);
    config.data.tables.at(-1)!.readAttachments = false;
    expect(validateWorkspace(config, registry).ok).toBe(true);
  });

  it('holds nothing but on or off: no workflow, no tool, no text', () => {
    const config = withTable();
    (config.data.tables.at(-1) as { readAttachments: unknown }).readAttachments = 'tool:ocr';
    expect(validateWorkspace(config, registry).ok).toBe(false);
  });

  it('can be switched with updateData, and null goes back to the default', () => {
    const off = applyOps(
      withTable(),
      [{ op: 'updateData', table: 'receipts', changes: { readAttachments: false } }],
      { registry, locale: 'en' },
    );
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.config.data.tables.at(-1)!.readAttachments).toBe(false);
    const back = applyOps(
      off.config,
      [{ op: 'updateData', table: 'receipts', changes: { readAttachments: null } }],
      { registry, locale: 'en' },
    );
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.config.data.tables.at(-1)).not.toHaveProperty('readAttachments');
  });

  it.each(['en', 'zh', 'fr'] as const)('the change is described in %s', (locale) => {
    const before = withTable();
    const lines = (value: boolean) =>
      describeChange(
        [{ op: 'updateData', table: 'receipts', changes: { readAttachments: value } }],
        before,
        [],
        { registry, locale, now: new Date(2026, 9, 31) },
      );
    expect(lines(false).join()).toContain('Receipts');
    expect(lines(false)).not.toEqual(lines(true));
  });

  it('a v34 config migrates by raising the version only', () => {
    const config = withTable();
    const v34 = { ...JSON.parse(JSON.stringify(config)), schemaVersion: 34 };
    const migrated = MIGRATIONS[34]!(v34) as WorkspaceConfig;
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(35);
    expect({ ...migrated, schemaVersion: 34 }).toEqual(v34);
  });
});

describe('out.addRecord each', () => {
  const addRecord = registry.actions.get('out.addRecord')!;
  it('is off when not written and can only be a yes or no', () => {
    expect(addRecord.params.safeParse({ collectionId: 'receipts' }).success).toBe(true);
    expect(addRecord.params.safeParse({ collectionId: 'receipts', each: true }).success).toBe(true);
    expect(addRecord.params.safeParse({ collectionId: 'receipts', each: 'x' }).success).toBe(false);
  });
});
