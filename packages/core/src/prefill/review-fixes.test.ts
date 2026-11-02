import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { amountChain } from './amount-chain';
import { planDocument } from './code-rules';
import { ruleEngine } from './engine';
import { invoiceNoByKey, upperAmount, upperToNumber } from './zh-rules';

// 审核 D-399 时发现的问题，每条都是「应该怎样」（每条在修之前的代码上都失败过）。

const AMOUNT: Field = { id: 'total', name: 'Amount', type: 'money', currency: 'USD' };
const DATE: Field = { id: 'day', name: 'Date', type: 'date' };
const NUMBER: Field = { id: 'no', name: 'Number', type: 'text' };
const MERCHANT: Field = { id: 'merchant', name: 'Merchant', type: 'text' };
const money = (name: string): Field => ({ id: 'x', name, type: 'money', currency: 'CNY' });

const pageOf = (rows: string[]) => ({
  width: 600,
  height: 40 + rows.length * 30,
  lines: rows.map((t, i) => ({ text: t, x: 20, y: 20 + i * 30, width: 500, height: 24 })),
});
const now = new Date('2026-11-01T00:00:00Z');
const first = async (field: Field, rows: string[], locale: 'en' | 'fr' | 'zh' = 'en') =>
  (await ruleEngine({ fields: [field], pages: [pageOf(rows)], locale, now }))[field.id]?.[0]?.value;
const planOf = (field: Field, rows: string[], locale: 'en' | 'fr' | 'zh' = 'en') =>
  planDocument({ fields: [field], pages: [pageOf(rows)], locale, now }).fields[0]!;

describe('单号：通用的 No 不吃别的号码（第 1 条）', () => {
  it.each([
    'Tel No: 03-12345678',
    'Co No: 123456-X',
    'Reg No: 200301012345',
    'No. 12A-3, Jalan Bukit',
    '流水号 NO 998877',
  ])('%s 不是单号', async (row) => {
    expect(invoiceNoByKey([row])).toBeNull();
    const p = planOf(NUMBER, [row]);
    expect(p.code.map((s) => s.value)).toEqual([]);
  });

  it('明确的键名赢过通用的 No，字母开头超过 2 个字母也取得到', () => {
    expect(invoiceNoByKey(['Invoice No: INV12345'])).toBe('INV12345');
    expect(invoiceNoByKey(['No: 998877', 'Invoice No: INV12345'])).toBe('INV12345');
    expect(invoiceNoByKey(['Receipt No: RCP-2026-77'])).toBe('RCP-2026-77');
  });

  it('认 N°', () => {
    expect(invoiceNoByKey(['FACTURE N° 2026-0451'])).toBe('2026-0451');
    expect(invoiceNoByKey(['N° 2026-0451'])).toBe('2026-0451');
  });

  it('原来认得的还认得', () => {
    expect(invoiceNoByKey(['NO 11112222'])).toBe('11112222');
    expect(invoiceNoByKey(['No.8039067169'])).toBe('8039067169');
    expect(invoiceNoByKey(['Ticket No 12345678'])).toBe('12345678');
  });

  it('真实票据上 OCR 把几格接成一排：只看 No 自己的那一段（SIBR）', () => {
    expect(invoiceNoByKey(['业务流水号： 医疗类型： NO. 2007092215'])).toBe('2007092215');
    expect(invoiceNoByKey(['业务流水号： NO 2038022056'])).toBe('2038022056');
    expect(invoiceNoByKey(['备流水号 U9649201 医疗类型城市医保 NO 7912778710'])).toBe('7912778710');
    expect(invoiceNoByKey(['医疗机构类型： 二甲 皖财专（2014）P No 9059707910'])).toBe(
      '9059707910',
    );
    expect(invoiceNoByKey(['账单号 Folio No. 15646', 'Conf. No. 11849'])).toBe('15646');
    expect(invoiceNoByKey(['Beijing Invoice 24718066052020', 'No.25407626'])).toBe('25407626');
  });
});

describe('算术：付款和小计不排到合计前面（第 2 条）', () => {
  const items = ['Coffee 5.00', 'Cake 10.00'];

  it('有明细没有找零：现金不是总额', async () => {
    const rows = [...items, 'Total 15.00', 'Cash 20.00'];
    expect(amountChain(rows, false, 'en')?.value).not.toBe(20);
    expect(Number(await first(AMOUNT, rows))).toBe(15);
  });

  it('付款排也不算小计', async () => {
    const rows = ['Coffee 12.00', 'Cake 8.00', 'Total 19.00', 'Visa 20.00'];
    expect(amountChain(rows, false, 'en')?.value).not.toBe(20);
    expect(Number(await first(AMOUNT, rows))).toBe(19);
  });

  it('负数的优惠要算', async () => {
    const rows = ['Tea 12.00', 'Cake 8.00', 'Subtotal 20.00', 'Discount -5.00', 'Total 15.00'];
    expect(amountChain(rows, false, 'en')).toEqual({ value: 15, how: 'subtotalAdjust' });
    expect(Number(await first(AMOUNT, rows))).toBe(15);
    expect(Number(await first(AMOUNT, ['Subtotal 20', 'Discount -5.00', 'Total 15']))).not.toBe(20);
  });

  it('找零比总额大也认（写着合计的那排）；现金可以没有小数', () => {
    const chain = { value: 28.9, how: 'payMinusChange' };
    expect(amountChain(['Total 28.90', 'Cash 100.00', 'Change 71.10'], false, 'en')).toEqual(chain);
    expect(amountChain(['Total 28.90', 'Cash 100', 'Change 71.10'], false, 'en')).toEqual(chain);
  });

  it('合计那排 OCR 没读出数时，付款排的数可以是总额（真实小票）', () => {
    const rows = [
      'A 100.00',
      'B 44.68',
      'SUB-TOTAL 144.68',
      'TOTAL TAX 8.68',
      'TOTAL',
      'CASH 153.35',
    ];
    expect(amountChain(rows, false, 'en')?.value).toBe(153.35);
  });

  it('不写合计的一排不靠大额找零算成总额', () => {
    const rows = ['Coffee 5.00', 'Cash 100.00', 'Change 95.00'];
    expect(amountChain(rows, false, 'en')?.how).not.toBe('payMinusChange');
  });
});

