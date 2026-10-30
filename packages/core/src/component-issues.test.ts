import { describe, expect, it } from 'vitest';

import { componentLabel } from './describe';
import type { Component, Locale, WorkspaceConfig } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';

// 每种外观的引用问题和修改说明（组件登记表重构时存的基线，v34 按块的新写法重写）。问题文字会发给 AI
// 让它改正，说明文字给用户看；这里锁住文字和顺序。

const table = {
  id: 'spend',
  name: 'Spending',
  fields: [
    { id: 'amount', name: 'Amount', type: 'money', currency: 'USD' },
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'kind', name: 'Kind', type: 'choice', options: [{ id: 'food', label: 'Food' }] },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'day', name: 'Day', type: 'date' },
    { id: 'total', name: 'Total', type: 'formula', expression: '{amount} * 2' },
    { id: 'receipt', name: 'Receipt', type: 'file' },
    { id: 'parent', name: 'Parent', type: 'link', table: 'spend' },
  ],
};

const BAD = [
  {
    id: 'b1',
    look: 'button',
    show: { label: 'Go', variant: 'icon' },
    opens: 'page:nope',
  },
  { id: 's1', look: 'entry', show: { title: 'Go', icon: 'star' }, opens: 'page:gone' },
  { id: 't1', look: 'entry', opens: 'package:pdf' },
  { id: 'g1', look: 'packages', source: { catalog: 'packages', ids: ['image', 'nope', 'image'] } },
  { id: 'w1', look: 'action', tools: [{ tool: 'missing' }] },
  {
    id: 'l1',
    look: 'checklist',
    source: {
      table: 'spend',
      sort: { field: 'parent', direction: 'asc' },
      filter: [
        { field: 'parent', op: 'is', value: 'a' },
        { field: 'title', op: 'gt', value: 3 },
        { field: 'ghost', op: 'isEmpty' },
      ],
      limit: 10,
    },
    show: { title: 'nope', subtitles: ['createdAt', 'x1'], trailing: 'x2' },
    tools: [{ as: 'check', do: 'toggle', table: 'spend', field: 'title' }],
  },
  {
    id: 'l2',
    look: 'list',
    source: { table: 'spend', sort: { field: 'x4', direction: 'asc' }, limit: 10 },
    show: { title: 'title' },
    tools: [{ as: 'check', do: 'toggle', table: 'spend', field: 'x3' }],
  },
  { id: 'l3', look: 'list', source: { table: 'nope', limit: 10 }, show: { title: 'title' } },
  {
    id: 'f1',
    look: 'form',
    show: { mode: 'inline' },
    tools: [
      {
        as: 'submit',
        label: 'Add',
        do: 'create',
        table: 'spend',
        ask: ['amount', 'total', 'receipt', 'x5', 'amount'],
      },
    ],
  },
  {
    id: 'st1',
    look: 'number',
    show: { label: 'Sum' },
    source: {
      table: 'spend',
      aggregate: 'sum',
      field: 'title',
      group: { by: 'day' },
      filter: [{ field: 'day', op: 'inPeriod', value: 'someday' }],
    },
  },
  {
    id: 'st2',
    look: 'number',
    show: { label: 'Avg' },
    source: { table: 'spend', aggregate: 'avg', group: { by: 'title' } },
  },
  {
    id: 'c1',
    look: 'chart',
    show: { kind: 'pie', title: 'Chart' },
    source: {
      table: 'spend',
      aggregate: 'sum',
      group: { unit: 'week', by: 'title' },
      filter: [{ field: 'kind', op: 'is', value: 'nope' }],
    },
  },
  {
    id: 'c2',
    look: 'chart',
    show: { kind: 'bar', title: 'Chart' },
    source: { table: 'spend', aggregate: 'count', group: { by: 'title' } },
  },
  {
    id: 'grp',
    look: 'group',
    show: { layout: 'row' },
    children: [
      { id: 'b2', look: 'button', show: { label: 'Go', variant: 'text' }, opens: 'page:none' },
    ],
  },
  {
    id: 'k1',
    look: 'board',
    source: { table: 'spend', limit: 10, group: { by: 'kind' } },
    show: { title: 'title' },
    tools: [
      { as: 'drag', do: 'set', table: 'spend', field: 'day', value: '$group' },
      { as: 'addHere', do: 'create', table: 'spend', ask: 'all' },
    ],
  },
  {
    id: 'fl1',
    look: 'files',
    show: { title: 'Files' },
    source: { table: '$files', filter: [{ field: 'kind', op: 'is', value: 'zip' }], limit: 5 },
  },
] as unknown as Component[];

function withComponents(components: Component[]): WorkspaceConfig {
  const config = fromV33(v33Fixture('default-en'));
  const [home, ...rest] = config.containers.pages;
  return {
    ...config,
    data: { tables: [table] },
    containers: { pages: [{ ...home!, blocks: [...home!.blocks, ...components] }, ...rest] },
  } as WorkspaceConfig;
}

describe('component issues', () => {
  it('lists every reference problem in a stable order and wording', () => {
    const result = validateWorkspace(withComponents(BAD), registry);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues).toMatchSnapshot();
  });

  for (const locale of ['en', 'zh', 'fr'] as Locale[]) {
    it(`describes every component in ${locale}`, () => {
      const config = withComponents([]);
      const ctx = { registry, locale, now: new Date(2026, 9, 27) };
      const samples = [
        ...BAD,
        { id: 'h', look: 'header', show: { title: 'Hello' } },
        { id: 'tx', look: 'text', show: { text: 'Hi' } },
        { id: 'fp', look: 'picker', tools: [{ tool: '$pick.media' }] },
        { id: 'fp2', look: 'picker', tools: [{ tool: '$pick.files' }] },
        { id: 'tg', look: 'packages', source: { catalog: 'packages' } },
        {
          id: 'cl',
          look: 'entry',
          show: { title: 'More', icon: 'plus', shape: 'tile', accent: true },
          opens: 'tools',
        },
        { id: 'slot', look: 'entry', show: { title: 'Passport' }, opens: { file: null } },
        { id: 'q1', look: 'library', source: { catalog: 'quickActions' } },
        { id: 'q2', look: 'library', source: { catalog: 'quickActions', kind: 'image' } },
        { id: 'n', look: 'notice', show: { text: 'Note' } },
        { id: 'i1', look: 'image', show: { aspect: 'wide', fit: 'cover' } },
        { id: 'i2', look: 'image', show: { aspect: 'wide', fit: 'cover', caption: 'Cap' } },
        { id: 'd', look: 'divider' },
        { id: 'sp', look: 'spacer', show: { size: 'small' } },
        { id: 'gs', look: 'group', show: { layout: 'stack', title: 'Box' }, children: [] },
        { id: 'gg', look: 'group', show: { layout: 'grid' }, children: [] },
        { id: 'u', look: '$unknown', raw: { id: 'u', type: 'future' } },
      ] as unknown as Component[];
      expect(samples.map((c) => componentLabel(c, config, ctx))).toMatchSnapshot();
    });
  }
});
