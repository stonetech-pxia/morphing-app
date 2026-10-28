import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { mergeCandidates, repairDigits, ruleCandidates, systemCandidates } from './candidates';
import {
  findLayout,
  learnLayout,
  readWithLayout,
  reconcileLayout,
  type LayoutMemory,
} from './memory';
import { labelOf, pickAmount, pickDate, pickTax } from './pick';
import { prefillRecord } from './prefill';

// 识别结果照着手机上的样子写：两栏挤成一行、标签单独一行、小计 / 优惠 / 找零都有、个别数字认成字母。

const RECEIPT_ZH = `青禾小馆
日期: 2026年3月14日 18:22
茄子饭 ¥28.00
小计: ¥34.00
优惠: -¥2.00
实付: ¥32.00
现金: ¥50.00
找零: ¥18.00
电话：010-5555-0188`;

const FACTURE_FR = `Plomberie Duval
Facture N° F2026-118
Date : 05/03/2026
À régler avant le 04/04/2026
Total HT : 85,00 €
TVA 20 % : 17,00 €
Total TTC : 102,00 €`;

const INVOICE_EN = `Bright Fiber Internet
Invoice date: March 2, 2026
Due date: 03/30/2026
Subtotal $49.99
Tax $5.00
Amount due $54.99`;

const fields = (list: [string, string, Field['type']][]): Field[] =>
  list.map(([id, name, type]) =>
    type === 'money'
      ? ({ id, name, type, currency: 'CNY' } as Field)
      : ({ id, name, type } as Field),
  );

describe('ruleCandidates', () => {
  it('finds amounts and dates with their line and position', () => {
    const found = ruleCandidates(RECEIPT_ZH, 'zh');
    const total = found.find((c) => c.kind === 'amount' && c.value === '32.00')!;
    expect(total).toMatchObject({ line: 5, raw: '32.00', source: 'rule' });
    expect(RECEIPT_ZH.split('\n')[5]!.slice(total.start, total.end)).toBe('32.00');
    expect(found.filter((c) => c.kind === 'date').map((c) => c.value)).toEqual(['2026-03-14']);
    // 电话号码、时间不是金额。
    expect(found.some((c) => c.kind === 'amount' && /0188|18:22|22/.test(c.raw))).toBe(false);
  });

  it('reads dates written with month names and two-digit years', () => {
    const values = (text: string, locale: 'en' | 'fr') =>
      ruleCandidates(text, locale)
        .filter((c) => c.kind === 'date')
        .map((c) => c.value);
    expect(values('Invoice date: March 2, 2026', 'en')).toEqual(['2026-03-02']);
    expect(values('Émise le 1er avril 2026', 'fr')).toEqual(['2026-04-01']);
    expect(values('Date 05/03/26', 'fr')).toEqual(['2026-03-05']);
    expect(values('Date 05/03/26', 'en')).toEqual(['2026-05-03']);
  });

  it('reads French and English thousands', () => {
    const amounts = (text: string, locale: 'en' | 'fr') =>
      ruleCandidates(text, locale)
        .filter((c) => c.kind === 'amount')
        .map((c) => c.value);
    expect(amounts('Total TTC : 1 234,56 €', 'fr')).toEqual(['1234.56']);
    expect(amounts('Total $1,234.56', 'en')).toEqual(['1234.56']);
    // 连着写的四位整数、没有小数：多半是小数点没认出来，不当金额。
    expect(amounts('Total TTC payé: 5256 €', 'fr')).toEqual([]);
  });

  it('repairs look-alike letters only inside something shaped like money or a date', () => {
    expect(repairDigits('Total: $1O7.45').text).toBe('Total: $107.45');
    expect(repairDigits('日期: 2026年S月15日').text).toBe('日期: 2026年5月15日');
    // 单词、单号不改。
    expect(repairDigits('SOS B12 Total').text).toBe('SOS B12 Total');
    const total = ruleCandidates('Net à payer: l60,97 €', 'fr').find((c) => c.kind === 'amount')!;
    expect(total).toMatchObject({ value: '160.97', raw: 'l60,97', repaired: true });
  });
});

