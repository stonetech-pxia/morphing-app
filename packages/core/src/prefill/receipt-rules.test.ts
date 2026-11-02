import { describe, expect, it } from 'vitest';

import type { Field, Locale } from '../schema';
import { ruleEngine } from './engine';

// D-403：预填引擎里每条有行为的规则各一个测试。文字都是自己编的票据；每条在加规则之前的代码上都失败过。
// 断言写「应该怎样」。不倒退的守护在 receipt-guard.test.ts。

const NOW = new Date('2026-11-02T00:00:00Z');

/** 一排一排的文字；一排可以是几段 [文字, x]（同一排里的几格）。 */
type Row = string | [string, number][];

async function run(rows: Row[], opts: { currency?: string; locale?: Locale; now?: Date } = {}) {
  const currency = opts.currency ?? 'USD';
  const fields: Field[] = [
    { id: 'total', name: 'Amount', type: 'money', currency } as Field,
    { id: 'tax', name: 'Tax', type: 'money', currency } as Field,
    { id: 'date', name: 'Date', type: 'date' } as Field,
    { id: 'merchant', name: 'Merchant', type: 'text' } as Field,
  ];
  const lines = rows.flatMap((row, i) =>
    (typeof row === 'string' ? [[row, 20] as [string, number]] : row).map(([text, x]) => ({
      text,
      x,
      y: 20 + i * 30,
      width: text.length * 10,
      height: 24,
    })),
  );
  const page = { width: 600, height: 40 + rows.length * 30, lines };
  const out = await ruleEngine({
    fields,
    pages: [page],
    locale: opts.locale ?? 'en',
    now: opts.now ?? NOW,
  });
  const values = (id: string) => (out[id] ?? []).map((s) => s.value);
  return {
    total: values('total'),
    tax: values('tax'),
    date: values('date'),
    merchant: values('merchant'),
  };
}
const n = (v: string | undefined) => Number(v);

