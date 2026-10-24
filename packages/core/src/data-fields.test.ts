import { describe, expect, it } from 'vitest';

import {
  aggregateRecords,
  filterRecords,
  formatRef,
  prepareRecordValues,
  recordValue,
  recordsToCsv,
  sortRecords,
  type DataRecord,
} from './data';
import { applyOps } from './ops';
import type { Collection, WorkspaceConfig } from './schema';
import { registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 附件和公式字段（D-187、D-188）。

const orders: Collection = {
  id: 'orders',
  name: '采购',
  fields: [
    { id: 'item', name: '物品', type: 'text' },
    { id: 'price', name: '单价', type: 'money', currency: 'CNY' },
    { id: 'qty', name: '数量', type: 'number' },
    { id: 'total', name: '小计', type: 'formula', expression: '{price} * {qty}', currency: 'CNY' },
    { id: 'receipt', name: '收据', type: 'file' },
  ],
};

const record = (id: string, values: Record<string, unknown>): DataRecord => ({
  id,
  collectionId: 'orders',
  values,
  createdAt: 1,
  updatedAt: 1,
});

const now = new Date(2026, 9, 24);

describe('formula fields', () => {
  const a = record('a', { item: '纸', price: 12.5, qty: 4 });
  const b = record('b', { item: '笔', price: 3, qty: 10 });
  const empty = record('c', { item: '胶水', price: 8 });

  it('compute from the other fields and show like money', () => {
    expect(recordValue(a, orders, 'total')).toBe(50);
    expect(recordValue(empty, orders, 'total')).toBeUndefined();
    expect(formatRef(a, orders, 'total', 'zh')).toBe('¥50.00');
    expect(formatRef(empty, orders, 'total', 'zh')).toBe('');
  });

  it('can be summed, sorted and filtered', () => {
    expect(aggregateRecords([a, b, empty], orders, 'sum', 'total')).toBe(80);
    expect(
      sortRecords([b, a], orders, { field: 'total', direction: 'desc' }).map((r) => r.id),
    ).toEqual(['a', 'b']);
    expect(
      filterRecords([a, b], orders, [{ field: 'total', op: 'gt', value: 40 }], now).map(
        (r) => r.id,
      ),
    ).toEqual(['a']);
  });

  it('are never stored, even when the input has a value', () => {
    const prepared = prepareRecordValues(
      orders,
      { item: '纸', price: '2', qty: '3', total: 999 },
      null,
      now,
    );
    expect(prepared).toEqual({ ok: true, values: { item: '纸', price: 2, qty: 3 } });
  });

  it('export the computed value to CSV', () => {
    expect(recordsToCsv(orders, [a], 'zh')).toContain('纸,12.50,4,50,');
  });
});

describe('attachment fields', () => {
  it('store a file id and show as an attachment', () => {
    const prepared = prepareRecordValues(orders, { item: '纸', receipt: 'asset-123' }, null, now);
    expect(prepared.ok && prepared.values.receipt).toBe('asset-123');
    expect(prepareRecordValues(orders, { receipt: '../etc/passwd' }, null, now).ok).toBe(false);
    expect(formatRef(record('r', { receipt: 'asset-123' }), orders, 'receipt', 'zh')).toBe('附件');
    expect(formatRef(record('r', { receipt: 'asset-123' }), orders, 'receipt', 'en')).toBe(
      'Attachment',
    );
  });
});

describe('validation', () => {
  const withTable = (collection: Collection): WorkspaceConfig => {
    const result = applyOps(workspace(), [{ op: 'addCollection', collection }], {
      registry,
      locale: 'zh',
    });
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };
  const issues = (config: WorkspaceConfig) => {
    const r = validateWorkspace(config, registry);
    return r.ok ? [] : r.issues.map((i) => i.message);
  };

  it('accepts a formula over number, money and rating fields', () => {
    expect(issues(withTable(orders))).toEqual([]);
  });

  it('rejects formulas that do not parse or use missing, text or formula fields', () => {
    const bad = (expression: string) =>
      issues(
        withTable({
          ...orders,
          fields: [
            ...orders.fields.filter((f) => f.id !== 'total'),
            { id: 'total', name: '小计', type: 'formula', expression },
          ],
        }),
      );
    expect(bad('{price} *')[0]).toMatch(/formula "\{price\} \*"/);
    expect(bad('{price} * {nope}')[0]).toMatch(/nope, which is not a field/);
    expect(bad('{item} * 2')[0]).toMatch(/item, which is not a number/);
  });

  it('keeps formula and attachment fields out of quick-add forms', () => {
    const result = applyOps(
      withTable(orders),
      [
        {
          op: 'addComponent',
          pageId: 'home',
          component: {
            id: 'add-order',
            type: 'recordForm',
            props: {
              collectionId: 'orders',
              fieldIds: ['item', 'total', 'receipt'],
              submitLabel: '添加',
              mode: 'inline',
            },
          },
        },
      ],
      { registry, locale: 'zh' },
    );
    if (!result.ok) throw new Error(result.error);
    expect(issues(result.config).join('\n')).toMatch(
      /total is a formula field[\s\S]*receipt is a file field/,
    );
  });
});
