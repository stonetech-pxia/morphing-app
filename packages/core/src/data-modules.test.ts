import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import {
  formatRef,
  groupedAggregate,
  makeLinkResolver,
  prepareRecordValues,
  recordsToCsv,
  type DataRecord,
} from './data';
import type { Op } from './ops';
import type { Collection, NewComponent } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';

const createDefaultWorkspace = (locale: 'zh') => fromV33(v33Fixture(`default-${locale}`));

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
const withComponent = (component: NewComponent) =>
  prepareOps(
    createDefaultWorkspace('zh'),
    [
      { op: 'addData', table: tasks },
      { op: 'addContainer', page: 'home', block: component },
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
    const stat = (by: string): NewComponent => ({
      id: 's',
      look: 'number',
      show: { label: '数量' },
      source: { table: 'tasks', aggregate: 'count', group: { by } },
    });
    expect(withComponent(stat('status')).ok).toBe(true);
    expect(withComponent(stat('title')).ok).toBe(false);
    expect(withComponent(stat('missing')).ok).toBe(false);
  });
});

// ---- 表和表之间引用（D-250）----

const clients: Collection = {
  id: 'clients',
  name: '客户',
  fields: [
    { id: 'name', name: '名字', type: 'text' },
    { id: 'city', name: '城市', type: 'text' },
  ],
};
const orders: Collection = {
  id: 'orders',
  name: '订单',
  fields: [
    { id: 'item', name: '商品', type: 'text' },
    { id: 'client', name: '客户', type: 'link', table: 'clients' },
  ],
};
const clientRec = (id: string, name: string): DataRecord => ({
  id,
  collectionId: 'clients',
  values: { name },
  createdAt: 0,
  updatedAt: 0,
});
const orderRec = (id: string, client?: string): DataRecord => ({
  id,
  collectionId: 'orders',
  values: { item: '书', ...(client ? { client } : {}) },
  createdAt: 0,
  updatedAt: 0,
});

describe('link fields (D-250)', () => {
  const tables = (extra: Op[] = []) =>
    prepareOps(
      createDefaultWorkspace('zh'),
      [{ op: 'addData', table: clients }, { op: 'addData', table: orders }, ...extra],
      ctx,
    );

  it('shows the title of the linked entry, and “Deleted entry” once it is gone', () => {
    const live = makeLinkResolver(
      [clients, orders],
      new Map([['clients', [clientRec('c1', '王小明')]]]),
      'zh',
    );
    expect(formatRef(orderRec('o1', 'c1'), orders, 'client', 'zh', live)).toBe('王小明');
    // 被引用的记录删掉了（读不到）：说清楚，而不是显示空白。
    const gone = makeLinkResolver([clients, orders], new Map([['clients', []]]), 'zh');
    expect(formatRef(orderRec('o1', 'c1'), orders, 'client', 'zh', gone)).toBe('已删除的记录');
    expect(formatRef(orderRec('o2'), orders, 'client', 'zh', gone)).toBe('');
    expect(recordsToCsv(orders, [orderRec('o1', 'c1')], 'zh', live)).toContain('书,王小明,');
  });

  it('stores only the id of the linked entry', () => {
    const prepared = prepareRecordValues(orders, { item: '笔', client: 'c1' }, null, new Date());
    expect(prepared).toEqual({ ok: true, values: { item: '笔', client: 'c1' } });
    expect(prepareRecordValues(orders, { client: '../x' }, null, new Date()).ok).toBe(false);
  });

  it('must link to an existing table', () => {
    expect(tables().ok).toBe(true);
    const broken = prepareOps(
      createDefaultWorkspace('zh'),
      [{ op: 'addData', table: orders }],
      ctx,
    );
    expect(broken.ok).toBe(false);
  });

  it('a linked-to table can only be removed after the link field is removed', () => {
    const refused = tables([{ op: 'removeData', table: 'clients' }]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issues.join(' ')).toMatch(/linked from orders\.client/);
    expect(
      tables([
        { op: 'removeData', table: 'orders', field: 'client' },
        { op: 'removeData', table: 'clients' },
      ]).ok,
    ).toBe(true);
  });

  it('a link field can be shown and filtered by whether it is set, not sorted or compared', () => {
    const list = (source: Record<string, unknown>): Op => ({
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'l',
        look: 'list',
        source: { table: 'orders', limit: 20, ...source },
        show: { title: 'item', subtitles: ['client'] },
      } as NewComponent,
    });
    expect(tables([list({ filter: [{ field: 'client', op: 'isNotEmpty' }] })]).ok).toBe(true);
    expect(tables([list({ filter: [{ field: 'client', op: 'is', value: 'c1' }] })]).ok).toBe(false);
    expect(tables([list({ sort: { field: 'client', direction: 'asc' } })]).ok).toBe(false);
  });
});
