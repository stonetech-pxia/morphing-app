import {
  applyOps,
  createDefaultWorkspace,
  formatNumber,
  formatValue,
  localDate,
  type Collection,
  type Component,
  type Locale,
  type Registry,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { statText } from '../renderer/data';
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

describe('chart (D-249)', () => {
  // 图表按真实的今天算最近几段：记录的日期也按今天往前推。
  const daysAgo = (n: number) => {
    const d = new Date();
    return localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
  };
  const label = (n: number) => daysAgo(n).slice(5);

  it('bar chart of the last 7 days: today is read out, tapping a bar reads that day', async () => {
    const repo = await withRecords([
      { amount: 30, category: 'food', date: daysAgo(0) },
      { amount: 12, category: 'food', date: daysAgo(2) },
      { amount: 8, category: 'transport', date: daysAgo(2) },
      { amount: 500, category: 'fun', date: daysAgo(30) },
    ]);
    await renderToolsApp(repo, undefined, {
      seed: seedWith({
        id: 'week',
        type: 'chart',
        props: {
          collectionId: 'expenses',
          kind: 'bar',
          aggregate: 'sum',
          fieldId: 'amount',
          group: 'day',
          title: '最近 7 天',
        },
      }),
    });
    const readout = await screen.findByTestId('chart-readout-expenses');
    expect(readout.props.children).toBe(`${label(0)}：¥30.00`);
    expect(screen.getByLabelText(`${label(2)}：¥20.00`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chart-bar-4'));
    expect(screen.getByTestId('chart-readout-expenses').props.children).toBe(`${label(2)}：¥20.00`);
  });

  it('pie chart lists every category with its share, so color is not the only cue', async () => {
    const repo = await withRecords([
      { amount: 30, category: 'food' },
      { amount: 10, category: 'transport' },
    ]);
    await renderToolsApp(repo, undefined, {
      seed: seedWith({
        id: 'share',
        type: 'chart',
        props: {
          collectionId: 'expenses',
          kind: 'pie',
          aggregate: 'sum',
          fieldId: 'amount',
          group: 'choice',
          choiceField: 'category',
          title: '花在哪里',
        },
      }),
    });
    expect(await screen.findByText('¥30.00（75%）')).toBeTruthy();
    expect(screen.getByText('¥10.00（25%）')).toBeTruthy();
    // 没有记录的分类不画。
    expect(screen.queryByTestId('chart-slice-fun')).toBeNull();
  });

  it('a new user sees a short note instead of an empty plot', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, {
      seed: seedWith({
        id: 'trend',
        type: 'chart',
        props: {
          collectionId: 'expenses',
          kind: 'line',
          aggregate: 'count',
          group: 'month',
          title: '每月笔数',
        },
      }),
    });
    expect(await screen.findByText('还没有可以显示的记录')).toBeTruthy();
    expect(screen.queryByTestId('chart-point-0')).toBeNull();
  });
});

describe('link to another table (D-250)', () => {
  const clients: Collection = {
    id: 'clients',
    name: '客户',
    fields: [{ id: 'name', name: '名字', type: 'text' }],
  };
  const orders: Collection = {
    id: 'orders',
    name: '订单',
    fields: [
      { id: 'item', name: '商品', type: 'text' },
      { id: 'client', name: '客户', type: 'link', collectionId: 'clients' },
    ],
  };
  const seed = (locale: Locale, registry: Registry) => {
    const result = applyOps(
      createDefaultWorkspace(locale),
      [
        { op: 'addCollection', collection: clients },
        { op: 'addCollection', collection: orders },
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'order-list',
            type: 'recordList',
            props: {
              collectionId: 'orders',
              display: 'list',
              titleField: 'item',
              subtitleFields: ['client'],
              limit: 20,
            },
          },
        },
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'add-order',
            type: 'recordForm',
            props: {
              collectionId: 'orders',
              fieldIds: ['item', 'client'],
              submitLabel: '记下',
              mode: 'inline',
            },
          },
        },
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

  it('lists the linked client by name, says when it was deleted, and shows it again after undo', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord({
      id: 'c1',
      collectionId: 'clients',
      values: { name: '王小明' },
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.insertRecord({
      id: 'o1',
      collectionId: 'orders',
      values: { item: '书', client: 'c1' },
      createdAt: 2,
      updatedAt: 2,
    });
    const { store } = await renderToolsApp(repo, undefined, { seed });
    expect(await screen.findByText('王小明')).toBeTruthy();

    await repo.deleteRecord('c1', 3);
    store.getState().bumpRecords();
    expect(await screen.findByText('已删除的记录')).toBeTruthy();
    // 订单里的引用还在，恢复客户后又能看到名字。
    expect((await repo.listRecords('orders'))[0]!.values.client).toBe('c1');
    await repo.restoreRecord('c1');
    store.getState().bumpRecords();
    expect(await screen.findByText('王小明')).toBeTruthy();
  });

  it('the form picks a client from the other table and stores only its id', async () => {
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord({
      id: 'c1',
      collectionId: 'clients',
      values: { name: '王小明' },
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.insertRecord({
      id: 'c2',
      collectionId: 'clients',
      values: { name: '李华' },
      createdAt: 2,
      updatedAt: 2,
    });
    await renderToolsApp(repo, undefined, { seed });
    await fireEvent.changeText(await screen.findByTestId('form-add-order-item'), '茶叶');
    await fireEvent.press(screen.getByTestId('form-add-order-client'));
    await fireEvent.press(await screen.findByTestId('form-add-order-client-option-c2'));
    await fireEvent.press(screen.getByTestId('form-add-order-submit'));
    const saved = await repo.listRecords('orders');
    expect(saved.map((r) => r.values)).toEqual([{ item: '茶叶', client: 'c2' }]);
    expect(await screen.findByText('李华')).toBeTruthy();
  });

  it('with an empty client table the picker says so', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
    await fireEvent.press(await screen.findByTestId('form-add-order-client'));
    expect(await screen.findByText('「客户」里还没有记录。')).toBeTruthy();
  });
});

describe('stat and chart values follow the interface language', () => {
  it('French shows amounts and numbers the way the record list does', () => {
    const money = expenses.fields[0]!;
    const weight = { id: 'kg', name: 'Poids', type: 'number', decimals: 1, unit: 'kg' } as const;
    expect(statText(1234.5, 'sum', money, 'fr')).toBe(formatValue(money, 1234.5, 'fr'));
    expect(statText(1234.5, 'sum', weight, 'fr')).toBe(formatValue(weight, 1234.5, 'fr'));
    expect(statText(1234, 'count', money, 'fr')).toBe(formatNumber(1234, undefined, 'fr'));
  });
});
