import { describe, expect, it, vi } from 'vitest';

import {
  aggregateRecords,
  filterRecords,
  formatRef,
  formatValue,
  groupedAggregate,
  linkTitle,
  prepareRecordValues,
  readValue,
  recordsToCsv,
  sortRecords,
  type DataRecord,
  type LinkResolver,
} from './data';
import { describeChange } from './describe';
import { recordsToHtml } from './html';
import { applyOps, type Op } from './ops';
import type { Collection, Condition, Field, Locale, WorkspaceConfig } from './schema';
import { registry, snapshotLines, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 字段类型登记表重构的基线（2026-10-27）：每种字段在读取、写入、显示、导出、打印、筛选、排序、统计、
// 公式、类型转换、修改说明里的输出。重构只换写法，这些输出必须完全不变。
// 快照一项一行（snapshotLines，2026-10-27 起），内容和原来的展开写法相同。

// 快照里的时间按本地时区显示，固定时区，换台机器（例如云端的 UTC）也一样。
process.env.TZ = 'Europe/Paris';

const LOCALES: Locale[] = ['en', 'zh', 'fr'];
const NOW = new Date(2026, 9, 27, 10, 30);
// 公式里的 today 读系统时间：固定成 NOW，不然快照每过一天就对不上。
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(NOW);

const FIELDS: Field[] = [
  { id: 't', name: 'Title', type: 'text', default: 'Untitled' },
  { id: 'n', name: 'Note', type: 'note' },
  { id: 'num', name: 'Weight', type: 'number', decimals: 1, unit: 'kg' },
  { id: 'num2', name: 'Count', type: 'number', default: 3 },
  { id: 'm', name: 'Price', type: 'money', currency: 'CNY' },
  { id: 'm2', name: 'Prix', type: 'money', currency: 'EUR', default: 5 },
  { id: 'm3', name: 'Other', type: 'money', currency: 'CHF' },
  { id: 'cb', name: 'Done', type: 'checkbox', default: true },
  { id: 'd', name: 'Day', type: 'date', default: 'today' },
  {
    id: 'ch',
    name: 'Kind',
    type: 'choice',
    options: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ],
    default: 'b',
  },
  { id: 'r', name: 'Stars', type: 'rating', default: 4 },
  { id: 'f', name: 'Receipt', type: 'file' },
  { id: 'l', name: 'Client', type: 'link', collectionId: 'clients' },
  { id: 'fo', name: 'Double', type: 'formula', expression: '{num} * 2', decimals: 1, unit: 'kg' },
  { id: 'fo2', name: 'Plus', type: 'formula', expression: '{m} + 1', currency: 'USD' },
  { id: 'fo3', name: 'Left', type: 'formula', expression: 'days(today, {d})', decimals: 0 },
];

const table: Collection = { id: 'items', name: 'Items', fields: FIELDS };
const clients: Collection = {
  id: 'clients',
  name: 'Clients',
  fields: [{ id: 'name', name: 'Name', type: 'text' }],
};

const INPUTS: unknown[] = [
  undefined,
  null,
  '',
  '   ',
  ' 12 ',
  '1,234.567',
  12.3456,
  0,
  -5,
  1e13,
  4,
  6,
  'abc',
  true,
  false,
  '2026-02-30',
  '2026-10-27',
  ' 2026-10-27 ',
  'a',
  'zz',
  'file_1',
  'bad id!',
  'x'.repeat(201),
  'y'.repeat(5001),
  'trailing  \n',
];

const links: LinkResolver = (collectionId, id) =>
  collectionId === 'clients' && id === 'c1' ? 'ACME' : null;

const record = (id: string, values: Record<string, unknown>, at: number): DataRecord => ({
  id,
  collectionId: 'items',
  values,
  createdAt: at,
  updatedAt: at + 1,
});

const RECORDS: DataRecord[] = [
  record(
    'r1',
    {
      t: 'Apple, "red"',
      n: 'line1\nline2',
      num: 2.5,
      num2: 1234567,
      m: 12.5,
      m2: -3,
      m3: 1000,
      cb: true,
      d: '2026-10-27',
      ch: 'a',
      r: 5,
      f: 'file_1',
      l: 'c1',
    },
    Date.UTC(2026, 9, 20, 8),
  ),
  record(
    'r2',
    { t: 'banana', num: 10, m: 3, cb: false, d: '2026-10-01', ch: 'b', r: 1, l: 'gone' },
    Date.UTC(2026, 9, 21, 8),
  ),
  record('r3', { t: 'cherry', num: 'bad', m: null, d: '2026-13-01', ch: 'zz', r: 9 }, 3),
  record('r4', {}, Date.UTC(2026, 9, 22, 8)),
];

