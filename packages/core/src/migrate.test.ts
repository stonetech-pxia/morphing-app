import { describe, expect, it } from 'vitest';

import { prepareSnapshot } from './change';
import { migrateWorkspace, type Migration } from './migrate';
import { registry, workspace } from './test-helpers';
import { DEFAULT_THEME } from './theme';

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

  it('upgrades a v4 snapshot by only bumping the version', () => {
    const v4 = { ...workspace(), schemaVersion: 4 };
    const result = prepareSnapshot(v4, registry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.after).toEqual(workspace());
  });

  it('refuses snapshots it cannot migrate', () => {
    const v0 = { ...v1Snapshot, schemaVersion: 0 };
    expect(migrateWorkspace(v0)).toEqual({ ok: false, error: 'no migration from schemaVersion 0' });
    expect(migrateWorkspace({ schemaVersion: 7 }).ok).toBe(false);
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
