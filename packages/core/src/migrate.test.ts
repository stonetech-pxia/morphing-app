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
  it('v10 → v11 → v12 preserves the entire existing workspace', () => {
    const previous = { ...workspace(), schemaVersion: 10 };
    const result = prepareSnapshot(previous, registry);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.after).toEqual({ ...previous, schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(previous.schemaVersion).toBe(10);
  });
  it('v19 → v20: the text recognition quick actions stop asking the language, unless the user changed them (D-278)', () => {
    const oldRead = (lang: string) => ({
      id: 'read',
      action: 'ocr.recognize',
      params: { lang },
      ask: ['lang'],
    });
    const photos = (lang: string) => ({
      id: 'ocr-photos',
      toolId: 'ocr',
      name: '识别照片里的文字',
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 20 } },
        oldRead(lang),
      ],
    });
    const scan = {
      id: 'ocr-scan',
      toolId: 'ocr',
      name: '拍照识别文字',
      steps: [
        { id: 'shoot', action: 'in.photos', params: { source: 'scanner', min: 1, max: 10 } },
        { id: 'edges', action: 'scan.detect', params: {} },
        oldRead('fra'),
      ],
    };
    // 用户改过的：换了语言、改了张数、或者是自己的快捷操作，都不动。
    const picked = { ...photos('jpn') };
    const fewer = {
      ...photos('eng'),
      id: 'ocr-photos-2',
      steps: [
        { ...photos('eng').steps[0]!, params: { source: 'library', min: 1, max: 5 } },
        oldRead('eng'),
      ],
    };
    const own = { ...photos('chi_sim'), id: 'mine', toolId: undefined };
    const previous = {
      ...workspace('zh'),
      schemaVersion: 19,
      workflows: [photos('chi_sim'), scan, { ...picked, id: 'x' }, fewer, own],
    };
    const result = migrateWorkspace(previous, undefined, 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = (result.config as { workflows: { id: string; steps: unknown[] }[] }).workflows;
    const newRead = { id: 'read', action: 'ocr.recognize', params: { lang: 'auto' } };
    expect(after[0]!.steps[1]).toEqual(newRead);
    expect(after[1]!.steps[2]).toEqual(newRead);
    expect(after.slice(2)).toEqual(previous.workflows.slice(2));
    expect((result.config as { schemaVersion: number }).schemaVersion).toBe(20);
    // 用户换过语言的 ocr-photos：不动，照样每次按用户选的语言认。
    const custom = { ...workspace('zh'), schemaVersion: 19, workflows: [picked] };
    const kept = migrateWorkspace(custom, undefined, 20);
    expect(kept.ok && (kept.config as { workflows: unknown[] }).workflows).toEqual([picked]);
  });
  it('v31 → v32 (board by a link, sheet quick add, D-341–D-342) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 31 };
    expect(migrateWorkspace(previous, undefined, 32)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 32 },
      fromVersion: 31,
    });
  });
  it('v30 → v31 (schedule time, list sections, calendar on a schedule, add here, D-336–D-339) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 30 };
    expect(migrateWorkspace(previous, undefined, 31)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 31 },
      fromVersion: 30,
    });
  });
  it('v29 → v30 (once, countEarly, record pages, form presets and smartDate, D-330–D-334) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 29 };
    expect(migrateWorkspace(previous, undefined, 30)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 30 },
      fromVersion: 29,
    });
  });
  it('v28 → v29 (group by link, stat minus, create with form, D-326–D-328) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 28 };
    expect(migrateWorkspace(previous, undefined, 29)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 29 },
      fromVersion: 28,
    });
  });
  it('v27 → v28 (reminders per entry, D-316–D-318) only raises the version and keeps reminders', () => {
    const daily = {
      id: 'log',
      title: '记账',
      enabled: true,
      schedule: 'daily',
      time: '09:00',
      opens: 'page:home',
    };
    const previous = {
      ...workspace('zh', { withPdf: true }),
      schemaVersion: 27,
      reminders: [daily],
    };
    expect(migrateWorkspace(previous, undefined, 28)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 28 },
      fromVersion: 27,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v26 → v27 (tiles and board lists, D-311–D-314) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 26 };
    expect(migrateWorkspace(previous, undefined, 27)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 27 },
      fromVersion: 26,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v25 → v26 (calendar list, trailing formats, stat goal and compare, D-305–D-309) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 25 };
    expect(migrateWorkspace(previous, undefined, 26)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 26 },
      fromVersion: 25,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v24 → v25 (one-tap record actions, D-300–D-304) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 24 };
    expect(migrateWorkspace(previous, undefined, 25)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 25 },
      fromVersion: 24,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v23 → v24 (schedule fields and the due filter, D-292–D-296) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 23 };
    expect(migrateWorkspace(previous, undefined, 24)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 24 },
      fromVersion: 23,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v22 → v23 (lookup, rollup and previous fields, D-287–D-289) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 22 };
    expect(migrateWorkspace(previous, undefined, 23)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 23 },
      fromVersion: 22,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v21 → v22 (day-based aggregates, new periods and calendar, D-284–D-286) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 21 };
    expect(migrateWorkspace(previous, undefined, 22)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 22 },
      fromVersion: 21,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v20 → v21 (time fields and formula upgrade, D-279–D-281) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 20 };
    expect(migrateWorkspace(previous, undefined, 21)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 21 },
      fromVersion: 20,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v18 → v19 (quick actions on the phone home screen, D-271) only raises the version', () => {
    const previous = { ...workspace('zh', { withPdf: true }), schemaVersion: 18 };
    expect(previous.workflows.length).toBeGreaterThan(0);
    expect(migrateWorkspace(previous, undefined, 19)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 19 },
      fromVersion: 18,
    });
    const prepared = prepareSnapshot(previous, registry);
    expect(prepared.ok).toBe(true);
    // 升级后没有哪个快捷操作在桌面上：用户没说过的不会出现在手机桌面。
    if (prepared.ok) expect(prepared.after.workflows.some((w) => w.homeScreen)).toBe(false);
  });
  it('v17 → v18 (picture backgrounds, D-258) only raises the version', () => {
    const previous = { ...workspace(), schemaVersion: 17 };
    expect(migrateWorkspace(previous, undefined, 18)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 18 },
      fromVersion: 17,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
  });
  it('v16 → v17 (buttons open quick actions, D-256) only raises the version', () => {
    const previous = { ...workspace(), schemaVersion: 16 };
    expect(migrateWorkspace(previous, undefined, 17)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 17 },
      fromVersion: 16,
    });
  });
  it('v15 → v16 (reminders, D-251) only raises the version', () => {
    const previous = { ...workspace(), schemaVersion: 15 };
    expect(migrateWorkspace(previous, undefined, 16)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 16 },
      fromVersion: 15,
    });
  });
  it('v14 → v15 (link field, D-250) only raises the version', () => {
    const previous = { ...workspace(), schemaVersion: 14 };
    expect(migrateWorkspace(previous, undefined, 15)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 15 },
      fromVersion: 14,
    });
  });
  it('v13 → v14 (chart, D-249) only raises the version', () => {
    const previous = { ...workspace(), schemaVersion: 13 };
    expect(migrateWorkspace(previous, undefined, 14)).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 14 },
      fromVersion: 13,
    });
  });
  it('v12 → v13 (stat groupBy, D-248) only raises the version', () => {
    const previous = { ...workspace(), schemaVersion: 12 };
    const migrated = migrateWorkspace(previous, undefined, 13);
    expect(migrated).toEqual({
      ok: true,
      config: { ...previous, schemaVersion: 13 },
      fromVersion: 12,
    });
    expect(prepareSnapshot(previous, registry).ok).toBe(true);
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