describe('system candidates are a supplement to the rules', () => {
  const text = 'Total 12.50\nPaid on 3 March';
  it('maps whole-text offsets to lines and keeps rule values when both find the same spot', () => {
    const system = systemCandidates(text, [
      { kind: 'amount', start: 6, end: 11 },
      { kind: 'date', start: 20, end: 27, value: '2026-03-03' },
    ]);
    expect(system).toEqual([
      expect.objectContaining({ kind: 'amount', line: 0, value: '12.50', source: 'system' }),
      expect.objectContaining({ kind: 'date', line: 1, raw: '3 March', source: 'system' }),
    ]);
    const merged = mergeCandidates(ruleCandidates(text, 'en'), system);
    // 金额规则也找到了：用规则的，记一笔对得上；日期规则没找到（没写年）：系统的作为补充。
    expect(merged.filter((c) => c.kind === 'amount')).toEqual([
      expect.objectContaining({ source: 'rule', confirmed: true }),
    ]);
    expect(merged.filter((c) => c.kind === 'date')).toEqual([
      expect.objectContaining({ source: 'system', value: '2026-03-03' }),
    ]);
  });

  it('keeps the rule value when the system reads the same spot differently', () => {
    const rules = ruleCandidates('Date 05/03/2026', 'fr');
    const merged = mergeCandidates(
      rules,
      systemCandidates('Date 05/03/2026', [
        { kind: 'date', start: 5, end: 15, value: '2026-05-03' },
      ]),
    );
    expect(merged).toEqual([expect.objectContaining({ value: '2026-03-05', source: 'rule' })]);
    expect(merged[0]!.confirmed).toBeUndefined();
  });
});

describe('pick by label', () => {
  it('takes what was paid, not the subtotal, discount, cash or change', () => {
    expect(pickAmount(RECEIPT_ZH, ruleCandidates(RECEIPT_ZH, 'zh'))?.value).toBe('32.00');
    expect(pickAmount(FACTURE_FR, ruleCandidates(FACTURE_FR, 'fr'))?.value).toBe('102.00');
    expect(pickAmount(INVOICE_EN, ruleCandidates(INVOICE_EN, 'en'))?.value).toBe('54.99');
  });

  it('uses a card line only when there is no total, and a label on the line above', () => {
    const card = 'Corner Deli\nSandwich 6.50\nVISA ****1427 8.40';
    expect(pickAmount(card, ruleCandidates(card, 'en'))?.value).toBe('8.40');
    const split = 'Total à payer\n23,40 €\nMerci';
    const c = ruleCandidates(split, 'fr');
    expect(labelOf(split.split('\n'), c[0]!, c)).toEqual({ text: 'total à payer', offset: 1 });
    expect(pickAmount(split, c)?.value).toBe('23.40');
  });

  it('leaves the amount empty rather than guess', () => {
    const noLabel = 'Corner Deli\nSandwich 6.50\nCoffee 2.10';
    expect(pickAmount(noLabel, ruleCandidates(noLabel, 'en'))).toBeNull();
    const twoTotals = 'Amount due 50.00\nBalance due 30.00';
    expect(pickAmount(twoTotals, ruleCandidates(twoTotals, 'en'))).toBeNull();
  });

  it('picks the tax line but not the excl. tax total', () => {
    expect(pickTax(FACTURE_FR, ruleCandidates(FACTURE_FR, 'fr'))?.value).toBe('17.00');
    expect(pickTax(INVOICE_EN, ruleCandidates(INVOICE_EN, 'en'))?.value).toBe('5.00');
  });

  it('skips due dates and prefers the issue date', () => {
    expect(pickDate(FACTURE_FR, ruleCandidates(FACTURE_FR, 'fr'))?.value).toBe('2026-03-05');
    expect(pickDate(INVOICE_EN, ruleCandidates(INVOICE_EN, 'en'))?.value).toBe('2026-03-02');
    const two = 'Visit 03/01/2026\nChecked 03/04/2026';
    expect(pickDate(two, ruleCandidates(two, 'en'))).toBeNull();
  });
});

// ---- 版式记忆 ----

