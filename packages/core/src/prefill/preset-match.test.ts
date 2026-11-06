import { describe, expect, it } from 'vitest';

import {
  presetAnswer,
  presetMatchRequest,
  rankPresets,
  recommendPreset,
  rulePreset,
} from './preset-match';
import type { TextPage } from './rows';

const doc = (...rows: string[]): TextPage[] => [
  {
    width: 800,
    height: 1100,
    lines: rows.map((text, i) => ({ text, x: 40, y: 40 + i * 30, width: 400, height: 16 })),
  },
];

describe('rankPresets', () => {
  it('没有金额：要金额的预设排到后面，不隐藏', () => {
    const r = rankPresets(doc('Vaccination record', 'Name: Ana', 'Dose 1: 3 March 2025'));
    expect(r.unlikely).toEqual(expect.arrayContaining(['purchase', 'bill', 'payslip']));
    expect(r.likely).toContain('vaccination');
    expect(r.likely).not.toContain('purchase');
    expect([...r.likely, ...r.unlikely]).toHaveLength(21);
  });
  it('有金额：都留着', () => {
    expect(rankPresets(doc('Total 48.60 €')).unlikely).toEqual([]);
    expect(rankPresets(doc('合计 2380.00元')).unlikely).toEqual([]);
  });
  it('护照机读码排最前', () => {
    expect(rankPresets(doc('P<GBRSMITH<<ANNA<MARIE<<<<<<<<')).likely[0]).toBe('identity');
  });
  it('没有文字时什么都不排后', () => {
    expect(rankPresets([]).unlikely).toEqual([]);
  });
});

describe('rankPresets 的 folded（有金额时账单、贷款、报销、税务并进购物凭证，D-475）', () => {
  it('有金额：这四种不给模型选，列表里还在', () => {
    const r = rankPresets(doc('Total 48.60 €'));
    expect(r.folded).toEqual(['bill', 'loan', 'reimbursement', 'tax']);
    expect(r.likely).toEqual(expect.arrayContaining(['bill', 'purchase', 'bank', 'payslip']));
  });
  it('没有金额时没有 folded', () => {
    expect(rankPresets(doc('Dose 1: 3 March 2025')).folded).toEqual([]);
  });
});

describe('presetMatchRequest / presetAnswer', () => {
  it('目录只有给的预设，语法只能答它们或 none', () => {
    const q = presetMatchRequest(doc('Hello'), ['bill', 'tax']);
    expect(q.prompt).toContain('bill: ');
    expect(q.prompt).not.toContain('payslip:');
    expect(q.grammar).toBe('root ::= "bill" | "tax" | "none"\n');
  });
  it('none 和不在目录里的是 null', () => {
    expect(presetAnswer('bill', ['bill'])).toBe('bill');
    expect(presetAnswer('none', ['bill'])).toBeNull();
    expect(presetAnswer('tax', ['bill'])).toBeNull();
  });
});

describe('recommendPreset 的目录', () => {
  it('有金额：目录里没有账单、贷款、报销、税务，购物凭证的说明包括它们', async () => {
    const prompts: string[] = [];
    const open = async () => ({
      generate: async (r: { prompt: string }) => {
        prompts.push(r.prompt);
        return 'purchase';
      },
      release: async () => undefined,
    });
    const got = await recommendPreset(open, doc('Invoice 7', 'Total 48.60 €'));
    expect(got).toBe('purchase');
    expect(prompts[0]).toContain('purchase: ');
    for (const id of ['bill', 'loan', 'reimbursement', 'tax']) {
      expect(prompts[0]).not.toContain(`\n${id}: `);
    }
    expect(prompts[0]).toMatch(/purchase: [^\n]*invoice/);
  });
});

