import { describe, expect, it } from 'vitest';

import { formatRef, perCurrencyText, recordsToCsv, type DataRecord } from './data';
import { recordsToHtml } from './html';
import { fieldForRecord, recordCurrency } from './money-currency';
import { currencyInText } from './prefill/category';
import { recordsToSheet } from './records-sheet';
import type { Collection, Field } from './schema';
import { findSimilarRecords } from './similar-records';

const claims: Collection = {
  id: 'claims',
  name: 'Claims',
  icon: 'inbox',
  prefillRules: 'receipt',
  fields: [
    { id: 'amount', name: 'Amount', type: 'money', currency: 'USD', currencyField: 'currency' },
    {
      id: 'currency',
      name: 'Currency',
      type: 'choice',
      options: [
        { id: 'usd', label: 'USD' },
        { id: 'eur', label: 'EUR' },
        { id: 'jpy', label: 'JPY' },
      ],
    },
    { id: 'date', name: 'Date', type: 'date' },
  ],
} as Collection;

const money = claims.fields[0] as Extract<Field, { type: 'money' }>;
const record = (id: string, values: Record<string, unknown>): DataRecord =>
  ({
    id,
    collectionId: 'claims',
    createdAt: 1,
    updatedAt: 1,
    values,
  }) as unknown as DataRecord;

describe('each entry has its own currency (D-429)', () => {
  it('reads the currency of the entry, and the field default when none is picked', () => {
    expect(recordCurrency(money, { currency: 'eur' }, claims)).toBe('EUR');
    expect(recordCurrency(money, {}, claims)).toBe('USD');
    expect(recordCurrency(money, { currency: 'gone' }, claims)).toBe('USD');
    expect(fieldForRecord(money, { currency: 'eur' }, claims).currency).toBe('EUR');
  });

  it('a fixed-currency money field is unchanged', () => {
    const fixed = { id: 'a', name: 'A', type: 'money', currency: 'CNY' } as Field;
    expect(fieldForRecord(fixed, { currency: 'eur' }, claims)).toBe(fixed);
  });

  it('shows each entry in its own currency', () => {
    const eur = record('a', { amount: 12.5, currency: 'eur' });
    const none = record('b', { amount: 12.5 });
    expect(formatRef(eur, claims, 'amount', 'en')).toContain('€');
    expect(formatRef(none, claims, 'amount', 'en')).toContain('$');
  });

  it('adds up per currency and never across currencies', () => {
    const records = [
      record('a', { amount: 100, currency: 'usd' }),
      record('b', { amount: 50, currency: 'eur' }),
      record('c', { amount: 1, currency: 'usd' }),
      record('d', { currency: 'jpy' }), // 没有金额：不算一种货币
    ];
    const text = perCurrencyText(records, claims, 'sum', 'amount', 'en')!;
    expect(text).toContain('€50.00');
    expect(text).toContain('$101.00');
    expect(text).not.toContain('151');
    expect(text).not.toMatch(/¥|JPY/);
    expect(perCurrencyText(records, claims, 'count', undefined, 'en')).toBeNull();
    expect(perCurrencyText([], claims, 'sum', 'amount', 'en')).toBeNull();
  });

  it('the report total is split per currency', () => {
    const html = recordsToHtml(
      claims,
      [record('a', { amount: 100, currency: 'usd' }), record('b', { amount: 50, currency: 'eur' })],
      {
        template: 'receipt',
        title: 'R',
        fields: ['amount'],
        pageSize: 'a4',
        locale: 'en',
        now: new Date(0),
      } as never,
    );
    expect(html).toContain('€50.00');
    expect(html).toContain('$100.00');
    expect(html).not.toContain('150');
  });

  it('Excel keeps a currency column, and a fixed currency goes in the header', () => {
    const rows = recordsToSheet(claims, [record('a', { amount: 5, currency: 'eur' })], 'en');
    expect(rows[0]!.map((c) => c.text)).toEqual(expect.arrayContaining(['Amount', 'Currency']));
    expect(rows[1]![0]).toMatchObject({ kind: 'number', value: 5 });
    expect(rows[1]![1]).toMatchObject({ kind: 'text', text: 'EUR' });
    const fixed = {
      ...claims,
      fields: [{ id: 'amount', name: 'Amount', type: 'money', currency: 'CNY' }],
    } as Collection;
    expect(recordsToSheet(fixed, [], 'en')[0]![0]!.text).toBe('Amount (CNY)');
    expect(recordsToCsv(claims, [], 'en')).toContain('Amount');
  });

  it('the same amount in another currency is not the same receipt', () => {
    const saved = [record('a', { amount: 100, currency: 'usd', date: '2026-11-01' })];
    const same = { amount: 100, currency: 'usd', date: '2026-11-01' };
    expect(findSimilarRecords(claims, same, saved)).toHaveLength(1);
    expect(findSimilarRecords(claims, { ...same, currency: 'eur' }, saved)).toHaveLength(0);
    // 没选就是默认货币。
    expect(findSimilarRecords(claims, { amount: 100, date: '2026-11-01' }, saved)).toHaveLength(1);
  });

  describe('the currency printed on the document is only a candidate', () => {
    const choice = claims.fields[1] as Extract<Field, { type: 'choice' }>;
    it.each([
      [['TOTAL 12,50 €'], 'eur'],
      [['Total $12.50'], 'usd'],
      [['Total JPY 1200'], 'jpy'],
      [['合计 ￥1200'], 'jpy'],
      [['€10', '€20', '$1'], 'eur'],
    ])('%j → %s', (rows, want) => {
      expect(currencyInText(choice, rows)).toBe(want);
    });
    it('a currency the field does not offer, or none, gives nothing', () => {
      expect(currencyInText(choice, ['Total £5'])).toBeNull();
      expect(currencyInText(choice, ['Total 12.50'])).toBeNull();
      // CA$ 不算美元。
      expect(currencyInText(choice, ['Total CA$5'])).toBeNull();
    });
  });
});
