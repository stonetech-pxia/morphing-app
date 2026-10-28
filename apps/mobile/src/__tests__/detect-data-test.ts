import { prefillRecord, type Field } from '@morph/core';

import { detectDataWith } from '../runtime/detect-data';

// 系统识别只做规则的补充：出问题时返回空，预填照样用规则。

const TEXT = 'Corner Deli\nPaid on 3 March\nTotal 8.40';
const FIELDS = [
  { id: 'amount', name: 'Amount', type: 'money', currency: 'USD' },
  { id: 'day', name: 'Day', type: 'date' },
] as Field[];

describe('detectDataWith', () => {
  it('never asks the native side to download a model', async () => {
    const calls: boolean[] = [];
    await detectDataWith(
      async (_t, _l, allowDownload) => {
        calls.push(allowDownload);
        return [];
      },
      TEXT,
      'en',
    );
    expect(calls).toEqual([false]);
  });

  it('returns nothing when the model is missing or the system fails, and the rules still fill', async () => {
    const missing = await detectDataWith(
      async () => {
        throw Object.assign(new Error('download first'), { code: 'ERR_VISION_NEEDS_DOWNLOAD' });
      },
      TEXT,
      'fr',
    );
    expect(missing).toEqual([]);
    const result = prefillRecord({ text: TEXT, locale: 'en', fields: FIELDS, system: missing });
    expect(result.values).toEqual({ amount: { value: 8.4, source: 'rule' } });
  });

  it('drops matches outside the text or with a malformed date', async () => {
    const found = await detectDataWith(
      async () => [
        { kind: 'date', start: 20, end: 27, value: '2026-03-03' },
        { kind: 'date', start: 0, end: 5, value: 'March 3' },
        { kind: 'amount', start: 30, end: 999 },
        { kind: 'amount', start: 34, end: 38 },
      ],
      TEXT,
      'en',
    );
    expect(found).toEqual([
      { kind: 'date', start: 20, end: 27, value: '2026-03-03' },
      { kind: 'amount', start: 34, end: 38 },
    ]);
    // 规则没找到的日期由系统补上。
    const result = prefillRecord({ text: TEXT, locale: 'en', fields: FIELDS, system: found });
    expect(result.values.day).toEqual({ value: '2026-03-03', source: 'system' });
  });
});
