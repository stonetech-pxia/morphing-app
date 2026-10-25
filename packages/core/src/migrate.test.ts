import { describe, expect, it } from 'vitest';

import { prepareSnapshot } from './change';
import { migrateWorkspace, type Migration } from './migrate';
import { registry, workspace } from './test-helpers';
import { V4_CUSTOM_ASK, V4_DEFAULT_MERGE, V4_FIXED_NAME } from './fixtures/v4';
import { DEFAULT_THEME } from './theme';
import { CURRENT_SCHEMA_VERSION } from './schema';

/** schemaVersion 1 的真实快照：装了 PDF，导航栏已精简，AI 和历史是浮动按钮。 */
const v1Snapshot = {
  schemaVersion: 1,
  theme: { primaryColor: '#3B5BDB', mode: 'system' },
  shell: { nav: ['page:home', 'tools', 'settings'], floating: ['ai', 'history'] },
  pages: [
    {
      id: 'home',
      title: '文件工作台',
      components: [
        { id: 'welcome', type: 'header', props: { title: '文件工作台', subtitle: '副标题' } },
        { id: 'card-pdf', type: 'toolCard', props: { toolId: 'pdf' } },
        { id: 'catalog', type: 'catalogLink', props: { title: '添加工具' } },
        { id: 'recent-files', type: 'fileList', props: { title: '最近文件', limit: 5 } },
      ],
    },
    {
      id: 'tool-pdf',
      title: 'PDF',
      toolId: 'pdf',
      components: [
        { id: 'pdf-header', type: 'header', props: { title: '合并 PDF' } },
        { id: 'pdf-runner', type: 'workflowRunner', props: { workflowId: 'pdf-merge' } },
      ],
    },
  ],
  tools: [{ toolId: 'pdf', version: '1.0.0', pageId: 'tool-pdf' }],
  workflows: [
    {
      id: 'pdf-merge',
      toolId: 'pdf',
      name: '合并 PDF',
      steps: [
        { id: 'select', action: 'pdf.selectFiles', params: { min: 2, max: 20 } },
        { id: 'merge', action: 'pdf.merge', params: {} },
        { id: 'save', action: 'file.save', params: { nameTemplate: '合并-{date:YYYY-MM-DD}' } },
      ],
    },
  ],
};

