import { describe, expect, it } from 'vitest';

import type { Field } from '../schema';
import { ruleEngine } from './engine';
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

describe('规则引擎（D-398）', () => {
  it('结果和规则打分一样，按字段给带分数和记忆的候选', async () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const input = { fields, pages, locale: 'en' as const, now };
    const out = await ruleEngine(input);
    expect(out).toEqual(suggestValues(input));
    expect(out.total?.[0]).toMatchObject({ value: '178.23', pick: { label: 'Total' } });
    expect(out.day?.[0]?.value).toBe('2026-10-20');
  });
});
