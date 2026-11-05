import { describe, expect, it } from 'vitest';

import { presetAnswer, presetMatchRequest, rankPresets, recommendPreset } from './preset-match';
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
