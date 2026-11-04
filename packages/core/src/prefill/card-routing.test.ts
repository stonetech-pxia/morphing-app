import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { ctx } from './doc-context';
import { modelEngine, ruleEngine, suggestionForField, type PrefillEngine } from './engine';
import type { ModelSession } from './model';
import type { TextPage } from './rows';

// 表上的 prefillRules 决定用哪组规则：有就是它加通用规则，没有就只有通用规则（D-421）。

const NOW = new Date('2026-11-04T00:00:00Z');

const page = (rows: string[]): TextPage => ({
  width: 600,
  height: 40 + rows.length * 30,
  lines: rows.map((text, i) => ({ text, x: 20, y: 20 + i * 30, width: 500, height: 24 })),
});

const CARD = page([
  'Maria Garcia',
  'Sales Manager',
  'Northwind Trading Ltd',
  '15 Rose Lane, London SW1A 1AA',
  'Tel: +44 20 7946 0958',
  'maria.garcia@northwind.example.com',
  'www.northwind.com',
]);

const RECEIPT = page([
  'Joes Diner',
  '12 Main Street',
  'Date 03/04/2026',
  'Coffee 4.00',
  'Sandwich 8.50',
  'Subtotal 12.50',
  'Tax 1.00',
  'Total 13.50',
  'Cash 20.00',
  'Change 6.50',
]);

const f = (id: string, name: string, type = 'text', extra: object = {}): Field =>
  ({ id, name, type, ...extra }) as Field;

const CARD_FIELDS = [
  f('name', 'Name'),
  f('job', 'Job title'),
  f('company', 'Company'),
  f('site', 'Website'),
];

async function values(
  engine: PrefillEngine,
  fields: Field[],
  pages: TextPage[],
  rules?: 'receipt' | 'card',
) {
  const out = await engine({ fields, pages, ...(rules ? { rules } : {}), locale: 'en', now: NOW });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.map((s) => s.value)]));
}

describe('card rules', () => {
  it('read a card with no labels on a card table', async () => {
    const r = await values(ruleEngine, CARD_FIELDS, [CARD], 'card');
    expect(r.name?.[0]).toBe('Maria Garcia');
    expect(r.job?.[0]).toBe('Sales Manager');
    expect(r.company?.[0]).toBe('Northwind Trading Ltd');
    expect(r.site?.[0]).toBe('www.northwind.com');
  });

  it('do not run on a receipt table, even for a card', async () => {
    const r = await values(ruleEngine, CARD_FIELDS, [CARD], 'receipt');
    expect(r.job).toBeUndefined();
    expect(r.site).toBeUndefined();
    expect(r.name ?? []).not.toContain('Maria Garcia');
  });

  it('do not run on a table without the parameter, even for a card', async () => {
    const r = await values(ruleEngine, CARD_FIELDS, [CARD]);
    expect(r.job).toBeUndefined();
    expect(r.site).toBeUndefined();
    expect(r.name ?? []).not.toContain('Maria Garcia');
  });
});

describe('a text field with format (D-422)', () => {
  const PHONE = page(['Northwind Trading', 'Tel: +44 20 7946 0958', 'Thanks for your visit']);
  const FIELDS = [f('v', '头衔', 'text', { format: 'phone' })];

  it('gets a phone candidate although its name means nothing', async () => {
    expect((await values(ruleEngine, FIELDS, [PHONE])).v).toContain('+44 20 7946 0958');
  });

  it('gets an email candidate although its name means nothing', async () => {
    const r = await values(ruleEngine, [f('v', '头衔', 'text', { format: 'email' })], [CARD]);
    expect(r.v).toContain('maria.garcia@northwind.example.com');
  });

  it('the same field without format is only text: no phone candidate', async () => {
    const r = await values(ruleEngine, [f('v', '头衔')], [PHONE]);
    expect(r.v ?? []).not.toContain('+44 20 7946 0958');
  });

  it('format wins over the field name', async () => {
    const r = await values(ruleEngine, [f('v', 'Email', 'text', { format: 'phone' })], [CARD]);
    expect(r.v).toContain('+44 20 7946 0958');
    expect(r.v).not.toContain('maria.garcia@northwind.example.com');
  });

  it('a url field reads the website on a card table', async () => {
    const r = await values(ruleEngine, [f('v', '头衔', 'text', { format: 'url' })], [CARD], 'card');
    expect(r.v?.[0]).toBe('www.northwind.com');
  });

  it('a url field is plain text elsewhere: same as the field without format', async () => {
    for (const rules of [undefined, 'receipt'] as const)
      expect(
        await values(ruleEngine, [f('v', '头衔', 'text', { format: 'url' })], [CARD], rules),
      ).toEqual(await values(ruleEngine, [f('v', '头衔')], [CARD], rules));
  });
});

