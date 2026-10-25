import { getLocales } from 'expo-localization';
import { getDeviceLocale, formatWhen } from '../i18n';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));

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
    ['fr', new Date(2026, 9, 23, 13, 51), 'Aujourd’hui 13:51'],
    ['fr', new Date(2026, 9, 22, 9, 3), 'Hier 09:03'],
    ['fr', new Date(2026, 9, 21, 13, 51), '21 oct., 13:51'],
  ] as const)('%s %s → %s', (locale, at, expected) => {
    expect(formatWhen(locale, at, now)).toBe(expected);
  });
});

describe('device locale', () => {
  it.each([
    ['fr', 'fr'],
    ['zh', 'zh'],
    ['en', 'en'],
    ['de', 'en'],
  ] as const)('uses %s → %s', (code, expected) => {
    jest
      .mocked(getLocales)
      .mockReturnValue([{ languageCode: code } as ReturnType<typeof getLocales>[number]]);
    expect(getDeviceLocale()).toBe(expected);
  });
  it('falls back to English when the device provides no language', () => {
    jest.mocked(getLocales).mockReturnValue([] as unknown as ReturnType<typeof getLocales>);
    expect(getDeviceLocale()).toBe('en');
  });
});
