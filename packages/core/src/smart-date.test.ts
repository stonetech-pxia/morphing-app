import { describe, expect, it } from 'vitest';

import { withoutPhrase } from './date-phrases';
import { dayNumber } from './formula';
import { smartDateOf } from './smart-date';
import type { Field } from './schema';

// D-344：快速添加表单在本机认出日期，按要填的字段换成表单输入。2026-10-30 是周五。
const today = dayNumber('2026-10-30')!;
const date: Field = { id: 'due', name: 'Due', type: 'date' };
const at: Field = { id: 'at', name: 'At', type: 'datetime' };
const plan: Field = { id: 'plan', name: 'Plan', type: 'schedule' };

describe('smart dates for a form field', () => {
  it('a schedule field takes a one-off day or a repeat rule', () => {
    const friday = smartDateOf('周五下午3点交报告', plan, today, 'zh')!;
    // 钟点一起填（D-346）。
    expect(friday.input).toEqual({ repeat: 'once', date: '2026-10-30', time: '15:00' });
    expect(friday.preview).toBe('10月30日 15:00');
    expect(smartDateOf('每周一早上9点开会', plan, today, 'zh')!.input).toEqual({
      repeat: 'weekdays',
      days: [1],
      time: '09:00',
    });
    expect(smartDateOf('Call at 3pm', plan, today, 'en')!.input).toEqual({
      repeat: 'once',
      date: '2026-10-30',
      time: '15:00',
    });
    expect(withoutPhrase('周五下午3点交报告', friday.phrase)).toBe('交报告');
    const weekly = smartDateOf('Water plants every Monday', plan, today, 'en')!;
    expect(weekly.input).toEqual({ repeat: 'weekdays', days: [1] });
    expect(weekly.preview).toBe('Every Mon');
  });

  it('a date field only takes dates; a repeat is not offered', () => {
    expect(smartDateOf('Appeler Paul demain', date, today, 'fr')!.input).toBe('2026-10-31');
    expect(smartDateOf('Pay rent every month on the 1st', date, today, 'en')).toBeUndefined();
  });

  it('a datetime field needs a time; a time alone means today', () => {
    expect(smartDateOf('Dentist tomorrow 3pm', at, today, 'en')!).toMatchObject({
      input: '2026-10-31 15:00',
      preview: 'Oct 31 15:00',
    });
    expect(smartDateOf('Dentist tomorrow', at, today, 'en')).toBeUndefined();
    expect(smartDateOf('开会 15:30', at, today, 'zh')!.input).toBe('2026-10-30 15:30');
  });

  it('nothing to recognise, nothing to fill', () => {
    expect(smartDateOf('Buy sunscreen', plan, today, 'en')).toBeUndefined();
    expect(smartDateOf('看周报', plan, today, 'zh')).toBeUndefined();
  });
});
