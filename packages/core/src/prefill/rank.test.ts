import { describe, expect, it } from 'vitest';

import { createDefaultWorkspace } from '../defaults';
import type { Field, Locale } from '../schema';
import { FILE_RECORD_PRESETS, templateCollectionOp } from '../templates';
import { conceptOf } from './concepts';
import { suggestValues, type FieldPick } from './rank';
import type { TextBox, TextPage } from './rows';
import { labelScore } from './similarity';
import {
  layoutStoreFile,
  parsePickStore,
  pickCount,
  putPick,
  readPickStoreFile,
  serializePickStore,
} from './store';

// 新记录表单的候选值（D-388）：照测量的失败例写的几张单据（按排的识别结果），断言该排第一的排第一、
// 不该出现的不出现。

/** 一排一排的文字：每排可以有几段（[文字, x]），字高 20，排距 40，页宽 600。 */
function page(rows: (string | [string, number][])[], height = rows.length * 40 + 40): TextPage {
  const lines: TextBox[] = [];
  rows.forEach((row, i) => {
    const parts = typeof row === 'string' ? [[row, 20] as [string, number]] : row;
    for (const [text, x] of parts)
      lines.push({ text, x, y: 20 + i * 40, width: text.length * 10, height: 20 });
  });
  return { width: 600, height, lines };
}

const field = (f: Partial<Field> & Pick<Field, 'id' | 'name' | 'type'>) => f as Field;
const money = (id: string, name: string) =>
  field({ id, name, type: 'money', currency: 'USD' } as Field);
const date = (id: string, name: string) => field({ id, name, type: 'date' });
const text = (id: string, name: string) => field({ id, name, type: 'text' });

const NOW = new Date('2026-10-31T12:00:00Z');
const values = (r: Record<string, { value: string }[]>, id: string) =>
  (r[id] ?? []).map((s) => s.value);

describe('suggestValues', () => {
  it('ranks Total above Subtotal and Tax for an amount field, and Tax first for a tax field', () => {
    const doc = page([
      'ACME HARDWARE',
      [
        ['Subtotal', 20],
        ['165.03', 400],
      ],
      [
        ['Tax', 20],
        ['13.20', 400],
      ],
      [
        ['Total', 20],
        ['178.23', 400],
      ],
      [
        ['Cash', 20],
        ['200.00', 400],
      ],
      [
        ['Change', 20],
        ['21.77', 400],
      ],
    ]);
    for (const name of ['Amount', '金额', 'Montant']) {
      const r = suggestValues({
        fields: [money('amount', name)],
        pages: [doc],
        locale: 'en',
        now: NOW,
      });
      expect(values(r, 'amount')[0]).toBe('178.23');
    }
    const r = suggestValues({
      fields: [money('tax', 'Tax')],
      pages: [doc],
      locale: 'en',
      now: NOW,
    });
    expect(values(r, 'tax')[0]).toBe('13.20');
  });

  it('puts the due date first for a due-date field and the invoice date first for a date field', () => {
    const doc = page([
      'Invoice INV-2026-0042',
      'Invoice date: 2026-09-01',
      'Due date: 2026-10-01',
      'Amount due: $256.00',
    ]);
    const fields = [date('due', 'Due date'), date('date', 'Date')];
    const r = suggestValues({ fields, pages: [doc], locale: 'en', now: NOW });
    expect(values(r, 'due')[0]).toBe('2026-10-01');
    expect(values(r, 'date')[0]).toBe('2026-09-01');
  });

  it('bill 到期日 picks 到期日, not 开票日期 (Chinese bill)', () => {
    const doc = page(['开票日期：2026年9月1日', '到期日：2026年10月15日', '应付金额：¥256.00']);
    const fields = [date('due', '到期日'), money('amount', '金额')];
    const r = suggestValues({ fields, pages: [doc], locale: 'zh', now: NOW });
    expect(values(r, 'due')[0]).toBe('2026-10-15');
    expect(values(r, 'amount')).toEqual(['256.00']);
  });

  it('suggests the shop name at the top for a merchant field, never the generic "Tax invoice" line', () => {
    const doc = page(['Maple Corner Store', 'TAX INVOICE', '12 Sample Street', 'Total 9.50']);
    const r = suggestValues({
      fields: [text('merchant', 'Store')],
      pages: [doc],
      locale: 'en',
      now: NOW,
    });
    expect(values(r, 'merchant')[0]).toBe('Maple Corner Store');
    expect(values(r, 'merchant')).not.toContain('TAX INVOICE');
  });

  it('gives both readings of an ambiguous day/month date as separate suggestions', () => {
    const doc = page(['Date 05/03/2026', 'Total 12.00']);
    const r = suggestValues({
      fields: [date('date', 'Date')],
      pages: [doc],
      locale: 'en',
      now: NOW,
    });
    expect(values(r, 'date').sort()).toEqual(['2026-03-05', '2026-05-03']);
  });

  it('a remembered pick ranks the same label first next time', () => {
    const doc = page(['Order date 2026-09-03', 'Ship date 2026-09-08', 'Total 5.00']);
    const fields = [date('date', 'Date')];
    const before = suggestValues({ fields, pages: [doc], locale: 'en', now: NOW });
    // 用户点了排第二的那个。
    const second = before.date![1]!;
    const picks: Record<string, FieldPick> = { date: second.pick };
    const next = page(['Order date 2026-10-01', 'Ship date 2026-10-06', 'Total 7.00']);
    const after = suggestValues({ fields, pages: [next], locale: 'en', now: NOW, picks });
    const without = suggestValues({ fields, pages: [next], locale: 'en', now: NOW });
    const same = second.value === '2026-09-03' ? '2026-10-01' : '2026-10-06';
    expect(values(without, 'date')[0]).not.toBe(same);
    expect(values(after, 'date')[0]).toBe(same);
  });

  it('matches a choice field by option label and skips fields it cannot fill', () => {
    const status = field({
      id: 'status',
      name: 'Status',
      type: 'choice',
      options: [
        { id: 'todo', label: 'To submit' },
        { id: 'done', label: 'Submitted' },
      ],
    } as Field);
    const doc = page([
      [
        ['Status:', 20],
        ['Submitted', 200],
      ],
    ]);
    const r = suggestValues({
      fields: [status, field({ id: 'paid', name: 'Paid', type: 'checkbox' })],
      pages: [doc],
      locale: 'en',
      now: NOW,
    });
    expect(values(r, 'status')).toEqual(['done']);
    expect(r.paid).toBeUndefined();
  });

  it('finds nothing in an empty page and never throws', () => {
    expect(
      suggestValues({
        fields: [money('a', 'Amount')],
        pages: [{ width: 0, height: 0, lines: [] }],
        locale: 'fr',
      }),
    ).toEqual({});
  });

  it('drops dates far from the other dates on the document (OCR read 2026 as 2020)', () => {
    // 「合理」只占 1 分：2020 年那个带着标签还会排第一，但分数比没有 2026 年时低 1 分。
    const withAnchor = page(['Paid 21 March 2026', 'Date 21/03/2020 09:13', 'Total 5.00']);
    const score = (doc: TextPage, now: Date) =>
      suggestValues({ fields: [date('date', 'Date')], pages: [doc], locale: 'en', now }).date!.find(
        (s) => s.value === '2020-03-21',
      )!.score;
    // 没有别的日期可比时按现在判断：2020 年在十年之内，合理（唯一 1 + 合理 1）；
    // 有 2026 年时不合理（唯一 0.5 + 合理 0）。
    const lone = page(['Date 21/03/2020 09:13', 'Total 5.00']);
    expect(score(lone, NOW) - score(withAnchor, NOW)).toBeCloseTo(1.5, 5);
  });
});

