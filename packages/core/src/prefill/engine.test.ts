import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { modelEngine, ruleEngine, type FieldSuggestions } from './engine';
import { MODEL_LIMITS, type ModelRequest, type OpenModel } from './model';
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
// 公司字段规则有候选也会问模型（店名有候选就不问了，D-404），下面测模型流程都用它。
const ASKED: Field = { id: 'merchant', name: 'Company', type: 'text' };
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

/** 假的模型：按字段名回答；记下问过哪些、有没有释放。 */
function fakeModel(
  answers: Record<string, string>,
  extra: { failOpen?: boolean; hang?: boolean; hangOpen?: boolean } = {},
) {
  const asked: ModelRequest[] = [];
  const state = { released: 0, opened: 0 };
  const open: OpenModel = async () => {
    state.opened++;
    if (extra.failOpen) throw new Error('load failed');
    if (extra.hangOpen) await new Promise(() => undefined);
    return {
      generate: async (req) => {
        asked.push(req);
        if (extra.hang) await new Promise(() => undefined);
        const name = Object.keys(answers).find((n) => req.prompt.includes(`Field "${n}"`));
        return name ? answers[name]! : 'null';
      },
      release: async () => {
        state.released++;
      },
    };
  };
  return { open, asked, state };
}

describe('本机模型引擎（D-396、D-398）', () => {
  const rows = ['Bought at', 'Acme Coffee', 'Cafe Royal', 'Total 12.50'];
  const input = {
    fields: [ASKED, AMOUNT],
    pages: [pageOf(rows)],
    locale: 'en' as const,
    now,
  };

  it('先给规则的候选，模型的到了再补，模型的排在前面', async () => {
    const m = fakeModel({ Company: 'Cafe Royal | Acme Coffee' });
    const partial: FieldSuggestions[] = [];
    const out = await modelEngine(m.open)(input, undefined, (s) => partial.push(s));
    expect(partial.length).toBeGreaterThanOrEqual(1);
    // 第一次：模型还没开始问
    expect(partial[0]).toEqual(await ruleEngine(input));
    expect(values(out, 'merchant').slice(0, 2)).toEqual(['Cafe Royal', 'Acme Coffee']);
    expect(m.state.released).toBe(1);
  });

  it('模型编的值（文字里没有）丢掉', async () => {
    const m = fakeModel({ Company: 'Starbucks | Cafe Royal' });
    const out = await modelEngine(m.open)(input);
    expect(values(out, 'merchant')).not.toContain('Starbucks');
    expect(values(out, 'merchant')[0]).toBe('Cafe Royal');
  });

  it('代码有把握的字段不问模型，单选字段不问模型', async () => {
    const m = fakeModel({});
    const rowsSure = ['Coffee 12.00', 'Cake 8.00', 'Total 20.00', 'Cash 50.00', 'Change 30.00'];
    await modelEngine(m.open)({
      fields: [
        AMOUNT,
        { id: 'kind', name: 'Kind', type: 'choice', options: [{ id: 'a', label: 'Coffee' }] },
      ],
      pages: [pageOf(rowsSure)],
      locale: 'en',
      now,
    });
    expect(m.asked).toEqual([]);
    // 什么都不用问就不加载模型
    expect(m.state.opened).toBe(0);
  });

  it('备注这种自由填写的字段不问模型（D-394：不列地址、电话这类没用的候选）', async () => {
    const m = fakeModel({});
    await modelEngine(m.open)({
      fields: [
        { id: 'note', name: '备注', type: 'text' },
        { id: 'memo', name: 'Notes', type: 'note' },
        { id: 'who', name: 'Payer', type: 'text' },
      ],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
    });
    expect(m.asked.map((r) => /Field "([^"]+)"/.exec(r.prompt)![1])).toEqual(['Payer']);
  });

  it('有误导字样的排不进给模型的文字，合计排留着', async () => {
    const m = fakeModel({});
    await modelEngine(m.open)({
      fields: [ASKED],
      pages: [pageOf(['Acme', 'Tel: 012345', 'Discount 1.00', 'Total 5.00', 'Thank you'])],
      locale: 'en',
      now,
    });
    const prompt = m.asked[0]!.prompt;
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('Total 5.00');
    expect(prompt).not.toContain('Tel:');
    expect(prompt).not.toContain('Discount');
    expect(prompt).not.toContain('Thank you');
  });

  it('请求是逐字段的：温度 0、seed 42、最多 120 个 token、限制形状的语法、同一个前缀', async () => {
    const m = fakeModel({});
    await modelEngine(m.open)({
      fields: [ASKED, { id: 'who', name: 'Payer', type: 'text' }],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
    });
    expect(m.asked.length).toBe(2);
    expect(m.asked[0]).toMatchObject({ temperature: 0, seed: 42, nPredict: 120 });
    expect(m.asked[0]!.grammar).toContain('root ::= "null"');
    const cut = m.asked[0]!.prompt.indexOf('Field "');
    expect(m.asked[1]!.prompt.startsWith(m.asked[0]!.prompt.slice(0, cut))).toBe(true);
    // 关掉 thinking
    expect(m.asked[0]!.prompt.endsWith('<think>\n\n</think>\n\n')).toBe(true);
  });

  it('文字太长时截断，问题和前后两头都在', async () => {
    const m = fakeModel({});
    const long = Array.from({ length: 3000 }, (_, i) => `item number ${i}`);
    await modelEngine(m.open)({
      fields: [ASKED],
      pages: [pageOf(['Head Shop', ...long, 'Tail Row'])],
      locale: 'en',
      now,
    });
    const prompt = m.asked[0]!.prompt;
    expect(prompt.length).toBeLessThan(MODEL_LIMITS.textChars + 1500);
    expect(prompt).toContain('Head Shop');
    expect(prompt).toContain('Tail Row');
    expect(prompt).toContain('Field "Company"');
  });

  it.each([
    ['没装或内存不够（open 给 null）', async () => null],
    [
      '加载失败',
      async () => {
        throw new Error('no');
      },
    ],
  ] as [string, OpenModel][])('%s：安静退回只有规则', async (_name, open) => {
    await expect(modelEngine(open)(input)).resolves.toEqual(await ruleEngine(input));
  });

  it('生成失败：安静退回，已经有的留着，模型也释放', async () => {
    let released = 0;
    const open: OpenModel = async () => ({
      generate: async () => {
        throw new Error('boom');
      },
      release: async () => {
        released++;
      },
    });
    await expect(modelEngine(open)(input)).resolves.toEqual(await ruleEngine(input));
    expect(released).toBe(1);
  });

  it('取消：生成卡住时 Promise 也结束，模型释放', async () => {
    const m = fakeModel({}, { hang: true });
    const abort = new AbortController();
    const run = modelEngine(m.open)(input, abort.signal);
    await new Promise((r) => setTimeout(r, 5));
    expect(m.asked.length).toBe(1);
    abort.abort();
    await expect(run).resolves.toBeDefined();
    expect(m.state.released).toBe(1);
  });

  it('取消：加载卡住时 Promise 也结束', async () => {
    const m = fakeModel({}, { hangOpen: true });
    const abort = new AbortController();
    const run = modelEngine(m.open)(input, abort.signal);
    await new Promise((r) => setTimeout(r, 5));
    abort.abort();
    await expect(run).resolves.toBeDefined();
  });

  it('加载比取消晚回来：回来以后也释放', async () => {
    let finish: (() => void) | undefined;
    let released = 0;
    const open: OpenModel = () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            generate: async () => 'null',
            release: async () => {
              released++;
            },
          });
      });
    const abort = new AbortController();
    const run = modelEngine(open)(input, abort.signal);
    await new Promise((r) => setTimeout(r, 5));
    abort.abort();
    await run;
    finish!();
    await new Promise((r) => setTimeout(r, 5));
    expect(released).toBe(1);
  });

  it('超时：一个字段卡住，退回规则，不再问别的字段', async () => {
    const m = fakeModel({}, { hang: true });
    const out = await modelEngine(m.open, { ...MODEL_LIMITS, callMs: 10 })(input);
    expect(out).toEqual(await ruleEngine(input));
    expect(m.asked.length).toBe(1);
    expect(m.state.released).toBe(1);
  });
});