const shop = (items: string, total: string, date: string) => `Maple Corner Store
12 Example Road
Tel 555-0142
${items}
SUBTOTAL ${total}
CARD PAYMENT ${total}
TOTAL DUE ${total}
Date ${date}
Thank you for shopping`;

const FIELDS = fields([
  ['amount', 'Total', 'money'],
  ['when', 'Day', 'date'],
  ['shop', 'Shop', 'text'],
  ['note', 'Note', 'text'],
]);

function save(memory: LayoutMemory | null, text: string, saved: Record<string, unknown>) {
  const result = prefillRecord({
    text,
    locale: 'en',
    fields: FIELDS,
    memories: memory ? [memory] : [],
  });
  const prefilled = result.values;
  return {
    prefilled,
    memory: learnLayout(
      memory,
      { text, fields: FIELDS, saved, prefilled, candidates: result.candidates },
      'layout-1',
    ),
  };
}

describe('layout memory', () => {
  it('learns after two consistent saves and then reads a new value', () => {
    const one = save(null, shop('Milk 4.20', '9.80', '03/02/2026'), {
      amount: 9.8,
      when: '2026-03-02',
      shop: 'Maple Corner Store',
      note: 'weekly',
    });
    // 第一次：金额在 SUBTOTAL、CARD、TOTAL DUE 三处都是 9.80，标签说得清是 TOTAL DUE；还没学会。
    expect(one.memory!.fields.amount).toMatchObject({
      kind: 'amount',
      label: 'total due',
      hits: 1,
    });
    // 用户写的备注不在文字里：不学。
    expect(one.memory!.fields.note).toBeUndefined();
    const two = save(one.memory, shop('Bread 3.10\nEggs 2.90', '6.00', '03/09/2026'), {
      amount: 6,
      when: '2026-03-09',
      shop: 'Maple Corner Store',
    });
    expect(two.memory!.fields.amount!.hits).toBe(2);
    expect(two.memory!.fields.shop).toMatchObject({
      kind: 'constant',
      value: 'Maple Corner Store',
      hits: 2,
    });
    // 金额和日期不记值本身。
    expect(JSON.stringify(two.memory)).not.toMatch(/9\.80|6\.00|2026-03/);

    const third = shop('Tea 5.00\nJam 3.75\nRice 2.00', '10.75', '03/16/2026');
    const result = prefillRecord({
      text: third,
      locale: 'en',
      fields: FIELDS,
      memories: [two.memory!],
    });
    expect(result.values).toEqual({
      amount: { value: 10.75, source: 'memory' },
      when: { value: '2026-03-16', source: 'memory' },
      shop: { value: 'Maple Corner Store', source: 'memory' },
    });
  });

  it('does not fill the shop name when the new text does not contain it', () => {
    const memory: LayoutMemory = {
      id: 'm',
      anchors: ['total due', 'thank you for shopping', 'tel'],
      fieldTypes: { shop: 'text' },
      fields: { shop: { kind: 'constant', value: 'Maple Corner Store', hits: 3 } },
    };
    expect(readWithLayout(memory.fields.shop!, 'Other Shop\nTOTAL DUE 3.00', [])).toBeNull();
  });

  it('demotes a habit the user corrected', () => {
    let memory: LayoutMemory | null = null;
    for (const [total, day] of [
      ['9.80', '03/02/2026'],
      ['6.00', '03/09/2026'],
    ] as const)
      memory = save(memory, shop('Milk 4.20', total, day), { amount: Number(total) }).memory;
    expect(memory!.fields.amount!.hits).toBe(2);
    // 记忆填了 10.75，用户改成 12.00（文字里找不到 12.00）：降级，不再用。
    const text = shop('Tea 5.00', '10.75', '03/16/2026');
    const result = prefillRecord({ text, locale: 'en', fields: FIELDS, memories: [memory!] });
    expect(result.values.amount).toEqual({ value: 10.75, source: 'memory' });
    const after = learnLayout(
      memory,
      {
        text,
        fields: FIELDS,
        saved: { amount: 12 },
        prefilled: result.values,
        candidates: result.candidates,
      },
      'x',
    );
    expect(after!.fields.amount!.hits).toBe(0);
  });

  it('does not learn when the value appears several times with nothing to tell them apart', () => {
    const text =
      'Maple Corner Store\n12 Example Road\nTel 555-0142\nItem 4.20\nItem 4.20\nThank you';
    const memory = learnLayout(
      null,
      {
        text,
        fields: FIELDS,
        saved: { amount: 4.2, shop: 'Maple Corner Store' },
        candidates: ruleCandidates(text, 'en'),
      },
      'm',
    );
    expect(memory!.fields.amount).toBeUndefined();
    expect(memory!.fields.shop).toBeDefined();
  });

  it('drops habits whose field was removed or changed type', () => {
    const memory: LayoutMemory = {
      id: 'm',
      anchors: ['a', 'b', 'c'],
      fieldTypes: { amount: 'money', when: 'date' },
      fields: {
        amount: {
          kind: 'amount',
          label: 'total',
          offset: 0,
          position: 0.5,
          format: 'dot',
          hits: 2,
        },
        when: { kind: 'date', label: 'date', offset: 0, position: 0.1, format: '9/9/9', hits: 2 },
      },
    };
    const changed = fields([['amount', 'Total', 'number']]);
    expect(reconcileLayout(memory, changed).fields).toEqual({});
  });

  it('only matches the layout whose label lines are on the page', () => {
    const memory: LayoutMemory = {
      id: 'm',
      anchors: ['maple corner store', 'example road', 'total due', 'thank you for shopping'],
      fieldTypes: {},
      fields: {},
    };
    expect(findLayout([memory], shop('Tea 5.00', '5.00', '03/16/2026'))).toBe(memory);
    expect(findLayout([memory], RECEIPT_ZH)).toBeNull();
  });

  it('uses line boxes to choose between two values under the same label', () => {
    const text = 'Header\nTotal 5.00\nmiddle\nmiddle\nTotal 7.00';
    const candidates = ruleCandidates(text, 'en');
    const habit = {
      kind: 'amount',
      label: 'total',
      offset: 0,
      position: 0.95,
      format: 'dot',
      hits: 2,
    } as const;
    const boxes = [0, 100, 200, 300, 900].map((y) => ({ y, height: 20 }));
    expect(readWithLayout(habit, text, candidates, boxes)).toBe('7.00');
    // 位置差不多远：分不清，空着。
    expect(readWithLayout({ ...habit, position: 0.625 }, text, candidates)).toBeNull();
  });
});