describe('recommendPreset', () => {
  const session = (answer: string, released: string[]) => ({
    generate: async () => answer,
    release: async () => {
      released.push('released');
    },
  });
  it('答对就推荐，用完释放', async () => {
    const released: string[] = [];
    const got = await recommendPreset(async () => session('insurance', released), doc('Policy'));
    expect(got).toBe('insurance');
    await Promise.resolve();
    expect(released).toEqual(['released']);
  });
  it('没装模型、加载失败、没有文字：都是 null', async () => {
    expect(await recommendPreset(async () => null, doc('Policy'))).toBeNull();
    expect(
      await recommendPreset(async () => {
        throw new Error('boom');
      }, doc('Policy')),
    ).toBeNull();
    let opened = false;
    await recommendPreset(async () => {
      opened = true;
      return null;
    }, []);
    expect(opened).toBe(false);
  });
});

describe('rulePreset（没有本机模型时，很明显的小票也要推荐购物凭证）', () => {
  it('英文小票', () => {
    expect(
      rulePreset(
        doc(
          'CORNER MARKET',
          'Milk 2.49',
          'Bread 3.10',
          'Subtotal 5.59',
          'Tax 0.45',
          'Total 6.04',
          'Cash 10.00',
          'Change 3.96',
        ),
      ),
    ).toBe('purchase');
  });
  it('法文小票', () => {
    expect(
      rulePreset(
        doc(
          'BOULANGERIE',
          'Pain 1,20',
          'Croissant 1,10',
          'TVA 0,13',
          'Total TTC 2,30 €',
          'Carte bancaire',
        ),
      ),
    ).toBe('purchase');
  });
  it('Lidl 小票（识别带错字）', () => {
    expect(
      rulePreset(
        doc(
          'LIDL',
          'Place Salvador Allendé',
          'FR93170BAGNOLET',
          'Ticket de vente',
          'Article P.U.EUR Qté EUR',
          'Oeufs sol x12 2,76 1 2,76 A T',
          'Pizza jambon fromage 2,29 1 2,29 A T',
          'Nombre de lignes: 5',
          'A payer 14,60',
          '13,84 HT',
          'Fotal éligible TR (T) : 14,60',
          ':arte 14,60',
          'VA Taux MONT.TTC MONT.TVA TOTAL HT',
          'A 5,5% 14,60 0,76 13,84',
        ),
      ),
    ).toBe('purchase');
  });
  it('中文小票', () => {
    expect(
      rulePreset(doc('永辉超市小票', '牛奶 12.50', '面包 8.00', '合计 20.50', '微信支付 20.50')),
    ).toBe('purchase');
  });
  it('有合计金额的账单、贷款、税务、报销也用购物凭证（D-475）', () => {
    expect(
      rulePreset(doc('Invoice 2025-03', 'Due date 1 April', 'Amount due 120.00 €', 'VAT 20.00')),
    ).toBe('purchase');
    expect(rulePreset(doc('Avis d’impôt', 'Montant à payer 1 240,00 €'))).toBe('purchase');
    expect(rulePreset(doc('Expense claim', 'Taxi 18.50', 'Hotel 120.00', 'Total 138.50'))).toBe(
      'purchase',
    );
  });
  it('银行（IBAN）和工资单不归购物凭证', () => {
    expect(
      rulePreset(doc('Invoice 2025-03', 'Amount due 120.00 €', 'IBAN FR7612345678901234567890123')),
    ).toBeNull();
    expect(
      rulePreset(doc('Payslip March', 'Gross 3000.00', 'Net pay 2300.00', 'Total 2300.00')),
    ).toBeNull();
  });
  it('没有金额、没有文字、合同都不推荐', () => {
    expect(
      rulePreset(
        doc(
          'Invoice 2025-03',
          'Due date 1 April',
          'Amount due 120.00 €',
          'IBAN FR7612345678901234567890123',
        ),
      ),
    ).toBeNull();
    expect(rulePreset(doc('Vaccination record', 'Dose 1: 3 March 2025'))).toBeNull();
    expect(rulePreset([])).toBeNull();
  });
});
