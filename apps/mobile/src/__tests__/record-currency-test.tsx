import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 每一笔单独选货币（D-429）：列表每行写自己的货币，合计按货币分开，不加在一起。

const claims: Collection = {
  id: 'claims',
  name: '报销',
  fields: [
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY', currencyField: 'currency' },
    {
      id: 'currency',
      name: '货币',
      type: 'choice',
      options: [
        { id: 'usd', label: 'USD' },
        { id: 'eur', label: 'EUR' },
        { id: 'cny', label: 'CNY' },
      ],
    },
    { id: 'note', name: '备注', type: 'text' },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: claims },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'total',
          look: 'number',
          show: { label: '合计' },
          source: { table: 'claims', aggregate: 'sum', field: 'amount' },
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'list',
          look: 'list',
          source: { table: 'claims', limit: 50 },
          show: { title: 'note', trailing: 'amount' },
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

async function records(values: Record<string, unknown>[]) {
  const repo = new MemoryWorkspaceRepo();
  for (const [i, v] of values.entries())
    await repo.insertRecord({
      id: `r${i}`,
      collectionId: 'claims',
      values: v,
      createdAt: i,
      updatedAt: i,
    });
  return repo;
}

it('new user: nothing recorded yet shows a zero in the default currency', async () => {
  await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
  expect((await screen.findByTestId('stat-value-claims-合计')).props.children).toBe('¥0.00');
});

it('the total stays apart per currency and each row shows its own', async () => {
  const repo = await records([
    { amount: 100, currency: 'usd', note: 'hotel' },
    { amount: 50, currency: 'eur', note: 'taxi' },
    { amount: 3, note: 'no currency picked' },
  ]);
  await renderToolsApp(repo, undefined, { seed });
  const total = String((await screen.findByTestId('stat-value-claims-合计')).props.children);
  expect(total).toContain('¥3.00');
  expect(total).toContain('€50.00');
  expect(total).toMatch(/\$100\.00/);
  expect(total).not.toContain('153');
  expect(await screen.findByText(/€50\.00$/)).toBeTruthy();
});
