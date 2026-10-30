import { applyOps, createDefaultWorkspace, type Locale, type Registry } from '@morph/core';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 分组里还能放一层分组（Q3，NEW_FORMAT §4）：一张卡片上面两个数字并排，下面一个按钮。

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      {
        op: 'addData',
        table: {
          id: 'water',
          name: '喝水',
          fields: [
            { id: 'day', name: '日期', type: 'date' },
            { id: 'glasses', name: '杯数', type: 'number' },
          ],
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'outer',
          look: 'group',
          show: { title: '今天', layout: 'stack' },
          children: [
            {
              id: 'inner',
              look: 'group',
              show: { layout: 'row' },
              children: [
                {
                  id: 'count',
                  look: 'number',
                  show: { label: '次数' },
                  source: { table: 'water', aggregate: 'count' },
                },
                {
                  id: 'sum',
                  look: 'number',
                  show: { label: '一共' },
                  source: { table: 'water', aggregate: 'sum', field: 'glasses' },
                },
                {
                  id: 'secret',
                  look: 'text',
                  hidden: true,
                  show: { text: '藏起来的字' },
                },
              ],
            },
            {
              id: 'log',
              look: 'button',
              show: { label: '喝一杯', variant: 'filled' },
              tools: [{ do: 'create', table: 'water', values: { glasses: 1, day: 'today' } }],
            },
          ],
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

it('draws a group inside a group: both numbers side by side, the button below, hidden ones left out', async () => {
  const repo = new MemoryWorkspaceRepo();
  const at = Date.now();
  for (const [id, glasses] of [
    ['w1aaaaaa', 3],
    ['w2aaaaaa', 5],
  ] as const)
    await repo.insertRecord({
      id,
      collectionId: 'water',
      values: { day: '2026-10-29', glasses },
      createdAt: at,
      updatedAt: at,
    });
  await renderToolsApp(repo, undefined, { seed });
  expect(await screen.findByTestId('component-outer')).toBeTruthy();
  // 里面那层分组的两个块都画出来了，各自算自己的数。
  expect(await screen.findByTestId('stat-value-water-次数')).toHaveTextContent('2');
  expect(screen.getByTestId('stat-value-water-一共')).toHaveTextContent('8');
  expect(screen.getByTestId('component-inner')).toBeTruthy();
  expect(screen.getByText('喝一杯')).toBeTruthy();
  expect(screen.queryByText('藏起来的字')).toBeNull();
});
