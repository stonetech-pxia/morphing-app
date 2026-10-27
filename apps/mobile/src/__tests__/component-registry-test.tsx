import {
  COMPONENTS,
  applyOps,
  createDefaultWorkspace,
  localDate,
  templateOps,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { screen } from 'expo-router/testing-library';

import { RENDERERS } from '../renderer/registry';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 每个登记的组件都能画出来（新增组件时这里自动覆盖它，见 docs/COMPONENTS.md）：用定义里的 example，
// 放在样例配置的首页（数据表 expenses、已添加的 PDF 工具）。画不出来时 App 会回退版本，这里查的就是没有回退。

type Definition = (typeof COMPONENTS)[number];

const seed = (def: Definition) => (locale: Locale, registry: Registry) => {
  const config = createDefaultWorkspace(locale);
  const component = { id: 'example', type: def.type, ...def.example } as NewComponent;
  const result = applyOps(
    config,
    [
      { op: 'installTool', toolId: 'pdf' },
      templateOps('budget', config, locale)[0]!,
      { op: 'addComponent', pageId: 'home', component },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

async function renders(def: Definition, locale: Locale, repo = new MemoryWorkspaceRepo()) {
  const { store } = await renderToolsApp(repo, undefined, { seed: seed(def), locale });
  expect(await screen.findByTestId('component-example')).toBeTruthy();
  expect(store.getState().head!.source).not.toBe('rollback');
  expect(store.getState().status).toBe('ready');
}

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

const today = localDate(new Date());

it('has a renderer for every registered component', () => {
  expect(Object.keys(RENDERERS).sort()).toEqual(COMPONENTS.map((d) => d.type).sort());
});

describe.each(COMPONENTS.map((d) => [d.type, d] as const))('component %s', (_type, def) => {
  it.each(['zh', 'en', 'fr'] as const)('renders its example in %s', async (locale) => {
    await renders(def, locale);
  });
});

/** 引用数据表的组件：新用户没有记录、有记录、记录很多或不规整（缺值、值不对、超大）。 */
const DATA = COMPONENTS.filter((d) =>
  Object.values(d.refs ?? {}).some((ref) => ref?.to === 'collection'),
);

describe.each(DATA.map((d) => [d.type, d] as const))('data component %s', (_type, def) => {
  it('renders for a new user with no entries', async () => {
    await renders(def, 'zh');
  });

  it('renders with entries', async () => {
    await renders(
      def,
      'en',
      await withRecords([
        { amount: 30, category: 'food', date: today, note: 'Lunch' },
        { amount: 12.5, category: 'transport', date: today },
      ]),
    );
  });

  it('renders many entries with missing, wrong and huge values', async () => {
    const values: Record<string, unknown>[] = Array.from({ length: 150 }, (_, i) => ({
      amount: i * 3.75,
      category: ['food', 'fun', 'gone-option'][i % 3],
      date: today,
    }));
    values.push(
      {},
      { amount: 'not a number', category: 42, date: 'yesterday' },
      { amount: 1e15, note: 'x'.repeat(5000) },
      { amount: -20, date: '1999-01-01' },
    );
    await renders(def, 'fr', await withRecords(values));
  });
});
