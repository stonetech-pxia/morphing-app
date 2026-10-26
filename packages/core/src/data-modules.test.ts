import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { groupedAggregate, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import type { Collection, Component } from './schema';
import { registry } from './test-helpers';

// 数据组件的新能力（D-248 起）：纯逻辑和校验。

const tasks: Collection = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'hours', name: '工时', type: 'number' },
    {
      id: 'status',
      name: '状态',
      type: 'choice',
      options: [
        { id: 'todo', label: '待办' },
        { id: 'done', label: '完成' },
      ],
    },
    { id: 'title', name: '标题', type: 'text' },
  ],
};
const rec = (id: string, values: Record<string, unknown>): DataRecord => ({
  id,
  collectionId: 'tasks',
  values,
  createdAt: 0,
  updatedAt: 0,
});
const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22) };
const withComponent = (component: Component) =>
  prepareOps(
    createDefaultWorkspace('zh'),
    [
      { op: 'addCollection', collection: tasks },
      { op: 'addComponent', pageId: 'home', component },
    ],
    ctx,
  );

describe('groupedAggregate (D-248)', () => {
  it('averages per option; a deleted option counts as not set', () => {
    const records = [
      rec('a', { hours: 2, status: 'todo' }),
      rec('b', { hours: 4, status: 'todo' }),
      rec('c', { hours: 1, status: 'done' }),
      rec('d', { hours: 8, status: 'gone' }),
    ];
    expect(groupedAggregate(records, tasks, 'avg', 'hours', 'status', '未选')).toEqual([
      { optionId: 'todo', label: '待办', count: 2, value: 3 },
      { optionId: 'done', label: '完成', count: 1, value: 1 },
      { optionId: null, label: '未选', count: 1, value: 8 },
    ]);
  });

  it('only groups by a choice field', () => {
    const stat = (groupBy: string): Component => ({
      id: 's',
      type: 'stat',
      props: { collectionId: 'tasks', aggregate: 'count', label: '数量', groupBy },
    });
    expect(withComponent(stat('status')).ok).toBe(true);
    expect(withComponent(stat('title')).ok).toBe(false);
    expect(withComponent(stat('missing')).ok).toBe(false);
  });
});
