import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { groupRecords, groupedAggregate, type DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import type { Op } from './ops';
import type { Collection, NewComponent } from './schema';
import { minusValue } from './stat-minus';
import { registry } from './test-helpers';

// 统计和图表按引用字段分组（D-336）、统计相减（D-337）。例子是零基预算：分类、分配、流水三张表。

const categories: Collection = {
  id: 'categories',
  name: 'Categories',
  fields: [{ id: 'name', name: 'Name', type: 'text', required: true }],
};
const assigned: Collection = {
  id: 'assigned',
  name: 'Assigned',
  fields: [
    { id: 'amount', name: 'Amount', type: 'money', currency: 'USD', required: true },
    { id: 'day', name: 'Day', type: 'date', default: 'today' },
    { id: 'category', name: 'Category', type: 'link', collectionId: 'categories' },
  ],
};
const ledger: Collection = {
  id: 'ledger',
  name: 'Ledger',
  fields: [
    { id: 'amount', name: 'Amount', type: 'money', currency: 'USD', required: true },
    { id: 'day', name: 'Day', type: 'date', default: 'today' },
    {
      id: 'kind',
      name: 'Kind',
      type: 'choice',
      options: [
        { id: 'out', label: 'Spending' },
        { id: 'in', label: 'Income' },
      ],
    },
    { id: 'category', name: 'Category', type: 'link', collectionId: 'categories' },
    { id: 'euros', name: 'Euros', type: 'money', currency: 'EUR' },
    { id: 'note', name: 'Note', type: 'text' },
  ],
};

let seq = 0;
const rec = (collectionId: string, values: Record<string, unknown>, createdAt = 0): DataRecord => ({
  id: `r${++seq}`,
  collectionId,
  values,
  createdAt,
  updatedAt: createdAt,
});

const rent = { ...rec('categories', { name: 'Rent' }, 2), id: 'rent' };
const food = { ...rec('categories', { name: 'Food' }, 1), id: 'food' };
const fun = { ...rec('categories', { name: 'Fun' }, 3), id: 'fun' };
const targets = { collection: categories, records: [rent, food, fun], locale: 'en' as const };

const ctx = { registry, locale: 'en' as const, now: new Date(2026, 9, 30) };
const withComponent = (component: NewComponent, extra: Op[] = []) =>
  prepareOps(
    createDefaultWorkspace('en'),
    [
      ...[categories, assigned, ledger].map((collection) => ({
        op: 'addCollection' as const,
        collection,
      })),
      ...extra,
      { op: 'addComponent', pageId: 'home', component },
    ],
    ctx,
  );
const issues = (component: NewComponent, extra: Op[] = []) => {
  const r = withComponent(component, extra);
  return r.ok ? '' : r.issues.join('\n');
};

describe('grouping by a link field (D-336)', () => {
  const spending = [
    rec('ledger', { amount: 30, category: 'food' }),
    rec('ledger', { amount: 12.5, category: 'food' }),
    rec('ledger', { amount: 900, category: 'rent' }),
    rec('ledger', { amount: 7 }),
    rec('ledger', { amount: 5, category: 'deleted-category' }),
  ];

  it('one row per entry of the linked table, oldest first, with entries that link nothing last', () => {
    expect(
      groupedAggregate(spending, ledger, 'sum', 'amount', 'category', 'None', targets),
    ).toEqual([
      { optionId: 'food', label: 'Food', count: 2, value: 42.5 },
      { optionId: 'rent', label: 'Rent', count: 1, value: 900 },
      // 没有记录的分类也列出来（和单选的选项一样）。
      { optionId: 'fun', label: 'Fun', count: 0, value: 0 },
      // 没选的、指向已删除记录的算「未选」。
      { optionId: null, label: 'None', count: 2, value: 12 },
    ]);
  });

  it('groups stay in the same order for the records of the previous period', () => {
    const groups = groupRecords([], ledger, 'category', 'None', targets);
    expect(groups.map((g) => g.optionId)).toEqual(['food', 'rent', 'fun']);
  });

  it('a stat and a chart may group by a link field; a text field still is not allowed', () => {
    const stat = (groupBy: string): NewComponent => ({
      id: 's',
      type: 'stat',
      props: { collectionId: 'ledger', aggregate: 'sum', fieldId: 'amount', label: 'By', groupBy },
    });
    expect(issues(stat('category'))).toBe('');
    expect(issues(stat('note'))).toMatch(/groupBy note must be a choice or link field of ledger/);
    const chart = (choiceField: string, kind: 'bar' | 'pie' = 'pie'): NewComponent => ({
      id: 'c',
      type: 'chart',
      props: {
        collectionId: 'ledger',
        kind,
        aggregate: 'sum',
        fieldId: 'amount',
        group: 'choice',
        choiceField,
        title: 'Spending',
      },
    });
    expect(issues(chart('category'))).toBe('');
    expect(issues(chart('category', 'bar'))).toBe('');
    expect(issues(chart('note'))).toMatch(/choiceField set to a choice or link field/);
  });
});

describe('stat minus another total (D-337)', () => {
  const readyToAssign = (minus: unknown, extra: Record<string, unknown> = {}): NewComponent =>
    ({
      id: 'rta',
      type: 'stat',
      props: {
        collectionId: 'ledger',
        aggregate: 'sum',
        fieldId: 'amount',
        filter: [{ field: 'kind', op: 'is', value: 'in' }],
        label: 'Ready to assign',
        minus,
        ...extra,
      },
    }) as NewComponent;
  const allAssigned = { collectionId: 'assigned', aggregate: 'sum', fieldId: 'amount' };

  it('income minus everything assigned', () => {
    expect(issues(readyToAssign(allAssigned))).toBe('');
    const records = [
      rec('assigned', { amount: 2000, day: '2026-09-01' }),
      rec('assigned', { amount: 800.25, day: '2026-10-01' }),
      rec('assigned', { amount: -50 }),
    ];
    expect(minusValue(3000, allAssigned as never, assigned, records, ctx.now)).toBe(249.75);
    // 被减的一方也能筛选（只减本月分配的）。
    expect(
      minusValue(
        3000,
        { ...allAssigned, filter: [{ field: 'day', op: 'inPeriod', value: 'thisMonth' }] } as never,
        assigned,
        records,
        ctx.now,
      ),
    ).toBe(2199.75);
    // 计数相减：没有被减的记录时就是原来的数。
    expect(
      minusValue(
        4,
        { collectionId: 'assigned', aggregate: 'count' } as never,
        assigned,
        [],
        ctx.now,
      ),
    ).toBe(4);
    expect(minusValue(null, allAssigned as never, assigned, records, ctx.now)).toBeNull();
  });

  it('only count and sum can be subtracted, in the same unit', () => {
    expect(issues(readyToAssign(allAssigned, { aggregate: 'avg' }))).toMatch(
      /minus only works with aggregate count or sum/,
    );
    expect(issues(readyToAssign({ ...allAssigned, aggregate: 'avg' }))).not.toBe('');
    expect(issues(readyToAssign({ collectionId: 'assigned', aggregate: 'sum' }))).toMatch(
      /minus: sum needs fieldId set to a number, money, rating, duration or formula field of assigned/,
    );
    expect(issues(readyToAssign({ ...allAssigned, collectionId: 'nope' }))).toMatch(
      /minus: data table nope does not exist/,
    );
    expect(
      issues(readyToAssign({ ...allAssigned, fieldId: 'euros', collectionId: 'ledger' })),
    ).toMatch(/minus: ledger\.euros is in EUR but ledger\.amount is in USD/);
    expect(
      issues(readyToAssign({ ...allAssigned, filter: [{ field: 'nope', op: 'isEmpty' }] })),
    ).toMatch(/minus: .*nope/);
    expect(issues(readyToAssign(allAssigned, { groupBy: 'category' }))).toMatch(
      /minus can't be used with groupBy/,
    );
    expect(issues(readyToAssign(allAssigned, { compare: 'previous' }))).toMatch(
      /minus can't be used with compare/,
    );
  });

  it('removing the subtracted table removes the stat, like its own table', () => {
    const r = withComponent(readyToAssign(allAssigned), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = prepareOps(r.after, [{ op: 'removeCollection', collectionId: 'assigned' }], ctx);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(JSON.stringify(after.after.pages)).not.toContain('"rta"');
  });
});