describe('prefillRecord without memory', () => {
  it('fills amount, tax, date and number by rules, leaves the rest empty', () => {
    const result = prefillRecord({
      text: FACTURE_FR,
      locale: 'fr',
      fields: fields([
        ['montant', 'Montant', 'money'],
        ['tva', 'TVA', 'money'],
        ['jour', 'Date', 'date'],
        ['numero', 'Numéro', 'text'],
        ['fournisseur', 'Fournisseur', 'text'],
        ['cat', 'Catégorie', 'choice'],
      ]),
    });
    expect(result.values).toEqual({
      montant: { value: 102, source: 'rule' },
      tva: { value: 17, source: 'rule' },
      jour: { value: '2026-03-05', source: 'rule' },
      numero: { value: 'F2026-118', source: 'rule' },
    });
  });

  it('does not guess which of two money or date fields is meant', () => {
    const result = prefillRecord({
      text: INVOICE_EN,
      locale: 'en',
      fields: fields([
        ['paid', 'Paid', 'money'],
        ['owed', 'Owed', 'money'],
        ['issued', 'Issued', 'date'],
        ['due', 'Due', 'date'],
      ]),
    });
    expect(result.values).toEqual({});
  });

  it('uses a system date when the rules found none', () => {
    const text = 'Corner Deli\nPaid on 3 March\nTotal 8.40';
    const result = prefillRecord({
      text,
      locale: 'en',
      fields: fields([
        ['amount', 'Amount', 'money'],
        ['day', 'Day', 'date'],
      ]),
      system: [{ kind: 'date', start: 20, end: 27, value: '2026-03-03' }],
    });
    expect(result.values).toEqual({
      amount: { value: 8.4, source: 'rule' },
      day: { value: '2026-03-03', source: 'system' },
    });
  });
});
