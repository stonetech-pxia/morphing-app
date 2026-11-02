import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { ruleEngine, type FieldSuggestions } from './engine';
import { suggestValues } from './rank';

const fields: Field[] = [
  { id: 'total', name: 'Amount', type: 'money', currency: 'USD' },
  { id: 'day', name: 'Date', type: 'date' },
];
const pages = [
  {
    width: 600,
    height: 200,
    lines: [
      { text: 'Date 2026-10-20', x: 20, y: 20, width: 150, height: 20 },
      { text: 'Total 178.23', x: 20, y: 60, width: 120, height: 20 },
    ],
  },
];
/** 每行一排的页面（测试规则时位置不重要）。 */
const pageOf = (rows: string[]) => ({
  width: 600,
  height: 40 + rows.length * 30,
  lines: rows.map((text, i) => ({ text, x: 20, y: 20 + i * 30, width: 500, height: 24 })),
});
const now = new Date('2026-11-01T00:00:00Z');
const AMOUNT: Field = { id: 'total', name: 'Amount', type: 'money', currency: 'USD' };
const DATE: Field = { id: 'day', name: 'Date', type: 'date' };
const NUMBER: Field = { id: 'no', name: 'Number', type: 'text' };
const MERCHANT: Field = { id: 'merchant', name: 'Merchant', type: 'text' };
const values = (out: FieldSuggestions, id: string) => (out[id] ?? []).map((s) => s.value);

describe('规则引擎（D-398）', () => {
  it('只有规则打分时结果和规则打分一样，按字段给带分数和记忆的候选', async () => {
    const input = { fields, pages, locale: 'en' as const, now };
    const out = await ruleEngine(input);
    expect(out).toEqual(suggestValues(input));
    expect(out.total?.[0]).toMatchObject({ value: '178.23', pick: { label: 'Total' } });
    expect(out.day?.[0]?.value).toBe('2026-10-20');
  });

  it('付款 − 找零算出的总额排第一个（规则打分排在别的数上面时也是）', async () => {
    const rows = [
      'Coffee 12.00',
      'Cake 8.00',
      'Total Qty 20.00',
      'Amount 19.00',
      'Cash 20.00',
      'Change 1.00',
    ];
    const out = await ruleEngine({
      fields: [AMOUNT],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
    });
    expect(Number(out.total?.[0]?.value)).toBe(19);
  });

  it('大写金额，小写也在文字里时排第一个', async () => {
    const rows = [
      '挂号费 3.00',
      '合计（大写）贰拾捌元玖角',
      '检查费 25.90',
      '合计 28.90',
      '业务 1.00',
    ];
    const out = await ruleEngine({
      fields: [{ id: 'total', name: '金额', type: 'money', currency: 'CNY' }],
      pages: [pageOf(rows)],
      locale: 'zh',
      now,
    });
    expect(Number(out.total?.[0]?.value)).toBe(28.9);
  });

  it('有效期那排的日期不算日期候选', async () => {
    const rows = ['本票据使用至 2021年12月31日', '收费日期 2020年03月05日'];
    const out = await ruleEngine({
      fields: [DATE],
      pages: [pageOf(rows)],
      locale: 'zh',
      now: new Date('2020-06-01T00:00:00Z'),
    });
    expect(values(out, 'day')).toEqual(['2020-03-05']);
  });

  it('酒店账单有离店字样时，全文最晚的日期排第一个', async () => {
    const rows = [
      '房号 1208 房价 300',
      '入住日期 2020-03-01',
      '离店日期 打印 2020-03-02',
      '2020-03-04',
    ];
    const out = await ruleEngine({
      fields: [DATE],
      pages: [pageOf(rows)],
      locale: 'zh',
      now: new Date('2020-06-01T00:00:00Z'),
    });
    expect(out.day?.[0]?.value).toBe('2020-03-04');
  });

  it('单号按键名排优先级、去 NO 前缀，流水号那排不要', async () => {
    const rows = ['业务流水号 77001234', '票据号 NO8039067169'];
    const out = await ruleEngine({
      fields: [NUMBER],
      pages: [pageOf(rows)],
      locale: 'zh',
      now,
    });
    expect(out.no?.[0]?.value).toBe('8039067169');
    expect(values(out, 'no')).not.toContain('77001234');
  });

  it('这张表存过的店名原样出现在文字里时排第一个，最长的优先', async () => {
    const rows = ['Receipt', 'welcome to', 'BOOK TA K TAMAN DAYA SDN BHD', 'Total 5.00'];
    const out = await ruleEngine({
      fields: [MERCHANT],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
      known: { merchant: ['BOOK', 'book ta k taman daya sdn bhd', 'NOT THERE LTD'] },
    });
    expect(out.merchant?.[0]?.value).toBe('book ta k taman daya sdn bhd');
    expect(values(out, 'merchant')).not.toContain('NOT THERE LTD');
    expect(values(out, 'merchant')).not.toContain('BOOK');
  });

  it('每个字段最多 3 个候选', async () => {
    const rows = ['Total 1.00', 'Total 2.00', 'Total 3.00', 'Total 4.00', 'Total 5.00'];
    const out = await ruleEngine({ fields: [AMOUNT], pages: [pageOf(rows)], locale: 'en', now });
    expect(out.total!.length).toBeLessThanOrEqual(3);
  });
});
