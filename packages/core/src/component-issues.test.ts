import { describe, expect, it } from 'vitest';

import { componentLabel } from './describe';
import type { Component, Locale, WorkspaceConfig } from './schema';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 每种组件的引用问题和修改说明（组件登记表重构时存的基线）。问题文字会发给 AI 让它改正，
// 说明文字给用户看；这里锁住文字和顺序。

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
    { id: 'parent', name: 'Parent', type: 'link', collectionId: 'spend' },
  ],
};

const BAD: Component[] = [
  { id: 'b1', type: 'button', props: { label: 'Go', target: 'page:nope', variant: 'icon' } },
  { id: 's1', type: 'shortcut', props: { title: 'Go', icon: 'star', target: 'page:gone' } },
  { id: 't1', type: 'toolCard', props: { toolId: 'pdf' } },
  { id: 'g1', type: 'toolGrid', props: { toolIds: ['image', 'nope', 'image'] } },
  { id: 'w1', type: 'workflowRunner', props: { workflowId: 'missing' } },
  {
    id: 'l1',
    type: 'recordList',
    props: {
      collectionId: 'spend',
      display: 'checklist',
      titleField: 'nope',
      subtitleFields: ['createdAt', 'x1'],
      trailingField: 'x2',
      checkField: 'title',
      sort: { field: 'parent', direction: 'asc' },
      filter: [
        { field: 'parent', op: 'is', value: 'a' },
        { field: 'title', op: 'gt', value: 3 },
        { field: 'ghost', op: 'isEmpty' },
      ],
      limit: 10,
    },
  },
  {
    id: 'l2',
    type: 'recordList',
    props: {
      collectionId: 'spend',
      display: 'list',
      titleField: 'title',
      checkField: 'x3',
      sort: { field: 'x4', direction: 'asc' },
      limit: 10,
    },
  },
  {
    id: 'l3',
    type: 'recordList',
    props: { collectionId: 'nope', display: 'list', titleField: 'title', limit: 10 },
  },
  {
    id: 'f1',
    type: 'recordForm',
    props: {
      collectionId: 'spend',
      fieldIds: ['amount', 'total', 'receipt', 'x5', 'amount'],
      submitLabel: 'Add',
      mode: 'inline',
    },
  },
  {
    id: 'st1',
    type: 'stat',
    props: {
      collectionId: 'spend',
      aggregate: 'sum',
      fieldId: 'title',
      label: 'Sum',
      groupBy: 'day',
      filter: [{ field: 'day', op: 'inPeriod', value: 'someday' }],
    },
  },
  {
    id: 'st2',
    type: 'stat',
    props: { collectionId: 'spend', aggregate: 'avg', label: 'Avg', groupBy: 'title' },
  },
  {
    id: 'c1',
    type: 'chart',
    props: {
      collectionId: 'spend',
      kind: 'pie',
      aggregate: 'sum',
      group: 'week',
      dateField: 'title',
      title: 'Chart',
      filter: [{ field: 'kind', op: 'is', value: 'nope' }],
    },
  },
  {
    id: 'c2',
    type: 'chart',
    props: {
      collectionId: 'spend',
      kind: 'bar',
      aggregate: 'count',
      group: 'choice',
      choiceField: 'title',
      title: 'Chart',
    },
  },
  {
    id: 'grp',
    type: 'group',
    props: { layout: 'row' },
    children: [
      { id: 'b2', type: 'button', props: { label: 'Go', target: 'page:none', variant: 'text' } },
    ],
  },
] as Component[];

function withComponents(components: Component[]): WorkspaceConfig {
  const config = workspace('en');
  return {
    ...config,
    collections: [table],
    pages: [{ ...config.pages[0]!, components: [...config.pages[0]!.components, ...components] }],
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
      const samples: Component[] = [
        ...BAD,
        { id: 'h', type: 'header', props: { title: 'Hello' } },
        { id: 'tx', type: 'text', props: { text: 'Hi' } },
        { id: 'fp', type: 'filePick', props: { source: 'media' } },
        { id: 'fp2', type: 'filePick', props: { source: 'files' } },
        { id: 'tg', type: 'toolGrid', props: {} },
        { id: 'cl', type: 'catalogLink', props: { title: 'More' } },
        { id: 'fl', type: 'fileList', props: { title: 'Files', limit: 3 } },
        { id: 'q1', type: 'quickActionList', props: {} },
        { id: 'q2', type: 'quickActionList', props: { kind: 'image' } },
        { id: 'n', type: 'notice', props: { text: 'Note' } },
        { id: 'i1', type: 'image', props: { aspect: 'wide', fit: 'cover' } },
        { id: 'i2', type: 'image', props: { aspect: 'wide', fit: 'cover', caption: 'Cap' } },
        { id: 'd', type: 'divider', props: {} },
        { id: 'sp', type: 'spacer', props: { size: 'small' } },
        { id: 'gs', type: 'group', props: { layout: 'stack', title: 'Box' }, children: [] },
        { id: 'gg', type: 'group', props: { layout: 'grid' }, children: [] },
      ];
      expect(samples.map((c) => componentLabel(c, config, ctx))).toMatchSnapshot();
    });
  }
});
