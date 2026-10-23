import { formatWhen } from '../i18n';

// 改动记录里的时间（D-112）：今天 / 昨天，更早的显示日期；不显示秒。

describe('formatWhen', () => {
  const now = new Date(2026, 9, 23, 18, 5);
  it.each([
    ['zh', new Date(2026, 9, 23, 13, 51, 40), '今天 13:51'],
    ['zh', new Date(2026, 9, 22, 9, 3), '昨天 09:03'],
    ['zh', new Date(2026, 9, 21, 20, 0), '10月21日 20:00'],
    ['zh', new Date(2025, 11, 31, 8, 0), '2025年12月31日 08:00'],
    ['en', new Date(2026, 9, 23, 13, 51), 'Today 13:51'],
    ['en', new Date(2026, 9, 22, 13, 51), 'Yesterday 13:51'],
    ['en', new Date(2026, 9, 21, 13, 51), 'Oct 21, 13:51'],
  ] as const)('%s %s → %s', (locale, at, expected) => {
    expect(formatWhen(locale, at, now)).toBe(expected);
  });
});
