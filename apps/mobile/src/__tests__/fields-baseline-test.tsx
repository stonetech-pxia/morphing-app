import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Field,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 字段类型登记表重构的基线（2026-10-27）：每种字段的输入控件和在列表里的显示。
// 重构只换写法，画出来的树必须不变。

const FIELDS: Field[] = [
  { id: 't', name: 'Title', type: 'text' },
  { id: 'n', name: 'Note', type: 'note' },
  { id: 'num', name: 'Weight', type: 'number', decimals: 1, unit: 'kg' },
  { id: 'm', name: 'Price', type: 'money', currency: 'EUR' },
  { id: 'cb', name: 'Done', type: 'checkbox' },
  { id: 'd', name: 'Day', type: 'date' },
  {
    id: 'ch',
    name: 'Kind',
    type: 'choice',
    options: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ],
  },
  { id: 'r', name: 'Stars', type: 'rating' },
  { id: 'f', name: 'Receipt', type: 'file' },
  { id: 'l', name: 'Parent', type: 'link', collectionId: 'items' },
  { id: 'fo', name: 'Double', type: 'formula', expression: '{num} * 2', unit: 'kg' },
];

const items: Collection = { id: 'items', name: 'Items', fields: FIELDS };
const fillable = FIELDS.filter((f) => f.type !== 'formula' && f.type !== 'file').map((f) => f.id);

const seed = (locale: Locale, registry: Registry) => {
  const components: NewComponent[] = [
    {
      id: 'form',
      type: 'recordForm',
      props: { collectionId: 'items', fieldIds: fillable, submitLabel: 'Add', mode: 'inline' },
    },
    ...FIELDS.map((f): NewComponent => ({
      id: `list-${f.id}`,
      type: 'recordList',
      props: {
        collectionId: 'items',
        display: 'list',
        titleField: f.id,
        ...(f.type === 'link' ? {} : { sort: { field: 'createdAt', direction: 'asc' } }),
        limit: 5,
      },
    })),
  ];
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addCollection', collection: items },
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

async function repoWithRecords() {
  const repo = new MemoryWorkspaceRepo();
  const values: Record<string, unknown>[] = [
    {
      t: 'Apple',
      n: 'two\nlines',
      num: 2.5,
      m: 1234.5,
      cb: true,
      d: '2026-10-20',
      ch: 'a',
      r: 4,
      f: 'asset1',
      l: 'r1',
    },
    { t: 'Pear', num: 'bad', m: -3, cb: false, d: '2026-02-30', ch: 'gone', r: 9, l: 'missing' },
  ];
  for (const [i, v] of values.entries()) {
    await repo.insertRecord({
      id: `r${i}`,
      collectionId: 'items',
      values: v,
      createdAt: Date.UTC(2026, 9, 20 + i, 8),
      updatedAt: Date.UTC(2026, 9, 20 + i, 8),
    });
  }
  return repo;
}

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true, now: new Date(2026, 9, 27, 10, 0) });
});
afterEach(() => jest.useRealTimers());

it.each(['zh', 'en', 'fr'] as const)('field inputs and list display in %s', async (locale) => {
  await renderToolsApp(await repoWithRecords(), undefined, { seed, locale });
  expect(await screen.findByTestId('component-list-fo')).toBeTruthy();
  expect(await screen.findAllByText('Apple')).toBeTruthy();
  expect(screen.toJSON()).toMatchSnapshot();
});
