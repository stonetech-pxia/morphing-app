import { describe, expect, it } from 'vitest';

import { checkNameTemplate, renderNameTemplate, uniqueFileName } from './naming';

const now = new Date(2026, 9, 22, 9, 5, 7);

describe('name templates', () => {
  it('accepts only whitelisted placeholders', () => {
    expect(checkNameTemplate('合并-{date:YYYY-MM-DD}').ok).toBe(true);
    expect(checkNameTemplate('{sourceName}-{index}-{date:YYYYMMDD_HHmmss}').ok).toBe(true);
    expect(checkNameTemplate('{date:YYYY}{eval}').ok).toBe(false);
    expect(checkNameTemplate('{date:constructor}').ok).toBe(false);
    expect(checkNameTemplate('a}b').ok).toBe(false);
    expect(checkNameTemplate('   ').ok).toBe(false);
  });

  it('renders dates in local time and fills placeholders', () => {
    expect(renderNameTemplate('合并-{date:YYYY-MM-DD}', { now })).toBe('合并-2026-10-22');
    expect(
      renderNameTemplate('{sourceName}-{index}-{date:HHmmss}', {
        now,
        index: 3,
        sourceName: 'report',
      }),
    ).toBe('report-3-090507');
  });

  it('supports {date}, {seq} and the photo taken date', () => {
    expect(checkNameTemplate('{taken:YYYYMMDD}-{seq}').ok).toBe(true);
    expect(checkNameTemplate('{taken:eval}').ok).toBe(false);
    const takenAt = new Date(2025, 0, 2, 3, 4, 5);
    expect(renderNameTemplate('收据-{date}-{seq}', { now, index: 3 })).toBe('收据-2026-10-22-03');
    expect(renderNameTemplate('{taken}_{taken:HHmm}', { now, takenAt })).toBe('2025-01-02_0304');
    // 读不到拍摄日期时用当天。
    expect(renderNameTemplate('{taken}', { now })).toBe('2026-10-22');
  });

  it('strips characters that are not allowed in file names', () => {
    expect(renderNameTemplate('{sourceName}', { now, sourceName: 'a/b:c?' })).toBe('a-b-c-');
    expect(renderNameTemplate('{sourceName}', { now, sourceName: '' })).toBe('untitled');
  });

  // 2026-11-09 用户测试：模板「../../a/b:*?|x {date}」存成「..-..-a-b----x 2026-11-09.pdf」，
  // 点开头的名字在「文件」App 里是隐藏文件。
  it('never starts a name with a dot, and a run of bad characters becomes one dash', () => {
    expect(renderNameTemplate('../../a/b:*?|x {date}', { now })).toBe('a-b-x 2026-10-22');
    expect(renderNameTemplate('.hidden', { now })).toBe('hidden');
    expect(renderNameTemplate('{sourceName}', { now, sourceName: '...' })).toBe('untitled');
    expect(renderNameTemplate('v1.2 final', { now })).toBe('v1.2 final');
  });

  it('never reuses an existing name', () => {
    expect(uniqueFileName('合并', 'pdf', [])).toBe('合并.pdf');
    expect(uniqueFileName('合并', 'pdf', ['合并.pdf', '合并-2.PDF'])).toBe('合并-3.pdf');
  });
});