describe('酒店取最晚日期的判断（第 3 条）', () => {
  it('room 要是一个词：Mushroom Cafe 不是酒店', async () => {
    const rows = ['Mushroom Cafe', 'Departure board', 'Date 2026-01-01', 'Next visit 2026-03-01'];
    expect(await first(DATE, rows)).toBe('2026-01-01');
  });

  it('机票、接送的 departure 不算酒店', async () => {
    const rows = ['Booking date 2026-11-01', 'Guest details', 'Departure', 'Return 2027-01-05'];
    expect(await first(DATE, rows)).toBe('2026-11-01');
  });

  it('英文的到期字样也不算', async () => {
    const rows = [
      'Guest folio',
      'Invoice date 2026-03-01',
      'Departure 2026-03-02',
      'Card exp 2030-01-31',
    ];
    const out = await ruleEngine({ fields: [DATE], pages: [pageOf(rows)], locale: 'en', now });
    expect(out.day?.[0]?.value).toBe('2026-03-02');
    expect(out.day?.map((s) => s.value)).not.toContain('2030-01-31');
  });

  it('分不清日月时不取两种读法里较晚的，按语言先给的读法', async () => {
    const rows = ['Guest folio', 'Departure 03/04/2026'];
    expect(await first(DATE, rows, 'en')).toBe('2026-03-04');
    expect(await first(DATE, rows, 'fr')).toBe('2026-04-03');
  });

  it('真的酒店账单还是取最晚的', async () => {
    const rows = ['Guest folio', 'Date 2026-03-01', 'Departure', 'Printed 2026-03-04'];
    expect(await first(DATE, rows)).toBe('2026-03-04');
  });
});

describe('大写金额要看那一排（第 4 条）', () => {
  it('实收、押金的大写不算', () => {
    expect(upperAmount(['合计 128', '实收大写 贰佰元整', '实收 200.00'])?.sure ?? false).toBe(
      false,
    );
    expect(upperAmount(['押金伍元整', '押金 5.00'])?.sure ?? false).toBe(false);
  });

  it('有合计类的那一个就取它', () => {
    expect(upperAmount(['服务费 壹拾元整 10.00', '价税合计 壹佰壹拾元整 110.00'])).toEqual({
      value: 110,
      sure: true,
    });
    expect(upperAmount(['服务费 壹拾元整 10.00 价税合计 壹佰壹拾元整 110.00'])).toEqual({
      value: 110,
      sure: true,
    });
  });

  it('没写标签的那一个还认；两个对不上的不认', () => {
    expect(upperAmount(['人民币 贰拾捌元玖角', '28.90'])).toEqual({ value: 28.9, sure: true });
    const two = upperAmount(['壹拾元整 10.00', '贰拾元整 20.00']);
    expect(two?.sure ?? false).toBe(false);
  });

  it('「合计（大写）」和大写金额折成两排时还认（SIBR）', () => {
    expect(upperAmount(['金额合计（大写）：', '收款： 肆拾肆元肆角伍分', '44.45'])).toEqual({
      value: 44.45,
      sure: true,
    });
    expect(upperAmount(['合计(大写)：', '现金 壹佰元整 ￥100.00'])).toEqual({
      value: 100,
      sure: true,
    });
  });

  it('表单第一个候选不是押金、实收的大写', async () => {
    expect(
      Number(await first(money('金额'), ['押金伍元整', '押金 5.00', '合计 88.00'], 'zh')),
    ).toBe(88);
  });

  it('零、繁体能解析', () => {
    expect(upperToNumber('贰拾捌元零伍分')).toBe(28.05);
    expect(upperToNumber('壹佰元零伍角')).toBe(100.5);
    expect(upperToNumber('貳拾元整')).toBe(20);
    expect(upperAmount(['合計 貳拾元整', '20.00'])).toEqual({ value: 20, sure: true });
  });
});

describe('值记忆要有边界（第 9 条）', () => {
  const remembered = (known: string[], rows: string[]) =>
    planDocument({
      fields: [MERCHANT],
      pages: [pageOf(rows)],
      locale: 'zh',
      now,
      known: { merchant: known },
    }).fields[0]!.remembered?.value;

  it('英文要整个词', () => {
    expect(remembered(['Apple'], ['PINEAPPLE JUICE BAR'])).toBeUndefined();
    expect(remembered(['Apple'], ['APPLE STORE KLCC'])).toBe('Apple');
    expect(remembered(['Acme Coffee'], ['ACMECOFFEE 12'])).toBe('Acme Coffee');
    expect(remembered(['Acme'], ['ACME2'])).toBeUndefined();
  });

  it('中文要整排或足够长', () => {
    expect(remembered(['中国'], ['中国银行'])).toBeUndefined();
    expect(remembered(['中国'], ['中国'])).toBe('中国');
    expect(remembered(['中国银行'], ['中国银行北京分行'])).toBe('中国银行');
  });

  it('不许跨排凑', () => {
    expect(remembered(['Apple Store'], ['Apple', 'Store'])).toBeUndefined();
    expect(remembered(['中国银行'], ['中国', '银行'])).toBeUndefined();
  });
});
