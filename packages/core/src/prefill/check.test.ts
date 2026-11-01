import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { amountChain } from './amount-chain';
import { checkAnswer, keepForModel } from './check';
import { knownValues, planDocument } from './code-rules';
import { modelAnswers } from './model';
import { invoiceNoByKey, stripNoPrefix, upperAmount, upperToNumber } from './zh-rules';

const AMOUNT: Field = { id: 'amount', name: 'Amount', type: 'money', currency: 'MYR' };
const IDR: Field = { id: 'amount', name: 'Amount', type: 'money', currency: 'IDR' };
const TAX: Field = { id: 'tax', name: 'Tax', type: 'money', currency: 'USD' };
const DATE: Field = { id: 'date', name: 'Date', type: 'date' };
const DUE: Field = { id: 'due', name: 'Due date', type: 'date' };
const MERCHANT: Field = { id: 'merchant', name: 'Merchant', type: 'text' };
const NUMBER: Field = { id: 'no', name: 'Number', type: 'text' };
const EMAIL: Field = { id: 'mail', name: 'Email', type: 'text' };

describe('核对模型的回答（D-396）', () => {
  it('文字里没有的值丢掉', () => {
    expect(checkAnswer(MERCHANT, 'Starbucks', ['Acme Coffee'], 'en')).toBeNull();
    expect(checkAnswer(AMOUNT, '99.00', ['Total 12.50'], 'en')).toBeNull();
    expect(checkAnswer(DATE, '2026-01-02', ['Total 12.50'], 'en')).toBeNull();
  });

  it('null、空回答丢掉', () => {
    expect(checkAnswer(MERCHANT, 'null', ['null'], 'en')).toBeNull();
    expect(checkAnswer(MERCHANT, '  ', ['x'], 'en')).toBeNull();
  });

  it('付款、找零那一排的数不是金额；有合计排时金额要在合计排；金额不能是 0', () => {
    const rows = ['Total 12.50', 'Cash 20.00', 'Change 7.50'];
    expect(checkAnswer(AMOUNT, '20.00', rows, 'en')).toBeNull();
    expect(checkAnswer(AMOUNT, '12.50', rows, 'en')).toBe('12.5');
    expect(checkAnswer(AMOUNT, '5.00', ['Coffee 5.00', 'Total 12.50'], 'en')).toBeNull();
    expect(checkAnswer(AMOUNT, '0.00', ['Rounding 0.00'], 'en')).toBeNull();
  });

  it('税要在有税字样的那一排', () => {
    expect(checkAnswer(TAX, '1.20', ['Coffee 1.20'], 'en')).toBeNull();
    expect(checkAnswer(TAX, '1.20', ['GST 6% 1.20'], 'en')).toBe('1.2');
  });

  it('印尼盾的 .00 不是小数', () => {
    expect(checkAnswer(IDR, '31.000,00', ['Total 31.000,00'], 'en')).toBe('31000');
  });

  it('有效期那排的日期不是单据日期，但可以是到期日', () => {
    const rows = ['本票据使用至 2021-12-31'];
    expect(checkAnswer(DATE, '2021-12-31', rows, 'zh')).toBeNull();
    expect(checkAnswer(DUE, '2021-12-31', rows, 'zh')).toBe('2021-12-31');
  });

  it('日期按另一种日月读法也算读得出', () => {
    expect(checkAnswer(DATE, '2026-03-04', ['Date 04/03/2026'], 'en')).toBe('2026-03-04');
    expect(checkAnswer(DATE, '2026-04-03', ['Date 04/03/2026'], 'en')).toBe('2026-04-03');
  });

  it('单号：流水号那排不要，像金额或商品的不要，地址不要，NO 前缀去掉', () => {
    expect(checkAnswer(NUMBER, '77001234', ['业务流水号 77001234'], 'zh')).toBeNull();
    expect(checkAnswer(NUMBER, '1,234.50', ['No 1,234.50'], 'en')).toBeNull();
    expect(checkAnswer(NUMBER, '12号', ['No 12号'], 'zh')).toBeNull();
    expect(checkAnswer(NUMBER, 'NO8039067', ['票据号 NO8039067'], 'zh')).toBe('8039067');
  });

  it('半截店名补全成整排；别的标签那一排、地址、标签本身都不要', () => {
    expect(checkAnswer(MERCHANT, 'Acme', ['Acme Coffee Bar'], 'en')).toBe('Acme Coffee Bar');
    expect(checkAnswer(MERCHANT, 'Sam', ['Cashier: Sam'], 'en')).toBeNull();
    expect(checkAnswer(MERCHANT, 'Jalan Besar', ['Jalan Besar'], 'en')).toBeNull();
    expect(checkAnswer(MERCHANT, 'Merchant', ['Merchant'], 'en')).toBeNull();
  });

  it('邮箱要有 @', () => {
    expect(checkAnswer(EMAIL, 'acme.com', ['acme.com'], 'en')).toBeNull();
    expect(checkAnswer(EMAIL, 'a@acme.com', ['a@acme.com'], 'en')).toBe('a@acme.com');
  });

  it('一次回答里的几个候选分别核对，去重，最多 3 个', () => {
    const rows = ['Acme', 'Beta', 'Gamma', 'Delta'];
    expect(modelAnswers(MERCHANT, 'Acme | Fake | Acme | Beta', rows, 'en')).toEqual([
      'Acme',
      'Beta',
    ]);
    expect(modelAnswers(MERCHANT, 'Acme | Beta | Gamma | Delta', rows, 'en').length).toBe(3);
  });

  it('误导排不给模型看，有合计字样的排留着', () => {
    expect(keepForModel('Tel: 012345')).toBe(false);
    expect(keepForModel('Thank you')).toBe(false);
    expect(keepForModel('现金 50.00')).toBe(false);
    expect(keepForModel('Total Cash 50.00')).toBe(true);
    expect(keepForModel('Acme Coffee')).toBe(true);
  });
});

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

  it('文字里没有的不给，跨排也算原样', () => {
    const page = {
      width: 100,
      height: 100,
      lines: [
        { text: 'BOOK TA K', x: 0, y: 0, width: 50, height: 10 },
        { text: 'SDN BHD', x: 0, y: 20, width: 50, height: 10 },
      ],
    };
    const known = { merchant: ['book ta k sdn bhd', 'other'] };
    const plan = planDocument({ fields: [MERCHANT], pages: [page], locale: 'en', known });
    expect(plan.fields[0]!.remembered?.value).toBe('book ta k sdn bhd');
  });
});
