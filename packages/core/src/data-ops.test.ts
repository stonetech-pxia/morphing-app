import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { applyOps, type Op } from './ops';
import { DATA_TEMPLATES, templateOps } from './templates';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';
import type { WorkspaceConfig } from './schema';

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22) };
const budget = () => apply(workspace(), templateOps('budget', workspace(), 'zh'));
const issuesOf = (config: WorkspaceConfig) => {
  const r = validateWorkspace(config, registry);
  return r.ok ? [] : r.issues.map((i) => i.message);
};
const tryOps = (config: WorkspaceConfig, ops: Op[]) =>
  applyOps(config, ops, { registry, locale: 'zh' });

describe('data templates', () => {
  it.each(DATA_TEMPLATES)('%s builds a valid table and page with an entry', (template) => {
    for (const locale of ['zh', 'en'] as const) {
      const config = apply(
        workspace(locale),
        templateOps(template, workspace(locale), locale),
        locale,
      );
      expect(issuesOf(config)).toEqual([]);
      expect(config.collections).toHaveLength(1);
      // 默认导航栏已满（5 项），所以入口是首页上的快捷入口。
      expect(config.pages[0]!.components.at(-1)).toMatchObject({ type: 'shortcut' });
    }
  });

  it('a second copy gets new ids', () => {
    const twice = apply(budget(), templateOps('budget', budget(), 'zh'));
    expect(twice.collections.map((c) => c.id)).toEqual(['expenses', 'expenses-2']);
    expect(issuesOf(twice)).toEqual([]);
  });
});

describe('data table ops', () => {
  it('adds, renames, moves and removes fields', () => {
    const config = apply(budget(), [
      {
        op: 'addField',
        collectionId: 'expenses',
        field: {
          id: 'pay',
          name: '支付方式',
          type: 'choice',
          options: [
            { id: 'wechat', label: '微信' },
            { id: 'cash', label: '现金' },
          ],
        },
      },
      { op: 'updateField', collectionId: 'expenses', fieldId: 'note', changes: { name: '说明' } },
      { op: 'moveField', collectionId: 'expenses', fieldId: 'pay', toIndex: 1 },
      { op: 'updateCollection', collectionId: 'expenses', name: '开销' },
    ]);
    expect(config.collections[0]!.fields.map((f) => f.name)).toEqual([
      '金额',
      '支付方式',
      '分类',
      '日期',
      '说明',
    ]);
    expect(issuesOf(config)).toEqual([]);
  });

  it('only allows compatible type changes', () => {
    const toNote = apply(budget(), [
      { op: 'updateField', collectionId: 'expenses', fieldId: 'note', changes: { type: 'note' } },
    ]);
    expect(toNote.collections[0]!.fields[3]).toEqual({ id: 'note', name: '备注', type: 'note' });
    expect(
      tryOps(budget(), [
        { op: 'updateField', collectionId: 'expenses', fieldId: 'note', changes: { type: 'date' } },
      ]),
    ).toEqual({
      ok: false,
      error: 'field note cannot change from text to date; add a new field instead',
    });
    // number → money 需要提供币种，否则校验不通过。
    const withNumber = apply(budget(), [
      {
        op: 'addField',
        collectionId: 'expenses',
        field: { id: 'qty', name: '数量', type: 'number', unit: '个' },
      },
      { op: 'updateField', collectionId: 'expenses', fieldId: 'qty', changes: { type: 'money' } },
    ]);
    expect(issuesOf(withNumber).some((m) => m.includes('currency'))).toBe(true);
  });

  it('rejects components that point at missing fields; removing a field needs the components fixed too', () => {
    const removed = apply(budget(), [
      { op: 'removeField', collectionId: 'expenses', fieldId: 'note' },
    ]);
    expect(issuesOf(removed)).toEqual([
      'add: form field note does not exist',
      'recent: subtitleField note is not a field of expenses',
    ]);
  });

  it('removing a table takes its components with it and leaves a valid config', () => {
    const result = tryOps(budget(), [{ op: 'removeCollection', collectionId: 'expenses' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.collections).toEqual([]);
    expect(result.notes).toEqual([
      { kind: 'removedDataComponents', collectionId: 'expenses', count: 4 },
    ]);
    expect(issuesOf(result.config)).toEqual([]);
  });

  it('checks filters, aggregates and checklists against field types', () => {
    const bad = apply(budget(), [
      {
        op: 'addComponent',
        pageId: 'budget',
        component: {
          id: 'bad-stat',
          type: 'stat',
          props: {
            collectionId: 'expenses',
            aggregate: 'sum',
            fieldId: 'category',
            label: 'x',
            filter: [
              { field: 'amount', op: 'inPeriod', value: 'thisMonth' },
              { field: 'category', op: 'is', value: 'nope' },
            ],
          },
        },
      },
      {
        op: 'addComponent',
        pageId: 'budget',
        component: {
          id: 'bad-list',
          type: 'recordList',
          props: { collectionId: 'expenses', display: 'checklist', titleField: 'note', limit: 5 },
        },
      },
    ]);
    expect(issuesOf(bad)).toEqual([
      'bad-stat: sum needs fieldId set to a number, money or rating field',
      'bad-stat: filter on amount: inPeriod needs a date field',
      'bad-stat: filter on category: value does not match the field type',
      'bad-list: a checklist needs checkField set to a checkbox field',
    ]);
  });

  it('describes data changes, naming tables created in the same change', () => {
    const result = prepareOps(workspace(), templateOps('budget', workspace(), 'zh'), ctx);
    expect(result.ok && result.lines).toEqual([
      '新建数据表「账目」（金额、分类、日期、备注）',
      '新建页面「记账」（4 个组件）',
      '在「首页」添加快捷入口「记账」',
    ]);
    const removed = prepareOps(
      budget(),
      [{ op: 'removeCollection', collectionId: 'expenses' }],
      ctx,
    );
    expect(removed.ok && removed.lines).toEqual([
      '把数据表「账目」移出界面（记录保留，可在「设置 → 数据」里查看和导出）',
      '同时移除 4 个显示「账目」的组件',
    ]);
  });
});