describe('conceptOf for the D-386 presets', () => {
  const expected: Record<string, Record<string, string | null>> = {
    purchase: { merchant: 'merchant', date: 'issueDate', amount: 'amount', note: null },
    bill: { issuer: 'company', due: 'dueDate', amount: 'amount' },
    contract: { party: 'company', signed: 'signDate', ends: 'dueDate' },
    reimbursement: { reason: 'purpose', date: 'issueDate', amount: 'amount' },
    blank: { title: 'title' },
  };
  for (const locale of ['en', 'zh', 'fr'] as Locale[]) {
    it(`maps every preset field to the right concept (${locale})`, () => {
      const config = createDefaultWorkspace(locale);
      for (const preset of FILE_RECORD_PRESETS) {
        const table = templateCollectionOp(preset, config, locale).table;
        for (const [id, concept] of Object.entries(expected[preset] ?? {})) {
          const f = table.fields.find((x) => x.id === id)!;
          expect([preset, id, conceptOf(f)]).toEqual([preset, id, concept]);
        }
      }
    });
  }
  it('the contract 名称 is a title, not a person', () => {
    expect(conceptOf({ id: 'name', name: '名称' })).toBe('title');
  });
});

describe('label score', () => {
  it('tolerates a missing space and a small OCR typo, but short words must match whole', () => {
    expect(labelScore('Amountpaid', ['amount paid'], [])).toBeGreaterThan(0.8);
    expect(labelScore('Totel Amt Payable', ['total'], [])).toBeGreaterThan(0);
    expect(labelScore('Hotel', ['tel'], [])).toBe(0);
    expect(labelScore('Sub-Total', ['total'], ['subtotal'])).toBe(0);
  });
});

describe('pick store', () => {
  it('round-trips through app_meta, counts fields and travels in the exported file', () => {
    let store = putPick({}, 'bills', 'due', { label: 'Due date', relY: 0.3 });
    store = putPick(store, 'bills', 'due', { label: '到期日', relY: 0.2 });
    store = putPick(store, 'purchases', 'date', { label: '', relY: 0.1, order: 'DMY' });
    expect(pickCount(parsePickStore(serializePickStore(store)))).toBe(2);
    expect(parsePickStore('{bad')).toEqual({});
    const file = layoutStoreFile({}, NOW, store);
    expect(readPickStoreFile(file)).toEqual(store);
    // 第 1 版的文件没有点过的候选。
    const v1 = JSON.stringify({ format: 'morph-prefill-memory', version: 1, tables: {} });
    expect(readPickStoreFile(v1)).toEqual({});
    expect(readPickStoreFile('hello')).toBeNull();
  });
});
