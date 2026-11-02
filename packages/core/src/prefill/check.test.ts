import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { amountChain } from './amount-chain';
import { knownValues, planDocument } from './code-rules';
import { invoiceNoByKey, stripNoPrefix, upperAmount, upperToNumber } from './zh-rules';

const AMOUNT: Field = { id: 'amount', name: 'Amount', type: 'money', currency: 'MYR' };
const MERCHANT: Field = { id: 'merchant', name: 'Merchant', type: 'text' };

describe('算术找总额', () => {
  it('付款 − 找零', () => {
    expect(amountChain(['A 3.00', 'Sum 19.00', 'Cash 20.00', 'Change 1.00'], false, 'en')).toEqual({
      value: 19,
      how: 'payMinusChange',
    });
  });

  it('小计 − 优惠 = 总额；减的那排没写优惠时取大的（含税总额 − 不含税 = 税额）', () => {
    const rows = ['A 6.00', 'B 4.00', 'Subtotal 10.00'];
    expect(amountChain([...rows, 'Discount 1.00', 'Net 9.00'], false, 'en')).toEqual({
      value: 9,
      how: 'subtotalAdjust',
    });
    expect(amountChain([...rows, 'Excl 9.00', 'Tax 1.00'], false, 'en')?.value).toBe(10);
  });

  it('小计 + 税', () => {
    expect(
      amountChain(['A 6.00', 'B 4.00', 'Subtotal 10.00', 'Tax 1.00', 'Total 11.00'], false, 'en'),
    ).toEqual({ value: 11, how: 'subtotalAdjust' });
  });

  it('小计本身；算不出来是 null', () => {
    expect(amountChain(['A 6.00', 'B 4.00', 'Total 10.00'], false, 'en')).toEqual({
      value: 10,
      how: 'subtotal',
    });
    expect(amountChain(['Hello', 'A 6.00'], false, 'en')).toBeNull();
  });

  it('没有小数的币种：千位分隔读成整数，差 1 算相等', () => {
    expect(amountChain(['A 6.000', 'B 4.000', 'Total 10.001'], true, 'en')?.value).toBe(10001);
  });

  it('数太多的单据不算（不让手机卡住）', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `Item ${i} ${i + 1}.00`);
    expect(amountChain(rows, false, 'en')).toBeNull();
  });
});

describe('中文规则', () => {
  it('大写金额', () => {
    expect(upperToNumber('贰拾捌元玖角')).toBe(28.9);
    expect(upperToNumber('壹拾元整')).toBe(10);
    expect(upperToNumber('壹万贰仟叁佰元伍角陆分')).toBe(12300.56);
    expect(upperToNumber('今天元')).toBeNull();
  });

  it('带小数的小写也在文字里才算有把握；整数碰巧撞上不算', () => {
    expect(upperAmount(['合计 贰 拾捌元 玖角', '28.90'])).toEqual({ value: 28.9, sure: true });
    expect(upperAmount(['合计 壹拾元整', '10'])).toEqual({ value: 10, sure: false });
    expect(upperAmount(['合计 12.50'])).toBeNull();
  });

  it('单号按键名优先级', () => {
    expect(invoiceNoByKey(['NO 11112222', '票据号 NO33334444'])).toBe('33334444');
    expect(invoiceNoByKey(['合计 28.90'])).toBeNull();
    expect(stripNoPrefix('N4510498')).toBe('4510498');
    expect(stripNoPrefix('NORTH1')).toBe('NORTH1');
  });
});

describe('值记忆（底线 14：现查，不另存）', () => {
  const fields: Field[] = [MERCHANT, AMOUNT, { id: 'co', name: 'Company', type: 'text' }];

  it('只取店名、公司字段，去重', () => {
    expect(
      knownValues(fields, [
        { values: { merchant: 'Acme', amount: '5', co: 'Beta Ltd' } },
        { values: { merchant: 'Acme', amount: '5' } },
        { values: { merchant: '  ' } },
      ]),
    ).toEqual({ merchant: ['Acme'], co: ['Beta Ltd'] });
  });

  it('文字里没有的不给，一排里的空格多少不算，跨排不算', () => {
    const page = {
      width: 100,
      height: 100,
      lines: [
        { text: 'BOOK TA K', x: 0, y: 0, width: 50, height: 10 },
        { text: 'SDN BHD', x: 0, y: 20, width: 50, height: 10 },
      ],
    };
    const plan = (known: string[]) =>
      planDocument({ fields: [MERCHANT], pages: [page], locale: 'en', known: { merchant: known } })
        .fields[0]!.remembered?.value;
    expect(plan(['book ta k sdn bhd', 'other'])).toBeUndefined();
    expect(plan(['book tak', 'other'])).toBe('book tak');
  });
});
