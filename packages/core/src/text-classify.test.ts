import { describe, expect, it, vi } from 'vitest';

import {
  cosine,
  guessFacets,
  pickLabel,
  rankLabels,
  textReadability,
  type LabelVector,
} from './text-classify';

// 识别结果照着手机上的样子写：换行、两栏挤成一行、金额和单号、识别错的字。
const RECEIPT_ZH = `禾田便利店
矿泉水 2.50
饭团 6.80
实付：9.30元 微信支付
2026-03-14 18:22`;

const INVOICE_EN = `Bright Fiber Internet
Account 0047-2291
Amount due $54.99 by 04/02/2026`;

const FACTURE_FR = `Plomberie Duval
Facture N° F2026-118
Remplacement robinet 85,00 €
Total TTC : 102,00 €`;

describe('textReadability', () => {
  it('calls text with no letters, digits or Chinese characters blank', () => {
    expect(textReadability('')).toBe('blank');
    expect(textReadability('   \n  ')).toBe('blank');
    expect(textReadability(' . \n — ')).toBe('blank');
    expect(textReadability('■ ▯ ~~ |')).toBe('blank');
    // 整段都识别成「?」也没有一个字。
    expect(textReadability('??? ?? ?')).toBe('blank');
  });

  it('calls stray marks and confusable fragments garbled', () => {
    expect(textReadability('lI1 |:; 0O0 ~~ ■■ ▯▯ ..')).toBe('garbled');
    // 能读的字太少：只有两个字母。
    expect(textReadability('?? ?? ab')).toBe('garbled');
    // 能读的字够多，但只占一小部分。
    expect(textReadability('#@! %%^ &&* ((( ))) [[[ ]]] ~~~ word ok')).toBe('garbled');
  });

  it('keeps ordinary receipts, invoices and bills in three languages readable', () => {
    expect(textReadability(RECEIPT_ZH)).toBe('readable');
    expect(textReadability(INVOICE_EN)).toBe('readable');
    expect(textReadability(FACTURE_FR)).toBe('readable');
  });

  it('does not count the blanks and boxes of an empty form as garbage', () => {
    const form = `居民登记表
姓名：________ 性别：□男 □女
证件号码：__________________
联系电话：____________
签名：________ 日期：____年__月__日`;
    expect(textReadability(form)).toBe('readable');
    expect(textReadability('Name: ____________ Date: __/__/____ ☐ Yes ☐ No')).toBe('readable');
  });

  it('keeps text with some misread characters readable', () => {
    // 一部分字被识别成「?」：还看得出是收据，要交给后面判断，不能在这里拒掉。
    expect(
      textReadability('Caf? des Lilas 2 caf?s 7,40 € Croissant 2,60 € Total pay? 10,00 €'),
    ).toBe('readable');
    expect(textReadability('禾?便利店 矿泉? 2.50 实付 9.?0元')).toBe('readable');
  });

  it('counts codes and numbers but not lone letters', () => {
    expect(textReadability('INV-2026-0042 12,50 €')).toBe('readable');
    expect(textReadability('a b c d e f g h')).toBe('garbled');
  });
});

describe('cosine and rankLabels', () => {
  it('is 1 for the same direction, 0 for orthogonal or zero vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(() => cosine([1], [1, 2])).toThrow();
  });

  it('ranks labels from most to least similar, keeping order on ties', () => {
    const labels: LabelVector[] = [
      { id: 'menu', vector: [0, 1] },
      { id: 'receipt', vector: [1, 0] },
      { id: 'twin', vector: [1, 0] },
    ];
    expect(rankLabels([1, 0.1], labels).map((s) => s.id)).toEqual(['receipt', 'twin', 'menu']);
  });
});

describe('pickLabel', () => {
  const thresholds = { minScore: 0.5, minMargin: 0.05 };

  it('picks the best label when it is high enough and clear of the second', () => {
    expect(
      pickLabel(
        [
          { id: 'menu', score: 0.52 },
          { id: 'receipt', score: 0.7 },
        ],
        thresholds,
      ),
    ).toEqual({ status: 'label', id: 'receipt', score: 0.7, margin: expect.closeTo(0.18) });
  });

  it('says unknown when the best score is too low', () => {
    expect(pickLabel([{ id: 'receipt', score: 0.49 }], thresholds)).toEqual({
      status: 'unknown',
      reason: 'lowScore',
    });
  });

  it('says unknown when the first two are too close', () => {
    expect(
      pickLabel(
        [
          { id: 'receipt', score: 0.62 },
          { id: 'menu', score: 0.6 },
        ],
        thresholds,
      ),
    ).toEqual({ status: 'unknown', reason: 'tooClose' });
  });

  it('says unknown without candidates and ignores scores that are not numbers', () => {
    expect(pickLabel([], thresholds)).toEqual({ status: 'unknown', reason: 'noCandidates' });
    expect(pickLabel([{ id: 'x', score: Number.NaN }], thresholds)).toEqual({
      status: 'unknown',
      reason: 'noCandidates',
    });
    expect(
      pickLabel(
        [
          { id: 'x', score: Number.NaN },
          { id: 'receipt', score: 0.8 },
        ],
        thresholds,
      ),
    ).toMatchObject({ status: 'label', id: 'receipt', margin: Number.POSITIVE_INFINITY });
  });
});

describe('guessFacets', () => {
  const labels = {
    kind: [
      { id: 'receipt', vector: [1, 0, 0] },
      { id: 'menu', vector: [0, 1, 0] },
    ],
    topic: [
      { id: 'dining', vector: [0, 0, 1] },
      { id: 'shopping', vector: [1, 0, 0] },
    ],
  };
  const thresholds = {
    kind: { minScore: 0.5, minMargin: 0.1 },
    topic: { minScore: 0.9, minMargin: 0.1 },
  };

  it('does not call the model for blank or garbled text', async () => {
    const embed = vi.fn(async () => [1, 0, 0]);
    expect(await guessFacets('  ', embed, labels, thresholds)).toEqual({
      kind: { status: 'unknown', reason: 'blank' },
      topic: { status: 'unknown', reason: 'blank' },
    });
    expect(await guessFacets('lI1 |:; 0O0 ■■', embed, labels, thresholds)).toEqual({
      kind: { status: 'unknown', reason: 'garbled' },
      topic: { status: 'unknown', reason: 'garbled' },
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('encodes each facet separately and applies its own thresholds', async () => {
    const embed = vi.fn(async (_text: string, facet: 'kind' | 'topic') =>
      facet === 'kind' ? [0.9, 0.1, 0] : [0.6, 0, 0.8],
    );
    const result = await guessFacets(RECEIPT_ZH, embed, labels, thresholds);
    expect(result.kind).toMatchObject({ status: 'label', id: 'receipt' });
    // 主题最高 0.8 没到 0.9：不给。
    expect(result.topic).toEqual({ status: 'unknown', reason: 'lowScore' });
    expect(embed.mock.calls.map(([, facet]) => facet)).toEqual(['kind', 'topic']);
  });

  it('says unknown for a facet that has no candidates without encoding it', async () => {
    const embed = vi.fn(async () => [1, 0, 0]);
    const result = await guessFacets(RECEIPT_ZH, embed, { ...labels, topic: [] }, thresholds);
    expect(result.topic).toEqual({ status: 'unknown', reason: 'noCandidates' });
    expect(embed).toHaveBeenCalledTimes(1);
  });
});
