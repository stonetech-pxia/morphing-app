import { describe, expect, it } from 'vitest';

import { settleBill, settlementText, type BillPerson } from './split-bill';

// AA 分摊（D-259）：完全在本机算，按分计算，不用 AI。

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** 照着转账以后，每个人实际花的钱（分）。 */
function spent(people: BillPerson[], s: ReturnType<typeof settleBill>) {
  return people.map((p) => {
    const paid = Math.round(p.paid * 100);
    const out = sum(s.transfers.filter((t) => t.from === p.name).map((t) => t.cents));
    const back = sum(s.transfers.filter((t) => t.to === p.name).map((t) => t.cents));
    return paid + out - back;
  });
}

describe('settleBill', () => {
  it('one person paid everything: the others each pay their share to that person', () => {
    const people = [
      { name: '小王', paid: 90 },
      { name: '小李', paid: 0 },
      { name: '小张', paid: 0 },
    ];
    const s = settleBill(people);
    expect(s).toMatchObject({ totalCents: 9000, shareCents: 3000, extra: [] });
    expect(s.transfers).toEqual([
      { from: '小李', to: '小王', cents: 3000 },
      { from: '小张', to: '小王', cents: 3000 },
    ]);
  });

  it('nobody pays anything when everyone paid the same', () => {
    const s = settleBill([
      { name: 'A', paid: 20 },
      { name: 'B', paid: 20 },
    ]);
    expect(s.transfers).toEqual([]);
  });

  it('a remainder that does not divide is paid by named people, one cent each', () => {
    const people = [
      { name: 'A', paid: 100 },
      { name: 'B', paid: 0 },
      { name: 'C', paid: 0 },
    ];
    const s = settleBill(people);
    expect(s.shareCents).toBe(3333);
    expect(s.extra).toEqual(['A']);
    expect(spent(people, s)).toEqual([3334, 3333, 3333]);
  });

  it('pairs exact amounts first, so fewer transfers are needed', () => {
    // 每人 30：A 多付 30，B 多付 10；C 少付 10，D 少付 30。两笔就够，不是三笔。
    const s = settleBill([
      { name: 'A', paid: 60 },
      { name: 'B', paid: 40 },
      { name: 'C', paid: 20 },
      { name: 'D', paid: 0 },
    ]);
    expect(s.transfers).toHaveLength(2);
    expect(s.transfers).toEqual(
      expect.arrayContaining([
        { from: 'D', to: 'A', cents: 3000 },
        { from: 'C', to: 'B', cents: 1000 },
      ]),
    );
  });

  it('everyone ends up spending their share, with at most n - 1 transfers (random cases)', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 200; k++) {
      const n = 2 + Math.floor(rand() * 7);
      const people = Array.from({ length: n }, (_, i) => ({
        name: `P${i}`,
        paid: Math.round(rand() * 50000) / 100,
      }));
      const s = settleBill(people);
      const each = spent(people, s);
      expect(sum(each)).toBe(s.totalCents);
      for (const [i, cents] of each.entries()) {
        expect(cents).toBe(s.shareCents + (s.extra.includes(people[i]!.name) ? 1 : 0));
      }
      expect(s.transfers.length).toBeLessThanOrEqual(n - 1);
      for (const t of s.transfers) expect(t.cents).toBeGreaterThan(0);
    }
  });
});

describe('settlementText', () => {
  const s = settleBill([
    { name: 'A', paid: 100 },
    { name: 'B', paid: 0 },
    { name: 'C', paid: 0 },
  ]);
  it('lists who pays whom, with two decimals, in each language', () => {
    expect(settlementText(s, 'zh')).toBe(
      '合计 100.00，3 人，每人 33.33\n除不尽的 0.01 由 A 多付\nB → A：33.33\nC → A：33.33',
    );
    expect(settlementText(s, 'en')).toBe(
      'Total 100.00, 3 people, 33.33 each\nThe 0.01 left over is paid by A\nB → A: 33.33\nC → A: 33.33',
    );
    expect(settlementText(s, 'fr')).toBe(
      'Total 100,00, 3 personnes, 33,33 chacun\nLe reste de 0,01 est payé par A\nB → A : 33,33\nC → A : 33,33',
    );
  });
  it('says when nobody needs to pay, and uses singular forms', () => {
    const even = settleBill([
      { name: 'A', paid: 10 },
      { name: 'B', paid: 10 },
    ]);
    expect(settlementText(even, 'en')).toMatch(/Everyone paid the same/);
    const two = settleBill([
      { name: 'A', paid: 1 },
      { name: 'B', paid: 0 },
      { name: 'C', paid: 0 },
      { name: 'D', paid: 0 },
      { name: 'E', paid: 0.02 },
    ]);
    // 102 分 ÷ 5 = 20 余 2：两个人各多付 1 分。
    expect(two.extra).toEqual(['A', 'B']);
    expect(settlementText(two, 'en')).toContain('The 0.02 left over is paid by A, B (0.01 each)');
  });
});
