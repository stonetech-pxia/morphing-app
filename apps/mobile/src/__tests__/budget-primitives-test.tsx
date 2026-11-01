import {
  applyOps,
  createDefaultWorkspace,
  formatMoney,
  localDate,
  shiftMonth,
  type Collection,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 统计和图表按引用字段分组（D-336）、统计相减（D-337）、新建并打开表单（D-338）。
// 例子是零基预算：分类、分配、流水三张表；这些能力不只给预算用。

const tables: Collection[] = [
  {
    id: 'categories',
    name: '分类',
    fields: [{ id: 'name', name: '名称', type: 'text', required: true }],
  },
  {
    id: 'assigned',
    name: '分配',
    fields: [
      { id: 'amount', name: '金额', type: 'money', currency: 'CNY', required: true },
      { id: 'date', name: '日期', type: 'date', default: 'today' },
      { id: 'category', name: '分类', type: 'link', table: 'categories', required: true },
    ],
  },
  {
    id: 'ledger',
    name: '流水',
    fields: [
      { id: 'amount', name: '金额', type: 'money', currency: 'CNY', required: true },
      { id: 'date', name: '日期', type: 'date', default: 'today' },
      {
        id: 'kind',
        name: '类型',
        type: 'choice',
        default: 'out',
        options: [
          { id: 'out', label: '支出' },
          { id: 'in', label: '收入' },
        ],
      },
      { id: 'category', name: '分类', type: 'link', table: 'categories' },
    ],
  },
];

const components: NewComponent[] = [
  {
    id: 'rta',
    look: 'number',
    show: { label: '待分配' },
    source: {
      table: 'ledger',
      aggregate: 'sum',
      field: 'amount',
      filter: [{ field: 'kind', op: 'is', value: 'in' }],
      minus: { table: 'assigned', aggregate: 'sum', field: 'amount' },
    },
  },
  {
    id: 'bycat',
    look: 'number',
    show: { label: '本月各分类' },
    source: {
      table: 'ledger',
      aggregate: 'sum',
      field: 'amount',
      filter: [
        { field: 'kind', op: 'is', value: 'out' },
        { field: 'date', op: 'inPeriod', value: 'thisMonth' },
      ],
      group: { by: 'category' },
      compare: 'previous',
    },
  },
  {
    id: 'cats',
    look: 'list',
    source: { table: 'categories', limit: 20 },
    show: { title: 'name' },
    tools: [
      {
        as: 'button',
        label: '分配',
        do: 'create',
        table: 'assigned',
        values: { category: '$row', date: 'today' },
        ask: 'all',
      },
    ],
  },
];

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      ...tables.map((table) => ({ op: 'addData' as const, table })),
      ...components.map((block) => ({
        op: 'addContainer' as const,
        page: 'home',
        block,
      })),
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const at = Date.now();
const put = (repo: MemoryWorkspaceRepo, id: string, collectionId: string, values: object, n = 0) =>
  repo.insertRecord({
    id,
    collectionId,
    values: { ...values },
    createdAt: at + n,
    updatedAt: at + n,
  });
const yuan = (n: number) => formatMoney(n, 'CNY', 'zh');
const today = localDate(new Date());

it('a new user: nothing to assign, no category rows, no row buttons', async () => {
  await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { locale: 'zh', seed });
  expect((await screen.findByTestId('stat-value-ledger-待分配')).props.children).toBe(yuan(0));
  expect(screen.getByText('本月各分类')).toBeTruthy();
  expect(screen.queryByText('分配')).toBeNull();
});

it('ready to assign is income minus everything assigned, every month so far', async () => {
  const repo = new MemoryWorkspaceRepo();
  const lastMonth = `${shiftMonth(localDate(new Date()).slice(0, 7), -1)}-01`;
  await put(repo, 'food', 'categories', { name: '餐饮' }, 1);
  await put(repo, 'rent', 'categories', { name: '房租' }, 2);
  await put(repo, 'pay', 'ledger', { amount: 3000, kind: 'in', date: lastMonth });
  await put(repo, 'a1', 'assigned', { amount: 2000, category: 'rent', date: lastMonth });
  await put(repo, 'a2', 'assigned', { amount: 800, category: 'food' });
  await put(repo, 's1', 'ledger', { amount: 150, kind: 'out', category: 'food', date: today });
  await put(repo, 's2', 'ledger', { amount: 100, kind: 'out', category: 'food', date: lastMonth });
  await put(repo, 's3', 'ledger', { amount: 9, kind: 'out', date: today });
  await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  expect((await screen.findByTestId('stat-value-ledger-待分配')).props.children).toBe(yuan(200));
  // 每个分类一行（按添加的顺序），没选分类的另算一行；和上月同期比。
  expect(screen.getByTestId('stat-group-ledger-food').props.children).toBe(yuan(150));
  expect(screen.getByTestId('stat-group-ledger-rent').props.children).toBe(yuan(0));
  expect(screen.getByTestId('stat-group-ledger-none').props.children).toBe(yuan(9));
  expect(screen.getByText('↑ 50%')).toBeTruthy();
});

it('"assign" on a category opens the form with the category filled in; saving updates the total', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'food', 'categories', { name: '餐饮' });
  await put(repo, 'pay', 'ledger', { amount: 500, kind: 'in' });
  await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await fireEvent.press(await screen.findByTestId('row-action-food'));
  // 打开表单，不直接存：还没有分配的记录，也没有提示条。
  expect(await screen.findByTestId('editor-save')).toBeTruthy();
  expect(await repo.listRecords('assigned')).toEqual([]);
  expect(screen.queryByTestId('toast')).toBeNull();
  expect(screen.getByTestId('editor-category')).toHaveTextContent(/餐饮/);
  await fireEvent.changeText(screen.getByTestId('editor-amount'), '120');
  await fireEvent.press(screen.getByTestId('editor-save'));
  // eslint-disable-next-line no-console
  const [saved] = await waitFor(async () => {
    const list = await repo.listRecords('assigned');
    expect(list).toHaveLength(1);
    return list;
  });
  expect(saved?.values).toEqual({ amount: 120, category: 'food', date: localDate(new Date()) });
  expect((await screen.findByTestId('stat-value-ledger-待分配')).props.children).toBe(yuan(380));
});

it('a category deleted meanwhile: its spending counts as not set, the rest still adds up', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'food', 'categories', { name: '餐饮' });
  await put(repo, 's1', 'ledger', { amount: 20, kind: 'out', category: 'gone', date: today });
  await put(repo, 'a1', 'assigned', { amount: 50, category: 'gone' });
  await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  expect((await screen.findByTestId('stat-value-ledger-待分配')).props.children).toBe(yuan(-50));
  expect(screen.getByTestId('stat-group-ledger-none').props.children).toBe(yuan(20));
  expect(screen.getByTestId('stat-group-ledger-food').props.children).toBe(yuan(0));
});
