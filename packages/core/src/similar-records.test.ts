import { describe, expect, it } from 'vitest';

import type { DataRecord } from './data';
import { findSimilarRecords } from './similar-records';
import type { Collection } from './schema';

// D-426：保存新记录前比哪些值。比的是「应该算同一条」，不是代码怎么写。

const record = (id: string, values: Record<string, unknown>, deletedAt?: number) =>
  ({ id, collectionId: 't', values, createdAt: 1, updatedAt: 1, deletedAt }) as DataRecord & {
    deletedAt?: number;
  };

const ids = (list: readonly DataRecord[]) => list.map((r) => r.id);

const receipts: Collection = {
  id: 't',
  name: 'Receipts',
  prefillRules: 'receipt',
  fields: [
    { id: 'f1', name: 'Amount', type: 'money', currency: 'EUR' },
    { id: 'f2', name: 'Date', type: 'date' },
    { id: 'f3', name: 'Merchant', type: 'text' },
    { id: 'f4', name: 'Note', type: 'note' },
  ],
};

const cards: Collection = {
  id: 't',
  name: 'Contacts',
  prefillRules: 'card',
  fields: [
    { id: 'a', name: 'Name', type: 'text' },
    { id: 'b', name: 'Mobile', type: 'text', format: 'phone' },
    { id: 'c', name: 'Bureau', type: 'text', format: 'phone' },
    { id: 'd', name: 'Mail', type: 'text', format: 'email' },
  ],
};

describe('receipt rules', () => {
  const same = { f1: 12.5, f2: '2026-11-03' };

  it('same amount and date match when a merchant is missing on either side', () => {
    const existing = [record('a', { ...same, f3: 'Carrefour' }), record('b', same)];
    expect(ids(findSimilarRecords(receipts, same, existing))).toEqual(['a', 'b']);
    expect(ids(findSimilarRecords(receipts, { ...same, f3: 'Lidl' }, [record('b', same)]))).toEqual(
      ['b'],
    );
  });

  it('merchants on both sides must match, ignoring case and spaces', () => {
    const existing = [record('a', { ...same, f3: 'Café  de Flore' })];
    expect(findSimilarRecords(receipts, { ...same, f3: 'café de flore' }, existing)).toHaveLength(
      1,
    );
    expect(findSimilarRecords(receipts, { ...same, f3: 'Lidl' }, existing)).toHaveLength(0);
  });

  it('a different amount or date is not the same receipt', () => {
    const existing = [record('a', same)];
    expect(findSimilarRecords(receipts, { ...same, f1: 12.51 }, existing)).toHaveLength(0);
    expect(findSimilarRecords(receipts, { ...same, f2: '2026-11-04' }, existing)).toHaveLength(0);
  });

  it('empty or unparsable values never match', () => {
    const empty = [record('a', {}), record('b', { f1: 'abc', f2: 'last Tuesday' })];
    expect(findSimilarRecords(receipts, {}, empty)).toEqual([]);
    expect(findSimilarRecords(receipts, { f1: 'abc', f2: 'last Tuesday' }, empty)).toEqual([]);
    expect(findSimilarRecords(receipts, { f1: 12.5 }, [record('c', { f1: 12.5 })])).toEqual([]);
  });

  it('finds the fields by what they are in a table the user built, in any language', () => {
    const mine: Collection = {
      id: 't',
      name: '账目',
      prefillRules: 'receipt',
      fields: [
        { id: 'x', name: '说明', type: 'text' },
        { id: 'y', name: '价钱', type: 'money', currency: 'CNY' },
        { id: 'z', name: '那天', type: 'date' },
      ],
    };
    const values = { x: '午饭', y: 30, z: '2026-11-01' };
    expect(findSimilarRecords(mine, values, [record('a', { ...values, x: '别的' })])).toHaveLength(
      1,
    );
  });

  it('a recycled record does not count', () => {
    expect(findSimilarRecords(receipts, same, [record('a', same, 99)])).toEqual([]);
  });
});

describe('card rules', () => {
  it('the same phone written differently matches, on any phone field', () => {
    const existing = [record('a', { b: '+33 1 23 45 67 89' })];
    expect(findSimilarRecords(cards, { b: '01 23 45 67 89' }, existing)).toHaveLength(1);
    expect(findSimilarRecords(cards, { c: '01.23.45.67.89' }, existing)).toHaveLength(1);
    expect(findSimilarRecords(cards, { b: '01 23 45 67 80' }, existing)).toHaveLength(0);
  });

  it('short numbers and empty values never match', () => {
    expect(findSimilarRecords(cards, { b: '分机 123' }, [record('a', { b: 'poste 123' })])).toEqual(
      [],
    );
    expect(findSimilarRecords(cards, { b: '', d: '' }, [record('a', { b: '', d: '' })])).toEqual(
      [],
    );
  });

  it('the same email matches, ignoring case', () => {
    const existing = [record('a', { d: 'Marie@Example.com ' })];
    expect(findSimilarRecords(cards, { d: 'marie@example.COM' }, existing)).toHaveLength(1);
    expect(findSimilarRecords(cards, { d: 'marie2@example.com' }, existing)).toHaveLength(0);
  });

  it('the same name alone is not a match', () => {
    expect(findSimilarRecords(cards, { a: 'Marie' }, [record('x', { a: 'Marie' })])).toEqual([]);
  });

  it('finds phone and email by field name when no format is written', () => {
    const mine: Collection = {
      id: 't',
      name: 'People',
      prefillRules: 'card',
      fields: [
        { id: 'p', name: 'Téléphone', type: 'text' },
        { id: 'e', name: '邮箱', type: 'text' },
      ],
    };
    expect(
      findSimilarRecords(mine, { p: '0612345678' }, [record('a', { p: '06 12 34 56 78' })]),
    ).toHaveLength(1);
    expect(findSimilarRecords(mine, { e: 'a@b.fr' }, [record('a', { e: 'A@B.FR' })])).toHaveLength(
      1,
    );
  });
});

describe('without the table parameter', () => {
  it('nothing matches, whatever the values', () => {
    const plain: Collection = { ...receipts, prefillRules: undefined };
    const same = { f1: 1, f2: '2026-11-03' };
    expect(findSimilarRecords(plain, same, [record('a', same)])).toEqual([]);
  });
});
