import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { browseSort, listGroups, searchRecords } from './list-groups';
import type { DataRecord } from './data';
import type { Op } from './ops';
import type { Collection, WorkspaceConfig } from './schema';
import { registry, workspace } from './test-helpers';

// 列表上的搜索和能换的排序、分组（show.browse），按表有没有记录显示（showIf），只显示一条记录（single）（D-424）。

const ctx = { registry, locale: 'en' as const, now: new Date(0) };

const TABLE: Collection = {
  id: 'people',
  name: 'People',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'company', name: 'Company', type: 'text' },
    { id: 'tag', name: 'Tag', type: 'choice', options: [{ id: 'a', label: 'A' }] },
    { id: 'age', name: 'Age', type: 'number' },
    { id: 'day', name: 'Day', type: 'date' },
    { id: 'memo', name: 'Memo', type: 'note' },
    { id: 'pic', name: 'Pic', type: 'file' },
    { id: 'other', name: 'Other', type: 'link', table: 'people' },
  ],
};

const block = (extra: object = {}, show: object = {}) => ({
  id: 'list',
  look: 'list',
  source: { table: 'people' },
  show: { title: 'name', ...show },
  ...extra,
});

function withBlocks(...blocks: object[]): WorkspaceConfig {
  const r = prepareOps(
    workspace('en'),
    [
      { op: 'addData', table: TABLE },
      { op: 'addContainer', page: { id: 'p', title: 'P', blocks } } as unknown as Op,
    ],
    ctx,
  );
  if (!r.ok) throw new Error(r.issues.join('; '));
  return r.after;
}

const issues = (...blocks: object[]) => {
  const r = prepareOps(
    workspace('en'),
    [
      { op: 'addData', table: TABLE },
      { op: 'addContainer', page: { id: 'p', title: 'P', blocks } } as unknown as Op,
    ],
    ctx,
  );
  return r.ok ? [] : r.issues;
};

const blockOf = (config: WorkspaceConfig, id = 'list') =>
  config.containers.pages.find((p) => p.id === 'p')!.blocks.find((b) => b.id === id) as
    Record<string, never> | undefined;

const rec = (id: string, values: Record<string, unknown>): DataRecord => ({
  id,
  collectionId: 'people',
  values,
  createdAt: 1,
  updatedAt: 1,
});

