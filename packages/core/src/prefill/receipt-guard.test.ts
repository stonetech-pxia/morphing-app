import { describe, expect, it } from 'vitest';

import type { Field, Locale } from '../schema';
import { ruleEngine } from './engine';

// 不倒退的守护（D-403）：自己编的中文、英文、法语、西语、德语小票和发票，只断言「原来就认对了」的格子，
// 加上「宁可不填」的情况（没标税额不给税额、一个日期也要给、什么都没有就什么都不填）。
// 这组测试在加规则之前的代码上也通过；以后改规则，这里红了就是倒退了。

const NOW = new Date('2026-11-02T00:00:00Z');

async function run(rows: string[], opts: { currency?: string; locale?: Locale } = {}) {
  const currency = opts.currency ?? 'USD';
  const fields: Field[] = [
    { id: 'total', name: 'Amount', type: 'money', currency } as Field,
    { id: 'tax', name: 'Tax', type: 'money', currency } as Field,
    { id: 'date', name: 'Date', type: 'date' } as Field,
    { id: 'merchant', name: 'Merchant', type: 'text' } as Field,
  ];
  const page = {
    width: 600,
    height: 40 + rows.length * 30,
    lines: rows.map((text, i) => ({ text, x: 20, y: 20 + i * 30, width: 500, height: 24 })),
  };
  const out = await ruleEngine({ fields, pages: [page], locale: opts.locale ?? 'en', now: NOW });
  const values = (id: string) => (out[id] ?? []).map((s) => s.value);
  return {
    total: values('total'),
    tax: values('tax'),
    date: values('date'),
    merchant: values('merchant'),
  };
}
const num = (v: string | undefined) => Number(v);

describe('中文', () => {
  it('超市小票：合计、日期', async () => {
    const r = await run(
      [
        '美佳乐超市',
        '地址：南山路88号',
        '2026-09-18 14:32:05',
        '矿泉水 2.00',
        '面包 8.50',
        '牛奶 12.80',
        '合计 23.30',
        '微信支付 23.30',
      ],
      { currency: 'CNY', locale: 'zh' },
    );
    expect(num(r.total[0])).toBe(23.3);
    expect(r.date[0]).toBe('2026-09-18');
  });

  it('药房小票：有税额就给税额，合计不被找零带走', async () => {
    const r = await run(
      [
        '康乐药房',
        '2026年09月18日 10:20',
        '感冒灵 28.00',
        '税额 3.22',
        '合计 28.00',
        '现金 30.00',
        '找零 2.00',
      ],
      { currency: 'CNY', locale: 'zh' },
    );
    expect(num(r.total[0])).toBe(28);
    expect(num(r.tax[0])).toBe(3.22);
    expect(r.date[0]).toBe('2026-09-18');
    expect(r.merchant[0]).toBe('康乐药房');
  });

  it('增值税发票：税额、开票日期、销售方', async () => {
    const r = await run(
      [
        '增值税普通发票',
        '开票日期：2026年08月05日',
        '销售方：星河科技有限公司',
        '金额 1000.00',
        '税额 130.00',
        '价税合计 1130.00',
      ],
      { currency: 'CNY', locale: 'zh' },
    );
    expect(num(r.tax[0])).toBe(130);
    expect(r.date[0]).toBe('2026-08-05');
    expect(r.merchant[0]).toBe('星河科技有限公司');
  });

  it('餐馆小票：应收、日期、店名', async () => {
    const r = await run(
      ['老张面馆', '日期：2026-10-02', '牛肉面 28.00', '凉菜 12.00', '应收 40.00', '实收 40.00'],
      { currency: 'CNY', locale: 'zh' },
    );
    expect(num(r.total[0])).toBe(40);
    expect(r.date[0]).toBe('2026-10-02');
    expect(r.merchant[0]).toBe('老张面馆');
  });
});

describe('英文', () => {
  it('餐馆：小计、税、合计，美式日期月在前', async () => {
    const r = await run([
      "JOE'S DINER",
      '123 Main St',
      '10/02/2026 7:45 PM',
      'Burger 12.00',
      'Fries 4.00',
      'Subtotal 16.00',
      'Tax 1.32',
      'Total 17.32',
      'Visa 17.32',
    ]);
    expect(num(r.total[0])).toBe(17.32);
    expect(num(r.tax[0])).toBe(1.32);
    expect(r.date[0]).toBe('2026-10-02');
    expect(r.merchant[0]).toBe("JOE'S DINER");
  });

  it('零售：找零不是合计', async () => {
    const r = await run([
      'NORTHSIDE HARDWARE',
      'Store 1234',
      '03/14/2026',
      'Hammer 15.99',
      'Nails 4.50',
      'Sub Total 20.49',
      'Sales Tax 1.64',
      'Total 22.13',
      'Cash 25.00',
      'Change 2.87',
    ]);
    expect(num(r.total[0])).toBe(22.13);
    expect(num(r.tax[0])).toBe(1.64);
    expect(r.date[0]).toBe('2026-03-14');
    expect(r.merchant[0]).toBe('NORTHSIDE HARDWARE');
  });

  it('发票：Total due、Invoice date、公司名', async () => {
    const r = await run([
      'Acme Plumbing LLC',
      'Invoice No 2026-114',
      'Invoice date: 2026-05-12',
      'Description Amount',
      'Repair service 250.00',
      'Subtotal 250.00',
      'Tax 20.00',
      'Total due 270.00',
    ]);
    expect(num(r.total[0])).toBe(270);
    expect(num(r.tax[0])).toBe(20);
    expect(r.date[0]).toBe('2026-05-12');
    expect(r.merchant[0]).toBe('Acme Plumbing LLC');
  });

  it('没写税的小票：合计、日期、店名照给', async () => {
    const r = await run([
      'FARMERS MARKET STAND',
      'June 4, 2026',
      'Apples 6.00',
      'Pears 4.00',
      'Total 10.00',
      'Cash 10.00',
    ]);
    expect(num(r.total[0])).toBe(10);
    expect(r.date[0]).toBe('2026-06-04');
    expect(r.merchant[0]).toBe('FARMERS MARKET STAND');
  });
});

