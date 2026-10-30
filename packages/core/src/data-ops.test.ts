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
      expect(config.data.tables).toHaveLength(1);
      // 默认导航栏已满（5 项），所以入口是首页上的快捷入口。
      expect(config.containers.pages[0]!.blocks.at(-1)).toMatchObject({ look: 'entry' });
    }
  });

  it('a second copy gets new ids', () => {
    const twice = apply(budget(), templateOps('budget', budget(), 'zh'));
    expect(twice.data.tables.map((c) => c.id)).toEqual(['expenses', 'expenses-2']);
    expect(issuesOf(twice)).toEqual([]);
  });
});

describe('data table ops', () => {
  it('adds, renames, moves and removes fields', () => {
    const config = apply(budget(), [
      {
        op: 'addData',
        table: 'expenses',
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
      { op: 'updateData', table: 'expenses', field: 'note', changes: { name: '说明' } },
      { op: 'moveData', table: 'expenses', field: 'pay', toIndex: 1 },
      { op: 'updateData', table: 'expenses', changes: { name: '开销' } },
    ]);
    expect(config.data.tables[0]!.name).toBe('开销');
    expect(config.data.tables[0]!.fields.map((f) => f.name)).toEqual([
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
      { op: 'updateData', table: 'expenses', field: 'note', changes: { type: 'note' } },
    ]);
    expect(toNote.data.tables[0]!.fields[3]).toEqual({ id: 'note', name: '备注', type: 'note' });
    expect(
      tryOps(budget(), [
        { op: 'updateData', table: 'expenses', field: 'note', changes: { type: 'date' } },
      ]),
    ).toEqual({
      ok: false,
      error: 'field note cannot change from text to date; add a new field instead',
    });
    // number → money 需要提供币种，否则校验不通过。
    const withNumber = apply(budget(), [
      {
        op: 'addData',
        table: 'expenses',
        field: { id: 'qty', name: '数量', type: 'number', unit: '个' },
      },
      { op: 'updateData', table: 'expenses', field: 'qty', changes: { type: 'money' } },
    ]);
    expect(issuesOf(withNumber).some((m) => m.includes('currency'))).toBe(true);
  });

  it('rejects blocks that point at missing fields; removing a field needs the blocks fixed too', () => {
    const removed = apply(budget(), [{ op: 'removeData', table: 'expenses', field: 'note' }]);
    expect(issuesOf(removed)).toEqual([
      'add: form field note does not exist',
      'recent: subtitleField note is not a field of expenses',
    ]);
  });

  it('removing a table takes its blocks with it and leaves a valid config', () => {
    const result = tryOps(budget(), [{ op: 'removeData', table: 'expenses' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.data.tables).toEqual([]);
    expect(result.notes).toEqual([{ kind: 'removedDataComponents', table: 'expenses', count: 4 }]);
    expect(issuesOf(result.config)).toEqual([]);
  });

  it('checks filters, aggregates and checklists against field types', () => {
    const bad = apply(budget(), [
      {
        op: 'addContainer',
        page: 'budget',
        block: {
          id: 'bad-stat',
          look: 'number',
          show: { label: 'x' },
          source: {
            table: 'expenses',
            aggregate: 'sum',
            field: 'category',
            filter: [
              { field: 'amount', op: 'inPeriod', value: 'thisMonth' },
              { field: 'category', op: 'is', value: 'nope' },
            ],
          },
        },
      },
      {
        op: 'addContainer',
        page: 'budget',
        block: {
          id: 'bad-list',
          look: 'checklist',
          source: { table: 'expenses', limit: 5 },
          show: { title: 'note' },
        },
      },
    ]);
    expect(issuesOf(bad)).toEqual([
      'bad-stat: sum needs field set to a number, money, rating or formula field',
      'bad-stat: filter on amount: inPeriod needs a date field',
      'bad-stat: filter on category: value does not match the field type',
      'bad-list: a checklist needs exactly one tool {as: "check", do: "toggle", table, field: <a checkbox field>}',
    ]);
  });

  it('describes data changes, naming tables created in the same change', () => {
    const result = prepareOps(workspace(), templateOps('budget', workspace(), 'zh'), ctx);
    expect(result.ok && result.lines).toEqual([
      '新建数据表「账目」（金额、分类、日期、备注）',
      '新建页面「记账」（4 块内容）',
      '在「首页」添加快捷入口「记账」',
    ]);
    const removed = prepareOps(budget(), [{ op: 'removeData', table: 'expenses' }], ctx);
    expect(removed.ok && removed.lines).toEqual([
      '把数据表「账目」移出界面（记录保留，可在「设置 → 数据」里查看和导出）',
      '同时移除 4 块显示「账目」的内容',
    ]);
  });
});