describe('show.browse settings', () => {
  it('takes fields, also createdAt, and text fields can be group options', () => {
    expect(
      issues(
        block(
          {},
          { browse: { search: true, sort: ['name', 'createdAt'], group: ['company', 'tag'] } },
        ),
      ),
    ).toEqual([]);
  });

  it('refuses fields that do not exist, that cannot be sorted or grouped, and the wrong looks', () => {
    expect(issues(block({}, { browse: { sort: ['nope'] } })).join()).toMatch(/nope/);
    expect(issues(block({}, { browse: { group: ['nope'] } })).join()).toMatch(/nope/);
    expect(issues(block({}, { browse: { sort: ['other'] } })).join()).toMatch(/can't sort/);
    expect(issues(block({}, { browse: { group: ['age'] } })).join()).toMatch(/show.browse.group/);
    expect(issues(block({}, { browse: {} })).join()).toMatch(/needs search, sort or group/);
    expect(issues(block({ look: 'tiles' }, { browse: { search: true } })).join()).toMatch(
      /only applies/,
    );
  });

  it('removing a field takes it off the options; the list stays', () => {
    const config = withBlocks(
      block({}, { browse: { sort: ['company', 'name'], group: ['company'] } }),
    );
    const r = prepareOps(config, [{ op: 'removeData', table: 'people', field: 'company' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect(blockOf(r.after)!.show).toEqual({ title: 'name', browse: { sort: ['name'] } });
    expect(r.lines.join()).toContain('Also updates 2 blocks that referred to it');
  });

  it('removing the last option removes browse altogether', () => {
    const config = withBlocks(block({}, { browse: { group: ['company'] } }));
    const r = prepareOps(config, [{ op: 'removeData', table: 'people', field: 'company' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect(blockOf(r.after)!.show).toEqual({ title: 'name' });
  });

  it('removing the table removes the list with its settings', () => {
    const config = withBlocks(block({}, { browse: { search: true, sort: ['name'] } }));
    const r = prepareOps(config, [{ op: 'removeData', table: 'people' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect(blockOf(r.after)).toBeUndefined();
  });
});

describe('search', () => {
  const texts = (r: DataRecord) => [String(r.values.name ?? ''), String(r.values.company ?? '')];
  const list = [
    rec('a', { name: 'Maria Garcia', company: 'ACME Inc.' }),
    rec('b', { name: '张三', company: '北京测试有限公司' }),
    rec('c', { name: 'Ｆｕｌｌ Width' }),
  ];
  const ids = (q: string) => searchRecords(list, q, texts).map((r) => r.id);

  it('ignores case, finds parts of words and Chinese', () => {
    expect(ids('maria')).toEqual(['a']);
    expect(ids('acme')).toEqual(['a']);
    expect(ids('GARC')).toEqual(['a']);
    expect(ids('张')).toEqual(['b']);
    expect(ids('北京')).toEqual(['b']);
    expect(ids('full')).toEqual(['c']);
  });

  it('every word has to match, in any order', () => {
    expect(ids('acme maria')).toEqual(['a']);
    expect(ids('acme 张')).toEqual([]);
  });

  it('an empty search gives everything, nothing found gives nothing', () => {
    expect(ids('   ')).toEqual(['a', 'b', 'c']);
    expect(ids('zzz')).toEqual([]);
  });

  it('finds entries beyond the display limit: it gets the whole list', () => {
    const many = Array.from({ length: 500 }, (_, i) => rec(`r${i}`, { name: `Person ${i}` }));
    expect(searchRecords(many, 'person 499', texts).map((r) => r.id)).toEqual(['r499']);
  });
});

describe('switching', () => {
  const sort = (field: string) => browseSort(field, [TABLE], 'people').direction;

  it('dates and numbers put the newest and largest first, text goes A to Z', () => {
    expect(sort('createdAt')).toBe('desc');
    expect(sort('day')).toBe('desc');
    expect(sort('age')).toBe('desc');
    expect(sort('name')).toBe('asc');
    expect(sort('tag')).toBe('asc');
  });

  it('groups by a text field: one section per value, A to Z, blanks last', () => {
    const groups = listGroups(
      [
        rec('a', { company: 'Zed' }),
        rec('b', { company: 'Acme' }),
        rec('c', { company: ' Zed ' }),
        rec('d', {}),
        rec('e', { company: '  ' }),
      ],
      TABLE,
      { by: 'company' },
      { locale: 'en', now: new Date(0), cal: { dayStartHour: 0, weekStart: 'monday' } },
    );
    expect(groups.map((g) => [g.label, g.records.map((r) => r.id)])).toEqual([
      ['Acme', ['b']],
      ['Zed', ['a', 'c']],
      ['Not filled in', ['d', 'e']],
    ]);
    expect(groups[0]!.preset).toBe('Acme');
    expect(groups[2]!.preset).toBeUndefined();
  });
});

describe('showIf', () => {
  const header = (showIf: object) => ({
    id: 'h',
    look: 'header',
    show: { title: 'T' },
    showIf,
  });

  it('names a table and some or none', () => {
    expect(issues(header({ table: 'people', has: 'none' }))).toEqual([]);
    expect(issues(header({ table: 'nope', has: 'some' })).join()).toMatch(/nope/);
    expect(issues(header({ table: 'people', has: 'maybe' })).length).toBeGreaterThan(0);
  });

  it('can be set and taken off a block', () => {
    const config = withBlocks({ id: 'h', look: 'header', show: { title: 'T' } });
    const on = prepareOps(
      config,
      [
        {
          op: 'updateContainer',
          page: 'p',
          block: 'h',
          changes: { showIf: { table: 'people', has: 'some' } },
        },
      ],
      ctx,
    );
    if (!on.ok) throw new Error(on.issues.join());
    expect(blockOf(on.after, 'h')!.showIf).toEqual({ table: 'people', has: 'some' });
    const off = prepareOps(
      on.after,
      [{ op: 'updateContainer', page: 'p', block: 'h', changes: { showIf: null } }],
      ctx,
    );
    if (!off.ok) throw new Error(off.issues.join());
    expect(blockOf(off.after, 'h')!.showIf).toBeUndefined();
  });

  it('removing the table clears the condition, says so, and keeps the block', () => {
    const config = withBlocks(header({ table: 'people', has: 'none' }));
    const r = prepareOps(config, [{ op: 'removeData', table: 'people' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect(blockOf(r.after, 'h')!.showIf).toBeUndefined();
    expect(r.lines.join()).toContain('Also updates 1 block that referred to it');
  });

  it('also inside a group', () => {
    const config = withBlocks({
      id: 'g',
      look: 'group',
      show: { layout: 'stack' },
      children: [header({ table: 'people', has: 'some' })],
    });
    const r = prepareOps(config, [{ op: 'removeData', table: 'people' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    const group = blockOf(r.after, 'g') as unknown as { children: { showIf?: object }[] };
    expect(group.children[0]!.showIf).toBeUndefined();
  });
});

describe('single', () => {
  const single = (show: object = { fields: ['name', 'company'], qr: true }) => ({
    id: 'one',
    look: 'single',
    source: { table: 'people' },
    show,
  });

  it('checks its table and fields', () => {
    expect(issues(single())).toEqual([]);
    expect(issues(single({ fields: ['nope'] })).join()).toMatch(/nope/);
    expect(issues(single({ fields: [] })).length).toBeGreaterThan(0);
    expect(issues({ ...single(), source: { table: 'nope' } }).join()).toMatch(/nope/);
  });

  it('removing a field takes it off; removing the last one removes the block', () => {
    const config = withBlocks(single());
    const r = prepareOps(config, [{ op: 'removeData', table: 'people', field: 'company' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect((blockOf(r.after, 'one')!.show as unknown as { fields: string[] }).fields).toEqual([
      'name',
    ]);
    const last = prepareOps(r.after, [{ op: 'removeData', table: 'people', field: 'name' }], ctx);
    if (!last.ok) throw new Error(last.issues.join());
    expect(blockOf(last.after, 'one')).toBeUndefined();
  });

  it('removing the table removes the block', () => {
    const r = prepareOps(withBlocks(single()), [{ op: 'removeData', table: 'people' }], ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect(blockOf(r.after, 'one')).toBeUndefined();
  });
});
