import { describe, expect, it } from 'vitest';

import { browseFilter, browseFilterRows, recordSearchTexts, tagsInRecords } from './browse-filter';
import { fieldDefinition } from './fields';
import { searchRecords } from './list-groups';
import { recordsToSheet } from './records-sheet';
import type { Collection } from './schema';
import type { DataRecord } from './data';

// 标签字段和列表的筛选、搜索（创始人 2026-11-04 定）：没有记录、有记录、边界（0 个标签、1000 条、搜到没显示的字段、筛选加搜索）。

const table: Collection = {
  id: 'contacts',
  name: 'Contacts',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'phone', name: 'Phone', type: 'text', format: 'phone' },
    {
      id: 'kind',
      name: 'Kind',
      type: 'choice',
      options: [
        { id: 'a', label: 'Client' },
        { id: 'b', label: 'Friend' },
        { id: 'c', label: 'Other' },
      ],
    },
    { id: 'tags', name: 'Tags', type: 'tags' },
    { id: 'note', name: 'Note', type: 'note' },
    { id: 'files', name: 'Files', type: 'file' },
  ],
} as Collection;

const record = (id: string, values: Record<string, unknown>): DataRecord =>
  ({ id, collectionId: 'contacts', values, createdAt: 1, updatedAt: 1 }) as DataRecord;
const tagsDef = fieldDefinition('tags');
const tagsField = table.fields[3]!;

describe('the tags field', () => {
  it('stores trimmed tags without duplicates; a blank list stores nothing', () => {
    expect(tagsDef.write!(tagsField, [' vip ', 'VIP', 'client', ''])).toEqual({
      value: ['vip', 'client'],
    });
    expect(tagsDef.write!(tagsField, [])).toEqual({ value: '' });
    expect(tagsDef.write!(tagsField, [1])).toEqual({ issue: 'invalid' });
    expect(tagsDef.write!(tagsField, ['x'.repeat(31)])).toEqual({ issue: 'tooLong' });
    expect(
      tagsDef.write!(
        tagsField,
        Array.from({ length: 21 }, (_, i) => `t${i}`),
      ),
    ).toEqual({ issue: 'tooLong' });
  });

  it('reads old or wrong values without complaining', () => {
    expect(tagsDef.read(tagsField, 'text')).toBeUndefined();
    expect(tagsDef.read(tagsField, [])).toBeUndefined();
    expect(tagsDef.read(tagsField, ['a', 2, ' a ', 'b'])).toEqual(['a', 'b']);
  });

  it('is shown, exported and put in Excel as text in one cell; never sorted or summed', () => {
    expect(tagsDef.format(tagsField, ['a', 'b'], 'en')).toBe('a, b');
    expect(tagsDef.sort).toBe(false);
    expect(tagsDef.numeric).toBeUndefined();
    const rows = recordsToSheet(table, [record('r', { tags: ['a', 'b'] })], 'en');
    expect(rows[1]).toContainEqual({ kind: 'text', text: 'a, b' });
  });
});

describe('browse filter values come from the records', () => {
  it('no records: no rows', () => {
    expect(browseFilterRows([], table, ['tags', 'kind'], 'en')).toEqual([]);
    expect(tagsInRecords([], table, 'tags', 'en')).toEqual([]);
  });

  it('records with no tags: no row', () => {
    expect(browseFilterRows([record('r', { name: 'A' })], table, ['tags'], 'en')).toEqual([]);
  });

  it('lists each tag once, sorted; a tag no record uses is gone', () => {
    const records = [
      record('1', { tags: ['zebra', 'Apple'] }),
      record('2', { tags: ['apple', 'mango'] }),
    ];
    expect(tagsInRecords(records, table, 'tags', 'en')).toEqual(['Apple', 'mango', 'zebra']);
    expect(tagsInRecords(records.slice(1), table, 'tags', 'en')).toEqual(['apple', 'mango']);
  });

  it('a choice row lists used options in option order', () => {
    const rows = browseFilterRows(
      [record('1', { kind: 'c' }), record('2', { kind: 'a' })],
      table,
      ['kind'],
      'en',
    );
    expect(rows).toEqual([
      {
        field: 'kind',
        values: [
          { value: 'a', label: 'Client' },
          { value: 'c', label: 'Other' },
        ],
      },
    ]);
  });

  it('keeps only matching records, a tag in any case', () => {
    const records = [record('1', { tags: ['VIP'] }), record('2', { tags: ['x'] }), record('3', {})];
    expect(browseFilter(records, table, { field: 'tags', value: 'vip' }).map((r) => r.id)).toEqual([
      '1',
    ]);
  });
});

describe('search reads every field as displayed', () => {
  const texts = (r: DataRecord) => recordSearchTexts(r, table, ['name'], 'en');
  const records = [
    record('1', {
      name: 'Ann',
      phone: '555 0100',
      kind: 'b',
      tags: ['golf'],
      note: 'met in Lyon',
      files: ['asset1'],
    }),
    record('2', { name: 'Bob' }),
  ];
  const ids = (q: string) => searchRecords(records, q, texts).map((r) => r.id);

  it('finds fields the list does not show: phone, note, tags, a choice label', () => {
    expect(ids('555')).toEqual(['1']);
    expect(ids('lyon')).toEqual(['1']);
    expect(ids('GOLF')).toEqual(['1']);
    expect(ids('friend')).toEqual(['1']);
  });

  it('never reads attachments, and a choice is searched by label, not by id', () => {
    expect(ids('asset1')).toEqual([]);
    expect(ids('attachment')).toEqual([]);
  });

  it('every word must appear, across fields', () => {
    expect(ids('ann golf')).toEqual(['1']);
    expect(ids('bob golf')).toEqual([]);
  });

  it('a filter and a search together, over 1000 records', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      record(`r${i}`, {
        name: `Person ${i}`,
        phone: `555${i}`,
        ...(i % 2 ? { tags: ['odd'] } : { tags: ['even'] }),
      }),
    );
    const odd = browseFilter(many, table, { field: 'tags', value: 'odd' });
    expect(odd).toHaveLength(500);
    const found = searchRecords(odd, '555999', (r) => recordSearchTexts(r, table, [], 'en'));
    expect(found.map((r) => r.id)).toEqual(['r999']);
    expect(searchRecords(odd, '555998', (r) => recordSearchTexts(r, table, [], 'en'))).toEqual([]);
  });
});
