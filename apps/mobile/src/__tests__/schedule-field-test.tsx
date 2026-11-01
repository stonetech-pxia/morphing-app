import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 日程字段的填写（D-296）和列表里的「规则 · 下一次」、今天该做的筛选（D-292–D-295）。

const plants: Collection = {
  id: 'plants',
  name: '浇水',
  fields: [
    { id: 'name', name: '植物', type: 'text' },
    {
      id: 'plan',
      name: '浇水频率',
      type: 'schedule',
      default: { repeat: 'interval', every: 7 },
      lastDone: 'watered',
    },
    { id: 'watered', name: '上次浇水', type: 'date' },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: plants },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'add',
          look: 'form',
          show: { mode: 'inline' },
          tools: [
            {
              as: 'submit',
              label: 'Add',
              do: 'create',
              table: 'plants',
              ask: ['name', 'plan', 'watered'],
            },
          ],
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'due',
          look: 'list',
          source: {
            table: 'plants',
            filter: [{ field: 'plan', op: 'due', value: 'today' }],
            sort: { field: 'plan', direction: 'asc' },
            limit: 10,
          },
          show: { title: 'name', subtitles: ['plan'], emptyText: 'Nothing to water' },
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

it('a new entry starts with the default rule, and the steps change it', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  expect(await screen.findByText('Nothing to water')).toBeTruthy();
  expect(screen.getByTestId('form-add-plan-summary').props.children).toBe('每 7 天');
  expect(screen.getByText('从「上次浇水」里的日期算起。')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('form-add-plan-every-plus'));
  await fireEvent.press(screen.getByTestId('form-add-plan-perDay-plus'));
  expect(screen.getByTestId('form-add-plan-summary').props.children).toBe('每 8 天，一天 2 次');
  await fireEvent.changeText(screen.getByTestId('form-add-name'), '龟背竹');
  await fireEvent.press(screen.getByTestId('form-add-submit'));
  const saved = await repo.listRecords('plants');
  expect(saved[0]!.values).toEqual({
    name: '龟背竹',
    plan: { repeat: 'interval', every: 8, perDay: 2 },
  });
  // 没浇过 → 今天该浇。
  expect(await screen.findByText('龟背竹')).toBeTruthy();
  expect(screen.getByText('每 8 天，一天 2 次 · 今天')).toBeTruthy();
});

it('picks weekdays and days of the month; at least one stays selected', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed, locale: 'en' });
  await fireEvent.press(await screen.findByTestId('form-add-plan-weekdays'));
  // 今天那天已经选上；再点它不会变成一天都没有。
  const summary = () => screen.getByTestId('form-add-plan-summary').props.children as string;
  const before = summary();
  for (const day of [1, 2, 3, 4, 5, 6, 7])
    await fireEvent.press(screen.getByTestId(`form-add-plan-day-${day}`));
  expect(summary()).not.toBe(before);
  expect(summary()).toMatch(/^Every /);
  await fireEvent.press(screen.getByTestId('form-add-plan-monthDays'));
  await fireEvent.press(screen.getByTestId('form-add-plan-dom-last'));
  expect(summary()).toMatch(/last day/);
  await fireEvent.press(screen.getByTestId('form-add-plan-none'));
  expect(screen.queryByTestId('form-add-plan-summary')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('form-add-name'), 'Fern');
  await fireEvent.press(screen.getByTestId('form-add-submit'));
  expect((await repo.listRecords('plants'))[0]!.values).toEqual({ name: 'Fern' });
});

it('lists only what is due today, overdue first, in French', async () => {
  const repo = new MemoryWorkspaceRepo();
  const plant = async (id: string, name: string, watered: string, every = 7) =>
    repo.insertRecord({
      id,
      collectionId: 'plants',
      values: { name, plan: { repeat: 'interval', every }, watered },
      createdAt: 1,
      updatedAt: 1,
    });
  await plant('p1', 'Fougère', daysAgo(7));
  await plant('p2', 'Lierre', daysAgo(10));
  await plant('p3', 'Cactus', daysAgo(1), 30);
  await renderToolsApp(repo, undefined, { seed, locale: 'fr' });
  expect(await screen.findByText('Tous les 7 jours · En retard de 3 jours')).toBeTruthy();
  expect(screen.getByText('Tous les 7 jours · Aujourd’hui')).toBeTruthy();
  expect(screen.queryByText('Cactus')).toBeNull();
  const names = screen.getAllByText(/^(Fougère|Lierre)$/).map((n) => n.props.children);
  expect(names).toEqual(['Lierre', 'Fougère']);
});
