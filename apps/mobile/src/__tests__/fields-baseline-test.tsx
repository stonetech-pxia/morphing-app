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
// 重构只换写法，显示的文字必须不变（只快照文字，不快照整棵树）。

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
  { id: 'l', name: 'Parent', type: 'link', table: 'items' },
  { id: 'fo', name: 'Double', type: 'formula', expression: '{num} * 2', unit: 'kg' },
];

const items: Collection = { id: 'items', name: 'Items', fields: FIELDS };
const fillable = FIELDS.filter((f) => f.type !== 'formula' && f.type !== 'file').map((f) => f.id);

const seed = (locale: Locale, registry: Registry) => {
  const components: NewComponent[] = [
    {
      id: 'form',
      look: 'form',
      show: { mode: 'inline' },
      tools: [{ as: 'submit', label: 'Add', do: 'create', table: 'items', ask: fillable }],
    },
    ...FIELDS.map((f): NewComponent => ({
      id: `list-${f.id}`,
      look: 'list',
      source: {
        table: 'items',
        ...(f.type === 'link' ? {} : { sort: { field: 'createdAt', direction: 'asc' } }),
        limit: 5,
      },
      show: { title: f.id },
    })),
  ];
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: items },
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
  expect(visibleText(screen.toJSON())).toMatchSnapshot();
});

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

/**
 * 页面上每个组件、表单项和记录显示的文字（一行一个），代替整棵树的快照（架构清理，2026-10-27）：
 * 字段的输入控件和列表显示在这里锁住；样式和布局由组件、字段登记表的测试管。
 */
function visibleText(tree: unknown): string {
  const lines: string[] = [];
  const texts = (n: Node | string): string[] => {
    if (typeof n === 'string') return [n];
    const own = ['placeholder', 'accessibilityLabel', 'value']
      .map((k) => n.props[k])
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .map((v) => `[${v}]`);
    const state = n.props.accessibilityState as
      { selected?: boolean; checked?: boolean } | undefined;
    if (state?.selected) own.push('[selected]');
    if (state?.checked) own.push('[checked]');
    if (typeof n.props.value === 'boolean') own.push(n.props.value ? '[on]' : '[off]');
    return [...own, ...(n.children ?? []).flatMap(texts)];
  };
  const walk = (n: Node | string, scope: string) => {
    if (typeof n === 'string') return;
    const id = typeof n.props.testID === 'string' ? n.props.testID : '';
    let inner = scope;
    if (/^component-/.test(id)) inner = id.slice('component-'.length);
    if (
      /^(?:form-|record-)/.test(id) ||
      (/^component-/.test(id) && !/^component-(?:list|form)/.test(id))
    )
      lines.push(`${inner} ${id} <${n.type}>: ${texts(n).join(' | ')}`);
    for (const c of n.children ?? []) walk(c, inner);
  };
  for (const root of ([] as unknown[]).concat(tree)) walk(root as Node, '');
  return `\n${lines.join('\n')}\n`;
}