describe('什么时候问模型（D-404）', () => {
  const asked = (m: ReturnType<typeof fakeModel>) => m.asked.map((r) => r.prompt).join('\n');

  it('店名规则有候选时不问模型，候选也不被模型换掉', async () => {
    const m = fakeModel({ Merchant: 'Cafe Royal' });
    const rows = ['Acme Coffee', 'Cafe Royal', 'Total 12.00'];
    const out = await modelEngine(m.open)({
      fields: [MERCHANT],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
    });
    expect(values(out, 'merchant')[0]).toBe('Acme Coffee');
    expect(asked(m)).not.toContain('Field "Merchant"');
  });

  it('店名规则一个候选都没有时才问模型', async () => {
    const m = fakeModel({ Merchant: 'Cafe Royal' });
    const rows = ['12:49 PM', '0141', '***', 'Coffee 12.00', 'Cafe Royal', 'Total 12.00'];
    const out = await modelEngine(m.open)({
      fields: [MERCHANT],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
    });
    expect(asked(m)).toContain('Field "Merchant"');
    expect(values(out, 'merchant')).toContain('Cafe Royal');
  });

  it('合计分数够高（≥3.5）且比第二名高 1 分时不问模型', async () => {
    const m = fakeModel({ Amount: '9.00' });
    const rows = ['Shop', 'Total: 12.00', 'Coffee 9.00'];
    const input = { fields: [AMOUNT], pages: [pageOf(rows)], locale: 'en' as const, now };
    const top = (await ruleEngine(input)).total ?? [];
    expect(top[0]?.score).toBeGreaterThanOrEqual(3.5);
    expect(top[0]!.score - (top[1]?.score ?? 0)).toBeGreaterThanOrEqual(1);
    const out = await modelEngine(m.open)(input);
    expect(asked(m)).not.toContain('Field "Amount"');
    expect(values(out, 'total')[0]).toBe('12.00');
  });

  it('中文单据的合计：问了模型也让规则排在前面', async () => {
    const m = fakeModel({ 金额: '10.00' });
    const field: Field = { id: 'total', name: '金额', type: 'money', currency: 'CNY' };
    const rows = ['上海小店', '咖啡 90.00', '蛋糕 10.00'];
    const input = { fields: [field], pages: [pageOf(rows)], locale: 'zh' as const, now };
    const ruleTop = (await ruleEngine(input)).total?.[0]?.value;
    const out = await modelEngine(m.open)(input);
    expect(asked(m)).toContain('Field "金额"');
    expect(ruleTop).toBe('90.00');
    expect(values(out, 'total')[0]).toBe(ruleTop);
    expect(values(out, 'total')).toContain('10.00');
  });

  it('其他语言的合计：问了模型仍然模型排前面', async () => {
    const m = fakeModel({ Amount: '9.00' });
    const rows = ['Shop', 'Coffee 9.00', 'Cake 3.00'];
    const out = await modelEngine(m.open)({
      fields: [AMOUNT],
      pages: [pageOf(rows)],
      locale: 'en',
      now,
    });
    expect(asked(m)).toContain('Field "Amount"');
    expect(values(out, 'total')[0]).toBe('9.00');
  });
});