describe('法语', () => {
  it('餐厅：Total TTC、dont TVA', async () => {
    const r = await run(
      [
        'BRASSERIE DU COIN',
        '12 rue des Fleurs',
        'Date : 14/03/2026',
        'Plat du jour 14,50',
        'Boisson 3,50',
        'Total TTC 18,00',
        'dont TVA 10% 1,64',
        'Carte bancaire 18,00',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(num(r.total[0])).toBe(18);
    expect(num(r.tax[0])).toBe(1.64);
    expect(r.date[0]).toBe('2026-03-14');
    expect(r.merchant[0]).toBe('BRASSERIE DU COIN');
  });

  it('发票：日在前', async () => {
    const r = await run(
      [
        'Dupont Plomberie SARL',
        'Facture n° F-2026-051',
        'Date de facture : 03/04/2026',
        "Main d'oeuvre 200,00",
        'Total HT 200,00',
        'TVA 20% 40,00',
        'Total TTC 240,00',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(num(r.total[0])).toBe(240);
    expect(num(r.tax[0])).toBe(40);
    expect(r.date[0]).toBe('2026-04-03');
    expect(r.merchant[0]).toBe('Dupont Plomberie SARL');
  });

  it('只有一个日期也要给', async () => {
    const r = await run(['Boulangerie Martin', '28/02/2026', 'Baguette 1,20', 'Total 1,20'], {
      currency: 'EUR',
      locale: 'fr',
    });
    expect(r.date).toEqual(['2026-02-28']);
    expect(num(r.total[0])).toBe(1.2);
    expect(r.merchant[0]).toBe('Boulangerie Martin');
  });
});

describe('西班牙语', () => {
  it('小票：没标税额就不给税额', async () => {
    const r = await run(
      [
        'SUPERMERCADO LA PLAZA',
        'Fecha: 21/05/2026',
        'Leche 1,10',
        'Pan 0,90',
        'Total 2,00',
        'Efectivo 5,00',
        'Cambio 3,00',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(num(r.total[0])).toBe(2);
    expect(r.tax).toEqual([]);
    expect(r.date[0]).toBe('2026-05-21');
    expect(r.merchant[0]).toBe('SUPERMERCADO LA PLAZA');
  });

  it('发票：Total factura、日期、公司', async () => {
    const r = await run(
      [
        'Servicios Torres SL',
        'Factura 2026/77',
        'Fecha 15/06/2026',
        'Base imponible 100,00',
        'IVA 21% 21,00',
        'Total factura 121,00',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(num(r.total[0])).toBe(121);
    expect(r.date[0]).toBe('2026-06-15');
    expect(r.merchant[0]).toBe('Servicios Torres SL');
  });
});

describe('德语', () => {
  it('收银小票：Summe，不是 Gegeben', async () => {
    const r = await run(
      [
        'BAECKEREI MUELLER',
        'Datum 12.03.2026',
        'Brötchen 1,20',
        'Summe 1,20',
        'Gegeben 5,00',
        'Rückgeld 3,80',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(num(r.total[0])).toBe(1.2);
    expect(r.date[0]).toBe('2026-03-12');
    expect(r.merchant[0]).toBe('BAECKEREI MUELLER');
  });

  it('发票：Gesamtbetrag、Rechnungsdatum', async () => {
    const r = await run(
      [
        'Schmidt Elektro GmbH',
        'Rechnungsnummer 2026-88',
        'Rechnungsdatum: 20.04.2026',
        'Nettobetrag 100,00',
        'MwSt 19% 19,00',
        'Gesamtbetrag 119,00',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(num(r.total[0])).toBe(119);
    expect(r.date[0]).toBe('2026-04-20');
    expect(r.merchant[0]).toBe('Schmidt Elektro GmbH');
  });
});

describe('宁可不填', () => {
  it('什么都没有的单据：金额、税额、日期都不填', async () => {
    const r = await run(['Thank you', 'Please come again', 'Have a nice day']);
    expect(r.total).toEqual([]);
    expect(r.tax).toEqual([]);
    expect(r.date).toEqual([]);
  });

  it('两个日期：开票日排第一，到期日不抢', async () => {
    const r = await run(['Shop', 'Date 2026-03-04', 'Due date 2026-04-03', 'Total 8.00']);
    expect(r.date[0]).toBe('2026-03-04');
    expect(r.tax).toEqual([]);
  });
});
