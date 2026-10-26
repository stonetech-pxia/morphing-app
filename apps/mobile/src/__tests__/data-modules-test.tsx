import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Component,
  type Locale,
  type Registry,
} from '@morph/core';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 数据组件的新能力：按选项分组统计（D-248）。记录只在本机读取，组件只引用表和字段。

const expenses: Collection = {
  id: 'expenses',
  name: '账目',
  fields: [
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
    {
      id: 'category',
      name: '分类',
      type: 'choice',
      options: [
        { id: 'food', label: '餐饮' },
        { id: 'transport', label: '交通' },
        { id: 'fun', label: '娱乐' },
      ],
    },
    { id: 'date', name: '日期', type: 'date' },
  ],
};

/** 首页放上这些组件，表是 expenses。 */
const seedWith =
  (...components: Component[]) =>
  (locale: Locale, registry: Registry) => {
    const result = applyOps(
      createDefaultWorkspace(locale),
      [
        { op: 'addCollection', collection: expenses },
        ...components.map((component) => ({
          op: 'addComponent' as const,
          pageId: 'home',
          component,
        })),
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

async function withRecords(values: Record<string, unknown>[]) {
  const repo = new MemoryWorkspaceRepo();
  for (const [i, v] of values.entries()) {
    await repo.insertRecord({
      id: `r${i}`,
      collectionId: 'expenses',
      values: v,
      createdAt: i,
      updatedAt: i,
    });
  }
  return repo;
}

describe('stat grouped by a choice field', () => {
  it('shows one row per option, in option order, plus the entries without a category', async () => {
    const repo = await withRecords([
      { amount: 30, category: 'food', date: '2026-10-20' },
      { amount: 12.5, category: 'food', date: '2026-10-21' },
      { amount: 4, category: 'transport', date: '2026-10-21' },
      { amount: 99, date: '2026-10-22' },
    ]);
    await renderToolsApp(repo, undefined, {
      seed: seedWith({
        id: 'by-category',
        type: 'stat',
        props: {
          collectionId: 'expenses',
          aggregate: 'sum',
          fieldId: 'amount',
          label: '按分类',
          groupBy: 'category',
        },
      }),
    });
    expect((await screen.findByTestId('stat-group-expenses-food')).props.children).toBe('¥42.50');
    expect(screen.getByTestId('stat-group-expenses-transport').props.children).toBe('¥4.00');
    // 没有记录的选项也列出来（合计 0）。
    expect(screen.getByTestId('stat-group-expenses-fun').props.children).toBe('¥0.00');
    expect(screen.getByTestId('stat-group-expenses-none').props.children).toBe('¥99.00');
    expect(screen.getByText('未选')).toBeTruthy();
  });

  it('a new user with no entries sees every option at zero', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, {
      seed: seedWith({
        id: 'by-category',
        type: 'stat',
        props: { collectionId: 'expenses', aggregate: 'count', label: '笔数', groupBy: 'category' },
      }),
    });
    expect((await screen.findByTestId('stat-group-expenses-food')).props.children).toBe('0');
    expect(screen.queryByTestId('stat-group-expenses-none')).toBeNull();
  });
});