describe('二维码的值（D-423）', () => {
  const CARD_FIELDS: Field[] = [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'job', name: 'Job title', type: 'text' },
    { id: 'company', name: 'Company', type: 'text' },
    { id: 'tel', name: 'Phone', type: 'text', format: 'phone' },
    { id: 'mail', name: 'Email', type: 'text', format: 'email' },
    { id: 'site', name: 'Website', type: 'text', format: 'url' },
  ];
  const VCARD =
    'BEGIN:VCARD\nFN:Maria Garcia\nTITLE:CTO\nORG:Acme\nTEL:+33 6 12 34 56 78\nEMAIL:m@acme.example\nURL:https://acme.example\nEND:VCARD';
  const input = (codes: string[], rows: string[] = []) => ({
    fields: CARD_FIELDS,
    rules: 'card' as const,
    pages: rows.length > 0 ? [pageOf(rows)] : [],
    locale: 'en' as const,
    now,
    codes,
  });
  const values = (s: FieldSuggestions) =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.map((x) => x.value)]));

  it('a picture with only a QR code still gives candidates', async () => {
    expect(values(await ruleEngine(input([VCARD])))).toEqual({
      name: ['Maria Garcia'],
      job: ['CTO'],
      company: ['Acme'],
      tel: ['+33 6 12 34 56 78'],
      mail: ['m@acme.example'],
      site: ['https://acme.example'],
    });
  });

  it('come before what the text gives, without a position to remember', async () => {
    const s = await ruleEngine(
      input([VCARD], ['Jean Dupont', 'Tel +33 1 11 11 11 11', 'other@acme.example']),
    );
    expect(s.tel![0]!.value).toBe('+33 6 12 34 56 78');
    expect(s.tel!.map((x) => x.value)).toContain('+33 1 11 11 11 11');
    expect(s.mail![0]!.value).toBe('m@acme.example');
    expect(s.mail!.map((x) => x.value)).toContain('other@acme.example');
    expect(s.name![0]!.value).toBe('Maria Garcia');
    expect(s.name![0]!.pick).toBeUndefined();
  });

  it('a web address only suggests the website', async () => {
    expect(values(await ruleEngine(input(['https://acme.example/me'])))).toEqual({
      site: ['https://acme.example/me'],
    });
  });

  it('anything else is ignored and the text is read as usual', async () => {
    const plain = await ruleEngine(input([], ['Tel +33 1 11 11 11 11']));
    const coded = await ruleEngine(input(['WIFI:T:WPA;S:x;;', 'hello'], ['Tel +33 1 11 11 11 11']));
    expect(coded).toEqual(plain);
    expect(await ruleEngine(input(['hello']))).toEqual({});
  });

  it('only on a card table', async () => {
    const s = await ruleEngine({ ...input([VCARD]), rules: 'receipt' });
    expect(s).toEqual({});
    const { rules: _unused, ...plain } = input([VCARD]);
    expect(await ruleEngine(plain)).toEqual({});
  });

  it('the model does not load for a picture with no text', async () => {
    let opened = 0;
    const open: OpenModel = async () => {
      opened++;
      return null;
    };
    const s = await modelEngine(open)(input(['https://acme.example']));
    expect(opened).toBe(0);
    expect(values(s)).toEqual({ site: ['https://acme.example'] });
  });

  it('a field with a code value is not asked of the model; other fields are, without the code', async () => {
    const asked: ModelRequest[] = [];
    const open: OpenModel = async () => ({
      generate: async (r) => {
        asked.push(r);
        return '';
      },
      release: async () => undefined,
    });
    await modelEngine(open)(input(['https://acme.example/SECRET'], ['Some text on the card']));
    expect(asked.length).toBeGreaterThan(0);
    expect(JSON.stringify(asked)).not.toContain('SECRET');
  });
});
