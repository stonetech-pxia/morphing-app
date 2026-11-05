import { describe, expect, it } from 'vitest';

import { MAX_ATTACHMENTS } from './field-values';
import { appendPrefill, attachRoom } from './record-append';
import type { Collection } from './schema';

// 把一次运行的结果放进一条已有的记录（out.addRecord 的 into: "existing"，D-443）：只追加，不替换、不删除。

const table: Collection = {
  id: 'docs',
  name: 'Docs',
  fields: [
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'body', name: 'Body', type: 'note' },
    { id: 'scan', name: 'Scan', type: 'file' },
    { id: 'more', name: 'More', type: 'file' },
  ],
};
const ids = (n: number, prefix = 'f') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('how many more files an entry can take', () => {
  it('a new user: an empty field has all the room', () => {
    expect(attachRoom(table, {})).toBe(MAX_ATTACHMENTS);
    expect(attachRoom(table, { scan: [] })).toBe(MAX_ATTACHMENTS);
  });

  it('counts what is already there; an old single id counts as one', () => {
    expect(attachRoom(table, { scan: ['a', 'b', 'c'] })).toBe(MAX_ATTACHMENTS - 3);
    expect(attachRoom(table, { scan: 'a' })).toBe(MAX_ATTACHMENTS - 1);
  });

  it('a full field has no room; a table without an attachment field has none either', () => {
    expect(attachRoom(table, { scan: ids(MAX_ATTACHMENTS) })).toBe(0);
    expect(attachRoom({ ...table, fields: [table.fields[0]!] }, {})).toBe(0);
  });

  it('only the first attachment field counts (where out.addRecord puts files)', () => {
    expect(attachRoom(table, { scan: ['a'], more: ids(MAX_ATTACHMENTS) })).toBe(
      MAX_ATTACHMENTS - 1,
    );
  });
});

describe('what the form starts with when files are added to an entry', () => {
  it('puts the new files after the ones already there, in order', () => {
    expect(appendPrefill(table, { scan: ['a', 'b'] }, { fileIds: ['c', 'd'] })).toEqual({
      scan: ['a', 'b', 'c', 'd'],
    });
    expect(appendPrefill(table, {}, { fileIds: ['c'] })).toEqual({ scan: ['c'] });
  });

  it('never drops or replaces what is there: an old single id stays, repeats are not added twice', () => {
    expect(appendPrefill(table, { scan: 'a' }, { fileIds: ['b'] })).toEqual({ scan: ['a', 'b'] });
    expect(appendPrefill(table, { scan: ['a'] }, { fileIds: ['a', 'b'] })).toEqual({
      scan: ['a', 'b'],
    });
  });

  it('never goes over what an entry can hold: the existing ones are kept, the extra new ones left out', () => {
    const existing = ids(MAX_ATTACHMENTS - 1, 'old');
    const out = appendPrefill(table, { scan: existing }, { fileIds: ['n1', 'n2', 'n3'] });
    expect(out.scan).toEqual([...existing, 'n1']);
  });

  it('adds nothing when there is no file field or nothing to add', () => {
    expect(appendPrefill({ ...table, fields: [table.fields[0]!] }, {}, { fileIds: ['a'] })).toEqual(
      {},
    );
    expect(appendPrefill(table, { scan: ['a'] }, { fileIds: [] })).toEqual({});
  });
});

describe('what the form starts with when text is added to an entry', () => {
  it('goes into the text field when it is empty (or only blanks)', () => {
    expect(appendPrefill(table, {}, { text: 'hello' })).toEqual({ body: 'hello' });
    expect(appendPrefill(table, { body: '  \n ' }, { text: 'hello' })).toEqual({ body: 'hello' });
  });

  it('goes on a new line after what is there, which stays as it is', () => {
    expect(appendPrefill(table, { body: 'first' }, { text: 'second' })).toEqual({
      body: 'first\nsecond',
    });
    expect(appendPrefill(table, { body: 'first\n' }, { text: 'second' })).toEqual({
      body: 'first\nsecond',
    });
  });

  it('uses the first long-text field, or the first text field when there is none', () => {
    const plain: Collection = { ...table, fields: [table.fields[0]!, table.fields[2]!] };
    expect(appendPrefill(plain, { title: 'T' }, { text: 'x' })).toEqual({ title: 'T\nx' });
    const none: Collection = { ...table, fields: [table.fields[2]!] };
    expect(appendPrefill(none, {}, { text: 'x' })).toEqual({});
  });

  it('files and text can come together', () => {
    expect(appendPrefill(table, { body: 'a', scan: ['f'] }, { text: 'b', fileIds: ['g'] })).toEqual(
      { body: 'a\nb', scan: ['f', 'g'] },
    );
  });
});