describe('合计', () => {
  it('日文「合計」是合计，小計、お預り、お釣り不是', async () => {
    const r = await run(
      [
        'ファミリー商店',
        '2025年11月3日',
        'おにぎり ¥150',
        'お茶 ¥140',
        '小計 ¥290',
        '合計 ¥313',
        'お預り ¥1000',
        'お釣り ¥687',
      ],
      { currency: 'JPY', locale: 'zh' },
    );
    expect(n(r.total[0])).toBe(313);
  });

  it('标签后面紧跟的整数也是合计（没有两位小数）', async () => {
    const r = await run(['SHOP SDN BHD', '12/11/2025', 'Total:20', 'Cash:50'], { currency: 'MYR' });
    expect(r.total.map(Number)).toEqual([20]);
  });

  it('同分的合计候选：能由别的候选加出来的、更大的排前面', async () => {
    const r = await run(['Shop', 'Total 10.00', 'Total 3.00', 'Total 7.00']);
    expect(r.total.map(Number)).toEqual([10, 7, 3]);
  });

  it('空格当千位分隔（3 620,84 €）整体取，不拆成 620,84', async () => {
    const r = await run(
      [
        'Facture',
        'Date 12/03/2025',
        'Total HT 3 017,37 €',
        'TVA 20% 603,47 €',
        'Total TTC 3 620,84 €',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(r.total.map(Number)).toEqual([3620.84]);
  });

  it('一排「标签 + 三个数」A + B = C：C 是合计', async () => {
    const r = await run(['Shop', '03/11/2025', 'Net Tax Total 100.00 8.00 108.00']);
    expect(n(r.total[0])).toBe(108);
  });

  it('含税合计是合计；数量、Total tax 不抢合计', async () => {
    const r = await run([
      'Shop',
      'Total qty 3.00',
      'Subtotal 30.00',
      'Vat 6.00',
      'Total incl tax 36.00',
    ]);
    expect(n(r.total[0])).toBe(36);
    expect(r.total.map(Number)).not.toContain(3);
  });

  it('德语：Summe 是合计，Gegeben、Rückgeld 不是', async () => {
    const r = await run(
      [
        'Kassenbon',
        'Datum 12.03.2025',
        'Brot 2,50',
        'Kaffee 4,90',
        'Summe 7,40',
        'Gegeben 10,00',
        'Rückgeld 2,60',
      ],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(n(r.total[0])).toBe(7.4);
  });

  it('德语：没有合计标签时，付款 Bar 减 Rückgeld 就是总额', async () => {
    const r = await run(
      ['Laden', '12.03.2025', 'Brot 2,50', 'Kaffee 4,90', '7,40', 'Bar 10,00', 'Rückgeld 2,60'],
      { currency: 'EUR', locale: 'fr' },
    );
    expect(n(r.total[0])).toBe(7.4);
  });

  it('金额都写两位小数时，写成整数的（$20）排在带小数的后面', async () => {
    const r = await run(['Shop', 'Total $20', 'Total 15.50']);
    expect(n(r.total[0])).toBe(15.5);
  });

  it('标签写着合计的数排第一，算术只靠明细求和得出的不抢', async () => {
    const r = await run(['Total 9.00', 'Coffee 3.00', 'Muffin 4.00', 'Cash 20.00', 'Change 7.00']);
    expect(n(r.total[0])).toBe(9);
  });
});

describe('税额', () => {
  it('日文「消費税」是税额', async () => {
    const r = await run(
      ['ファミリー商店', '2025年11月3日', '小計 ¥290', '消費税 ¥23', '合計 ¥313'],
      {
        currency: 'JPY',
        locale: 'zh',
      },
    );
    expect(n(r.tax[0])).toBe(23);
  });

  it('标签后面紧跟的整数也是税额', async () => {
    const r = await run(
      ['SHOP SDN BHD', '12/11/2025', 'Subtotal: 100.00', 'GST:6', 'Total: 106.00'],
      {
        currency: 'MYR',
      },
    );
    expect(r.tax.map(Number)).toEqual([6]);
  });

  it('对得上票上税率的数排第一', async () => {
    const r = await run(['Shop', 'Subtotal 100.00', 'Tax 107.00', 'Tax 7% 7.00']);
    expect(n(r.tax[0])).toBe(7);
  });

  it('加得上别的金额的税额候选排前面，同分取小的', async () => {
    const r = await run(['Shop', 'Tax 54.00', 'Tax 4.00', 'Net 50.00']);
    expect(n(r.tax[0])).toBe(4);
  });

  it('只剩 14VAT 这样的标签也认得出税额', async () => {
    const r = await run(['Shop', 'Sales 100.00', '14VAT 14.00', 'Total 114.00']);
    expect(n(r.tax[0])).toBe(14);
  });

  it('一排「标签 + 三个数」里中间那个是税额', async () => {
    const r = await run(['Shop', 'Subtotal Tax Total', '100.00 8.00 108.00']);
    expect(n(r.tax[0])).toBe(8);
  });

  it('金额里有「税额 + 某数 = 全文最大金额」的，没有税标签也进候选', async () => {
    const r = await run(['Shop', 'Items 50.00', 'Surcharge 4.00', 'Total 54.00', 'VAT included']);
    expect(n(r.tax[0])).toBe(4);
  });

  it('没标税额的小票不给税额候选（宁可不填）', async () => {
    const r = await run(['Shop', 'Item 40.00', 'Discount 5.00', 'Total 35.00']);
    expect(r.tax).toEqual([]);
  });

  it('整份文字里一个税字样都没有，孤零零的数不当税额', async () => {
    const r = await run(['Shop', 'thank you', 'Ref', '3.20']);
    expect(r.tax).toEqual([]);
  });

  // 旧代码没有「没写税就扣分」，这几条在旧代码上本来就通过；它们守的是新扣分不误伤：
  // 对照只认英法西德意荷和「税」的词表时，阿拉伯、俄、葡、韩、土、波六条会失败（见 DECISIONS D-403）。
  it.each([
    ['阿拉伯语', 'EGP', 'ضريبة القيمة المضافة مشمولة'],
    ['俄语', 'RUB', 'В том числе НДС'],
    ['葡萄牙语', 'BRL', 'Imposto incluso'],
    ['韩语', 'KRW', '부가세 포함'],
    ['土耳其语', 'TRY', 'KDV dahil'],
    ['波兰语', 'PLN', 'zawiera PTU'],
    ['日语', 'JPY', '消費税込み'],
    ['中文', 'CNY', '含税价'],
  ])('%s的税字样：孤零零的税额不被扣分', async (_name, currency, line) => {
    const r = await run(['Shop', line, 'Ref', '3.20'], { currency });
    expect(r.tax).toEqual(['3.20']);
  });
});

describe('日期', () => {
  it('年在后、用 - 分隔的数字日期，日在前', async () => {
    const r = await run(['Shop', 'Date 05-03-2026', 'Total 5.00']);
    expect(r.date[0]).toBe('2026-03-05');
  });

  it('表的币种是欧元，03/04/2026 是 4 月 3 日', async () => {
    const r = await run(['Shop', 'Date 03/04/2026', 'Total 5.00'], { currency: 'EUR' });
    expect(r.date[0]).toBe('2026-04-03');
  });

  it('文字里有 £ 或 VAT 字样（没有 $），日在前', async () => {
    const gbp = await run(['Shop', 'Date 03/04/2026', 'Total £5.00'], { currency: 'GBP' });
    expect(gbp.date[0]).toBe('2026-04-03');
    const vat = await run(['Shop Ltd', 'VAT No 123', 'Date 03/04/2026', 'Total 5.00']);
    expect(vat.date[0]).toBe('2026-04-03');
  });

  it('有 GST 又没有加拿大省税，日在前', async () => {
    const r = await run(['Shop', 'GST 0.45', 'Date 03/04/2026', 'Total 5.00'], { currency: 'AUD' });
    expect(r.date[0]).toBe('2026-04-03');
  });

  it('文档自己有「25/12/2025」这样的证据时，听它的（不管界面语言）', async () => {
    const r = await run(['Shop', 'Date 03/04/2026', 'Ref 25/12/2025', 'Total $5.00']);
    expect(r.date.indexOf('2026-04-03')).toBeGreaterThanOrEqual(0);
    expect(r.date.indexOf('2026-04-03')).toBeLessThan(
      r.date.indexOf('2026-03-04') < 0 ? 99 : r.date.indexOf('2026-03-04'),
    );
  });

  it('时间和日期粘在一起也认', async () => {
    const r = await run(['Shop', 'Total 5.00', '23:16:4615/08/2025']);
    expect(r.date).toEqual(['2025-08-15']);
  });

  it('没有标签的真日期不被另一个假日期挤出窗口', async () => {
    const r = await run(['Shop', 'Ref 2010-02-19', '2026-03-05', 'Total 5.00']);
    expect(r.date).toEqual(['2026-03-05']);
  });

  it('退货期限不是开票日，但同一排的开票日还在', async () => {
    const r = await run(['Shop', 'Date 03/04/2026 Return by 03/20/2026', 'Total 5.00']);
    expect(r.date).not.toContain('2026-03-20');
    expect(r.date[0]).toBe('2026-03-04');
  });

  it('日本地址里的 1-2-25 不是日期', async () => {
    const r = await run(['ファミリー 東京都渋谷区神南 1-2-25', 'Total 500', '2026-01-05'], {
      currency: 'JPY',
    });
    expect(r.date).toEqual(['2026-01-05']);
  });

  it('打印日期排到最后', async () => {
    const r = await run(['Shop', 'Printed 2026-11-01', 'Date 2026-10-30', 'Total 5.00']);
    expect(r.date).toEqual(['2026-10-30', '2026-11-01']);
  });

  it.each([
    ['28-Oct-2025', 'Date 28-Oct-2025', '2025-10-28', 'USD'],
    ['西语「3 de enero de 2026」', 'Fecha 3 de enero de 2026', '2026-01-03', 'EUR'],
    ['德语「15. März 2026」', '15. März 2026', '2026-03-15', 'EUR'],
  ])('月份名写法 %s', async (_name, row, expected, currency) => {
    const r = await run(['Shop', row, 'Total 5.00'], { currency });
    expect(r.date).toEqual([expected]);
  });

  it('两位年 99 是 1999，不是 2099', async () => {
    const r = await run(['Shop', 'Date 15/08/99', 'Total 5.00']);
    expect(r.date).toEqual(['1999-08-15']);
  });

  it('两位年的日期，两个分隔符要一样（12-05/26 不是日期）', async () => {
    const r = await run(['Shop', 'Ref 12-05/26', 'Total 5.00']);
    expect(r.date).toEqual([]);
  });

  it('「Date sent」不是开票日', async () => {
    const r = await run(['Shop', 'Date sent: 2026-01-02', 'Order date: 2026-01-01', 'Total 5.00']);
    expect(r.date[0]).toBe('2026-01-01');
  });

  it('页面最上面单独一排的日期，别的日期很多、分数低于门槛也给', async () => {
    const r = await run([
      '12 Jan 2026',
      'Shop A',
      'Item 01/02/2026 2.00',
      'Item 02/02/2026 3.00',
      'Item 03/02/2026 4.00',
      'Item 04/02/2026 5.00',
      'Item 05/02/2026 6.00',
    ]);
    expect(r.date).toEqual(['2026-01-12']);
  });
});

describe('店名', () => {
  it('单据名「SALES RECEIPT」不是店名', async () => {
    const r = await run(['SALES RECEIPT', 'Joes Diner', 'Total 5.00']);
    expect(r.merchant).toEqual(['Joes Diner']);
  });

  it('日文「領収書」不是店名，带「株式会社」的才是', async () => {
    const r = await run(['領収書', '2025年11月3日', '合計 ¥500', '株式会社ファミリー商事'], {
      currency: 'JPY',
      locale: 'zh',
    });
    expect(r.merchant[0]).toBe('株式会社ファミリー商事');
  });

  it('「Store: Downtown Branch」是分店，店名在最上面', async () => {
    const r = await run(['JOES DINER', 'Store: Downtown Branch', 'Total 5.00']);
    expect(r.merchant).toEqual(['JOES DINER']);
  });

  it('上一排的短词（Pago）只是字母像「store」，不是店名标签', async () => {
    const r = await run(
      [
        'Ropa Outdoor Norte',
        'Emisor',
        'Factura B',
        'Domicilio: San Martin 300',
        'Receptor',
        'Pago',
        'Total 55,00',
      ],
      { currency: 'ARS' },
    );
    expect(r.merchant[0]).toBe('Ropa Outdoor Norte');
  });

  it('去掉「Welcome to」', async () => {
    const r = await run(['Welcome to Joes Diner', 'Total 5.00']);
    expect(r.merchant).toEqual(['Joes Diner']);
  });

  it('带公司后缀的单独一排补进候选', async () => {
    const r = await run(['Tel 123', 'Order 55', 'Thank you', 'Foo Bar Trading Pty', 'Total 5.00']);
    expect(r.merchant).toEqual(['Foo Bar Trading Pty']);
  });

  it('含「超市」「Street」字样的店名不因为像地址被排除', async () => {
    const zh = await run(['大润发超市', '合计 12.00'], { currency: 'CNY', locale: 'zh' });
    expect(zh.merchant).toEqual(['大润发超市']);
    const en = await run(['12 Main Street Cafe', 'Total 12.00']);
    expect(en.merchant).toEqual(['12 Main Street Cafe']);
  });

  it('「Powered by」不是店名', async () => {
    const r = await run(['Powered by Toast', 'Joes Diner', 'Total 5.00']);
    expect(r.merchant).toEqual(['Joes Diner']);
  });

  it('「Seller: Client:」表头下面一排，左边那格是卖方', async () => {
    const r = await run([
      'INVOICE',
      'Invoice No 77',
      [
        ['Seller:', 20],
        ['Client:', 300],
      ],
      [
        ['Acme Supplies Ltd', 20],
        ['Contoso Trading Inc', 300],
      ],
      [
        ['12 Oak Road', 20],
        ['9 Pine Road', 300],
      ],
      'Total 5.00',
    ]);
    expect(r.merchant[0]).toBe('Acme Supplies Ltd');
  });

  it('发票：开票方（Supplier）排在收票方（Bill to）前面', async () => {
    const r = await run([
      'INVOICE',
      'Bill to',
      'Acme Corp',
      'Invoice No 1',
      'Due date 2026-03-01',
      'Supplier',
      'Joes Plumbing',
      'Amount due 55.00',
    ]);
    expect(r.merchant[0]).toBe('Joes Plumbing');
  });
});