describe('field baseline', () => {
  it('reads raw values', () => {
    const out: Record<string, unknown[]> = {};
    for (const f of FIELDS) out[f.id] = INPUTS.map((raw) => readValue(f, raw) ?? '∅');
    expect(snapshotLines(out)).toMatchSnapshot();
  });

  it('cleans and checks values on write', () => {
    const out: Record<string, unknown> = {};
    for (const f of FIELDS) {
      for (const required of [false, true]) {
        const c: Collection = { ...table, fields: [{ ...f, required } as Field] };
        out[`${f.id}${required ? '!' : ''}`] = {
          blank: prepareRecordValues(c, {}, null, NOW),
          inputs: INPUTS.map((input) => prepareRecordValues(c, { [f.id]: input }, null, NOW)),
          keep: prepareRecordValues(c, {}, { [f.id]: 'old', other: 1 }, NOW),
        };
      }
    }
    expect(snapshotLines(out)).toMatchSnapshot();
  });

  for (const locale of LOCALES) {
    it(`displays and exports in ${locale}`, () => {
      const format: Record<string, unknown[]> = {};
      for (const f of FIELDS) {
        format[f.id] = INPUTS.map((raw) => formatValue(f, raw, locale, links));
        format[`${f.id}-nolinks`] = INPUTS.map((raw) => formatValue(f, raw, locale));
      }
      const refs = Object.fromEntries(
        RECORDS.map((r) => [
          r.id,
          [...FIELDS.map((f) => f.id), 'createdAt', 'updatedAt', 'ghost'].map((ref) =>
            formatRef(r, table, ref, locale, links),
          ),
        ]),
      );
      const html = (['table', 'cards', 'receipt'] as const).map((template) =>
        recordsToHtml(table, RECORDS, {
          template,
          title: 'Report',
          fields: [],
          pageSize: 'a4',
          locale,
          now: NOW,
          links,
        }),
      );
      const receiptNumberOnly = recordsToHtml(table, RECORDS, {
        template: 'receipt',
        title: '',
        fields: ['t', 'num', 'r'],
        pageSize: 'a4',
        locale,
        now: NOW,
      });
      expect(
        snapshotLines({
          format,
          refs,
          csv: recordsToCsv(table, RECORDS, locale, links),
          csvNoLinks: recordsToCsv(table, RECORDS, locale),
          html,
          receiptNumberOnly,
          titles: [
            linkTitle(RECORDS[0]!, table, locale),
            linkTitle(RECORDS[3]!, table, locale),
            ...(['n', 'ch', 'num', 'm', 'd', 'cb'] as const).map((id) =>
              linkTitle(
                RECORDS[0]!,
                { ...table, fields: FIELDS.filter((f) => f.id === id) },
                locale,
              ),
            ),
          ],
        }),
      ).toMatchSnapshot();
    });
  }

  it('filters, sorts and counts', () => {
    const ops: Condition['op'][] = [
      'is',
      'isNot',
      'contains',
      'gt',
      'lt',
      'isEmpty',
      'isNotEmpty',
      'inPeriod',
    ];
    const values: Condition['value'][] = [
      undefined,
      'a',
      'Apple',
      2,
      10,
      true,
      '2026-10-15',
      'thisMonth',
    ];
    const filters: Record<string, string[]> = {};
    for (const ref of [...FIELDS.map((f) => f.id), 'createdAt']) {
      for (const op of ops) {
        for (const value of values) {
          // 不在白名单里的时间段校验时就拦下了（matchesCondition 不处理）。
          if (op === 'inPeriod' && typeof value === 'string' && value !== 'thisMonth') continue;
          const cond = { field: ref, op, ...(value === undefined ? {} : { value }) } as Condition;
          filters[`${ref} ${op} ${String(value)}`] = filterRecords(RECORDS, table, [cond], NOW).map(
            (r) => r.id,
          );
        }
      }
    }
    const sorts: Record<string, string[]> = {};
    for (const ref of [...FIELDS.map((f) => f.id), 'createdAt', 'updatedAt']) {
      for (const direction of ['asc', 'desc'] as const) {
        sorts[`${ref} ${direction}`] = sortRecords(RECORDS, table, { field: ref, direction }).map(
          (r) => r.id,
        );
      }
    }
    const stats: Record<string, unknown> = {};
    for (const f of FIELDS) {
      for (const agg of ['count', 'sum', 'avg', 'min', 'max'] as const) {
        stats[`${f.id} ${agg}`] = aggregateRecords(RECORDS, table, agg, f.id);
      }
    }
    expect(
      snapshotLines({
        filters,
        sorts,
        stats,
        grouped: groupedAggregate(RECORDS, table, 'sum', 'm', 'ch', 'none'),
        groupedNotChoice: groupedAggregate(RECORDS, table, 'count', undefined, 't', 'none'),
      }),
    ).toMatchSnapshot();
  });

  it('validates filters, sorts, formulas and field references', () => {
    const base = workspace('en');
    const config = { ...base, collections: [table, clients] } as WorkspaceConfig;
    const issues = (extra: Partial<WorkspaceConfig>) => {
      const result = validateWorkspace({ ...config, ...extra }, registry);
      return result.ok ? [] : result.issues.map((i) => i.message);
    };
    const values: Condition['value'][] = [undefined, 'a', 'zz', 2, true, '2026-10-15', 'thisMonth'];
    const ops: Condition['op'][] = [
      'is',
      'isNot',
      'contains',
      'gt',
      'lt',
      'isEmpty',
      'isNotEmpty',
      'inPeriod',
    ];
    const conditions: Condition[] = [];
    for (const ref of [...FIELDS.map((f) => f.id), 'createdAt'])
      for (const op of ops)
        for (const value of values)
          conditions.push({
            field: ref,
            op,
            ...(value === undefined ? {} : { value }),
          } as Condition);
    const filterIssues: string[] = [];
    for (let i = 0; i < conditions.length; i += 5) {
      const page = base.pages[0]!;
      filterIssues.push(
        ...issues({
          pages: [
            {
              ...page,
              components: [
                {
                  id: 'list',
                  type: 'recordList',
                  props: {
                    collectionId: 'items',
                    display: 'list',
                    titleField: 't',
                    limit: 5,
                    filter: conditions.slice(i, i + 5),
                  },
                },
              ],
            },
            ...base.pages.slice(1),
          ],
        }),
      );
    }
    const formulaIssues = FIELDS.map((f) =>
      issues({
        collections: [
          {
            ...table,
            fields: [
              ...FIELDS,
              { id: 'z', name: 'Z', type: 'formula', expression: `{${f.id}} + 1` },
            ],
          },
          clients,
        ],
      }),
    );
    const sortIssues = FIELDS.map((f) =>
      issues({
        pages: [
          {
            ...base.pages[0]!,
            components: [
              {
                id: 'list',
                type: 'recordList',
                props: {
                  collectionId: 'items',
                  display: 'list',
                  titleField: 't',
                  limit: 5,
                  sort: { field: f.id, direction: 'asc' },
                },
              },
              {
                id: 'stat',
                type: 'stat',
                props: { collectionId: 'items', aggregate: 'sum', fieldId: f.id, label: 'S' },
              },
              {
                id: 'form',
                type: 'recordForm',
                props: {
                  collectionId: 'items',
                  fieldIds: [f.id],
                  submitLabel: 'Add',
                  mode: 'inline',
                },
              },
            ],
          },
          ...base.pages.slice(1),
        ],
      }),
    );
    expect(snapshotLines({ filterIssues, formulaIssues, sortIssues })).toMatchSnapshot();
  });

  it('switches field types and describes field changes', () => {
    const base = { ...workspace('en'), collections: [table, clients] } as WorkspaceConfig;
    const types = [
      'text',
      'note',
      'number',
      'money',
      'checkbox',
      'date',
      'choice',
      'rating',
      'file',
      'link',
      'formula',
    ];
    const switches: Record<string, string> = {};
    for (const f of FIELDS.slice(0, 13)) {
      for (const type of types) {
        const changes: Record<string, unknown> = { type };
        if (type === 'money') changes.currency = 'USD';
        const result = applyOps(
          base,
          [{ op: 'updateField', collectionId: 'items', fieldId: f.id, changes } as Op],
          {
            registry,
            locale: 'en',
          },
        );
        switches[`${f.id}->${type}`] = result.ok ? 'ok' : result.error;
      }
    }
    const described: Record<string, string[]> = {};
    for (const locale of LOCALES) {
      const ctx = { registry, locale, now: NOW };
      described[locale] = FIELDS.flatMap((f) => [
        ...describeChange(
          [{ op: 'addField', collectionId: 'items', field: { ...f, id: `${f.id}x` } }],
          base,
          [],
          ctx,
        ),
        ...describeChange(
          [{ op: 'updateField', collectionId: 'items', fieldId: f.id, changes: { type: 'note' } }],
          base,
          [],
          ctx,
        ),
      ]);
    }
    expect(snapshotLines({ switches, described })).toMatchSnapshot();
  });
});