describe('migrateWorkspace', () => {
  it('v10 → v11 preserves the entire existing workspace', () => {
    const previous = { ...workspace(), schemaVersion: 10 };
    const result = prepareSnapshot(previous, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.after).toEqual({ ...previous, schemaVersion: 11 });
    expect(previous.schemaVersion).toBe(10);
  });
  it('v9 → v10 preserves the existing home without adding file pickers', () => {
    const previous = { ...workspace(), schemaVersion: 9 };
    const original = structuredClone(previous);
    const result = prepareSnapshot(previous, registry);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.after).toEqual({ ...previous, schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(previous).toEqual(original);
  });

  it('upgrades a real v1 snapshot into a valid v2 config with the default style', () => {
    const result = prepareSnapshot(v1Snapshot, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 没改过的 v1 默认主色换成 Clay 主色；外观模式保留。
    expect(result.after.theme).toEqual({ ...DEFAULT_THEME, mode: 'system' });
    expect(result.after.shell).toEqual(v1Snapshot.shell);
    expect(result.after.pages[0]).toEqual({ ...v1Snapshot.pages[0], icon: 'home' });
    expect(result.after.pages[1]).toEqual(v1Snapshot.pages[1]);
  });

  it('keeps a color the user chose, and puts Settings back where v1 allowed it to be missing', () => {
    const custom = {
      ...v1Snapshot,
      theme: { primaryColor: '#2F9E44', mode: 'dark' },
      shell: { nav: ['page:home', 'ai', 'history'], floating: [] },
    };
    const result = prepareSnapshot(custom, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.theme).toMatchObject({ primaryColor: '#2F9E44', mode: 'dark' });
    expect(result.after.shell.nav).toEqual(['page:home', 'ai', 'history', 'settings']);

    const fullNav = {
      ...v1Snapshot,
      shell: { nav: ['page:home', 'tools', 'ai', 'history', 'page:tool-pdf'], floating: [] },
    };
    const full = prepareSnapshot(fullNav, registry);
    expect(full.ok && full.after.shell.floating).toEqual(['settings']);
  });

  it('turns the v1 merge workflow into typed steps with a fixed name', () => {
    const result = prepareSnapshot(v1Snapshot, registry);
    expect(result.ok && result.after.workflows[0]!.steps).toEqual([
      { id: 'select', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } },
      { id: 'merge', action: 'pdf.merge', params: {} },
      { id: 'name', action: 'file.rename', params: { template: '合并-{date:YYYY-MM-DD}' } },
      { id: 'save', action: 'file.save', params: {} },
    ]);
  });

  it('v4 → v5: the default merge asks for the file name at the rename step', () => {
    const result = prepareSnapshot(V4_DEFAULT_MERGE, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.workflows).toEqual([
      {
        id: 'pdf-merge',
        toolId: 'pdf',
        name: '合并 PDF',
        steps: [
          { id: 'select', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } },
          { id: 'merge', action: 'pdf.merge', params: {} },
          {
            id: 'name',
            action: 'file.rename',
            params: { template: '{sourceName}-合并' },
            ask: ['template'],
          },
          { id: 'save', action: 'file.save', params: {} },
        ],
      },
    ]);
    // 页面和其他配置不变。
    expect(result.after.pages).toEqual(V4_DEFAULT_MERGE.pages);
  });

  it('v4 → v5: a workflow that no longer asked keeps its fixed name template', () => {
    const result = prepareSnapshot(V4_FIXED_NAME, registry);
    expect(result.ok && result.after.workflows[0]!.steps.slice(2)).toEqual([
      { id: 'name', action: 'file.rename', params: { template: '合并-{date:YYYY-MM-DD}' } },
      { id: 'save', action: 'file.save', params: {} },
    ]);
  });

  it('v4 → v5: the name the user was asked with wins over the save template', () => {
    const result = prepareSnapshot(V4_CUSTOM_ASK, registry);
    expect(result.ok && result.after.workflows[0]!.steps).toEqual([
      { id: 'select', action: 'in.files', params: { accept: 'pdf', min: 3, max: 5 } },
      { id: 'merge', action: 'pdf.merge', params: {} },
      {
        id: 'name',
        action: 'file.rename',
        params: { template: '材料-{date:YYYYMMDD}' },
        ask: ['template'],
      },
      { id: 'save', action: 'file.save', params: {} },
    ]);
  });

  it('v5 → v6: only bumps the version', () => {
    const v5 = { ...workspace(), schemaVersion: 5 };
    const result = prepareSnapshot(v5, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.after).toEqual(workspace());
  });

  it('v6 → v7: only bumps the version; file lists can now show one kind of file', () => {
    const v6 = { ...workspace(), schemaVersion: 6 };
    const result = prepareSnapshot(v6, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.after).toEqual(workspace());
  });

  it('v8 → v9: only bumps the version; tool grids are new', () => {
    const v8 = { ...workspace(), schemaVersion: 8 };
    const result = prepareSnapshot(v8, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.after).toEqual(workspace());
  });

  it('refuses snapshots it cannot migrate', () => {
    const v0 = { ...v1Snapshot, schemaVersion: 0 };
    expect(migrateWorkspace(v0)).toEqual({ ok: false, error: 'no migration from schemaVersion 0' });
    expect(migrateWorkspace({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }).ok).toBe(false);
    expect(migrateWorkspace('garbage').ok).toBe(false);
  });

  it('refuses a migration that does not bump the version', () => {
    const broken: Record<number, Migration> = { 1: (c) => c };
    expect(migrateWorkspace(v1Snapshot, broken).ok).toBe(false);
  });

  it('prepareSnapshot accepts current snapshots and rejects invalid ones', () => {
    expect(prepareSnapshot(workspace(), registry).ok).toBe(true);
    const invalid = { ...workspace(), shell: { nav: ['page:home'], floating: [] } };
    const result = prepareSnapshot(invalid, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('validate');
  });
});