describe('a multi-line address', () => {
  const s = { value: '15 Rose Lane\nLondon SW1A 1AA', score: 3 };

  it('becomes one line in a text field', () => {
    expect(suggestionForField({ type: 'text' }, s).value).toBe('15 Rose Lane, London SW1A 1AA');
  });

  it('keeps its lines in a note field', () => {
    expect(suggestionForField({ type: 'note' }, s).value).toBe(s.value);
  });
});

describe('receipt rules', () => {
  const DATE = f('date', 'Date', 'date');
  // 「22-Oct-2026」的月份名写法是收据规则（D-403）；通用规则不认。
  const MONTH_NAME = page([...RECEIPT.lines.map((l) => l.text), 'Issued 22-Oct-2026']);

  it('read a month-name date on a receipt table', async () => {
    const r = await values(ruleEngine, [DATE], [MONTH_NAME], 'receipt');
    expect(r.date).toContain('2026-10-22');
  });

  it('do not run on a table without the parameter', async () => {
    const r = await values(ruleEngine, [DATE], [MONTH_NAME]);
    expect(r.date ?? []).not.toContain('2026-10-22');
  });

  it('do not run on a card table', async () => {
    const r = await values(ruleEngine, [DATE], [MONTH_NAME], 'card');
    expect(r.date ?? []).not.toContain('2026-10-22');
  });

  it('the category word list stays on receipt tables', async () => {
    const category = f('category', 'Category', 'choice', {
      options: [
        { id: 'dining', label: 'Dining' },
        { id: 'other', label: 'Other' },
      ],
    });
    const cafe = page(['Blue Door Restaurant & Cafe', 'Table 4', 'Total 13.50']);
    const receipt = await values(ruleEngine, [category], [cafe], 'receipt');
    expect(receipt.category).toEqual(['dining']);
    expect((await values(ruleEngine, [category], [cafe])).category).toBeUndefined();
    expect((await values(ruleEngine, [category], [cafe], 'card')).category).toBeUndefined();
  });
});

describe('the general rules', () => {
  it('still run with either parameter and without one', async () => {
    const total = f('total', 'Amount', 'money', { currency: 'USD' });
    for (const rules of [undefined, 'receipt', 'card'] as const) {
      const r = await values(ruleEngine, [total], [RECEIPT], rules);
      expect(r.total?.[0]).toBe('13.50');
    }
  });
});

describe('the on-device model on a card', () => {
  const session = (asked: string[], answer: string): ModelSession => ({
    generate(request) {
      asked.push(JSON.stringify(request));
      return Promise.resolve(answer);
    },
    release: () => Promise.resolve(),
  });

  // 对照：同名的普通文字字段是问的，所以「没问」不是因为模型没打开（D-422）。
  it('is not asked for fields with format, whatever their name; a plain field of that name is asked', async () => {
    const empty = page(['Nothing to read here']);
    const asked: string[] = [];
    const engine = modelEngine(() => Promise.resolve(session(asked, 'null')));
    const fields = (['phone', 'email', 'url'] as const).map((format) =>
      f(format, '头衔', 'text', { format }),
    );
    await values(engine, fields, [CARD, empty], 'card');
    expect(asked).toEqual([]);
    await values(engine, [f('v', '头衔')], [CARD, empty], 'card');
    expect(asked).toHaveLength(1);
  });

  it('is not asked for phone, email, website or address', async () => {
    const asked: string[] = [];
    const engine = modelEngine(() => Promise.resolve(session(asked, 'null')));
    await values(
      engine,
      [f('phone', 'Phone'), f('mail', 'Email'), f('site', 'Website'), f('addr', 'Address')],
      [CARD],
      'card',
    );
    expect(asked).toEqual([]);
  });

  it('is asked for the job title with the card wording, after the rules', async () => {
    const asked: string[] = [];
    const engine = modelEngine(() => Promise.resolve(session(asked, 'Northwind Trading Ltd')));
    const r = await values(
      engine,
      [f('job', 'Job title')],
      [page(CARD.lines.map((l) => l.text).filter((t) => t !== 'Sales Manager'))],
      'card',
    );
    expect(asked[0]).toContain('the job title of the person on the card');
    expect(r.job?.[0]).toBe('Northwind Trading Ltd');
  });

  it('keeps the rule candidate first', async () => {
    const engine = modelEngine(() => Promise.resolve(session([], 'Northwind Trading Ltd')));
    const r = await values(engine, [f('name', 'Name')], [CARD], 'card');
    expect(r.name?.[0]).toBe('Maria Garcia');
  });

  it('leaves no document kind behind', async () => {
    const engine = modelEngine(() => Promise.resolve(session([], 'Maria Garcia')));
    await values(engine, [f('name', 'Name')], [CARD], 'card');
    expect(ctx.kind).toBe('');
  });

  it('does not get the card wording on a receipt', async () => {
    const asked: string[] = [];
    const engine = modelEngine(() => Promise.resolve(session(asked, 'null')));
    await values(engine, [f('job', 'Job title')], [RECEIPT], 'receipt');
    expect(asked.join()).not.toContain('the job title of the person on the card');
  });
});
