import {
  applyOps,
  createStarterWorkspace,
  sampleOps,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 收据样板（D-437，创始人 2026-11-04 在对话里定）在 App 里走一遍：新用户、有数据、边界。

const seed = (locale: Locale, registry: Registry) => {
  const base = createStarterWorkspace(locale, registry);
  const sample = sampleOps('receipts', base, locale);
  if (!sample.ok) throw new Error(sample.message);
  const r = applyOps(base, sample.ops, { registry, locale });
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
  });

async function open(
  pageId: string,
  records: { table: string; values: Record<string, unknown> }[] = [],
  locale: Locale = 'zh',
  withFiles = false,
) {
  const repo = new MemoryWorkspaceRepo();
  const files = withFiles ? new FakeFiles() : undefined;
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  for (const [i, r] of records.entries())
    await repo.insertRecord({
      id: `r${i}`,
      collectionId: r.table,
      values: r.values,
      createdAt: 100 + i,
      updatedAt: 100 + i,
    });
  const app = await renderToolsApp(repo, files, { locale, seed });
  await settle();
  await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId } }));
  await settle();
  return { ...app, repo, files };
}

afterEach(() => {
  jest.restoreAllMocks();
  useGuide.setState({ stage: null, repo: null });
});

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('in the app shell', () => {
  it('the pinned buttons sit right above the navigation bar, not a bar-height higher', async () => {
    // 导航栏在页面下面（不是盖在页面上），下方固定区不能再给它留一份高度（手机上两者之间一大片空白）。
    const repo = new MemoryWorkspaceRepo();
    await repo.setMeta('guide', 'done');
    await act(() => useGuide.getState().load(repo));
    await renderToolsApp(repo, undefined, { locale: 'zh', seed });
    await settle();
    await fireEvent.press(await screen.findByTestId('nav-page:receipts'));
    await settle();
    const zone = StyleSheet.flatten((await screen.findByTestId('page-bottom-zone')).props.style);
    expect(zone.paddingBottom).toBe(10);
  });
});

describe('new user', () => {
  it.each([
    ['zh', '还没有收据。扫一张就有了。', '扫描', '开销', '手动添加'],
    ['en', 'No receipts yet. Scan one to add it.', 'Scan', 'Spending', 'Add by hand'],
    [
      'fr',
      'Aucun reçu pour l’instant. Numérisez-en un pour l’ajouter.',
      'Scanner',
      'Dépenses',
      'Ajouter à la main',
    ],
  ] as const)(
    'is the empty list with Spending and the dial (%s)',
    async (locale, empty, scan, spending, byHand) => {
      await open('receipts', [], locale);
      expect(await screen.findByText(empty)).toBeTruthy();
      expect(screen.queryByTestId('browse-search')).toBeNull();
      const bottom = screen.getByTestId('page-bottom-zone');
      expect(within(bottom).getByText(spending)).toBeTruthy();
      expect(within(screen.getByTestId('dial-main')).getByText(scan)).toBeTruthy();
      await fireEvent.press(screen.getByTestId('dial-toggle'));
      expect(screen.getByText(byHand)).toBeTruthy();
    },
  );

  it('the two bottom buttons are the same kind of button: same height, shape and colour', async () => {
    await open('receipts');
    await screen.findByTestId('bottom-pill');
    const pill = StyleSheet.flatten(screen.getByTestId('bottom-pill').props.style);
    const dial = StyleSheet.flatten(screen.getByTestId('dial-split').props.style);
    expect(pill.minHeight).toBe(dial.minHeight);
    expect(pill.borderRadius).toBe(dial.borderRadius);
    expect(pill.backgroundColor).toBe(dial.backgroundColor);
  });

  it('the spending page shows empty totals and charts without failing', async () => {
    await open('spending');
    expect(await screen.findByText('开销变化')).toBeTruthy();
    expect(screen.getByText('按类别')).toBeTruthy();
  });

  it('the Spending button opens the spending page', async () => {
    await open('receipts');
    await fireEvent.press(await screen.findByTestId('bottom-pill'));
    expect(await screen.findByText('开销变化')).toBeTruthy();
  });
});

describe('with data', () => {
  const RECEIPTS = () => [
    {
      table: 'receipts',
      values: { merchant: 'Café Lune', date: day(0), amount: 12, category: 'dining' },
    },
    {
      table: 'receipts',
      values: { merchant: 'Pharma Plus', date: day(-400), amount: 30, category: 'pharmacy' },
    },
    {
      table: 'receipts',
      values: { merchant: 'Metro', date: day(-45), amount: 5, category: 'transport' },
    },
  ];

  it('period chips: all, this week, this month, this year; none of them writes anything', async () => {
    const { repo } = await open('receipts', RECEIPTS());
    await screen.findByTestId('record-r0');
    const before = JSON.stringify(await repo.listRecords('receipts'));
    expect(screen.getByTestId('record-r1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('browse-period-thisYear'));
    expect(screen.queryByTestId('record-r1')).toBeNull();
    await fireEvent.press(screen.getByTestId('browse-period-thisWeek'));
    expect(screen.getByTestId('record-r0')).toBeTruthy();
    expect(screen.queryByTestId('record-r2')).toBeNull();
    await fireEvent.press(screen.getByTestId('browse-period-all'));
    expect(screen.getByTestId('record-r1')).toBeTruthy();
    expect(JSON.stringify(await repo.listRecords('receipts'))).toBe(before);
  });

  it('a period without receipts says so and the chips stay to switch back', async () => {
    await open('receipts', [RECEIPTS()[1]!]);
    await fireEvent.press(await screen.findByTestId('browse-period-thisWeek'));
    expect(screen.queryByTestId('record-r0')).toBeNull();
    expect(screen.getByTestId('browse-period-all')).toBeTruthy();
  });

  it('search, sort and the category filter work on receipts', async () => {
    await open('receipts', RECEIPTS());
    const top = await screen.findByTestId('page-top-zone');
    expect(within(top).getByTestId('browse-search')).toBeTruthy();
    expect(within(top).getByTestId('browse-sort-amount')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('browse-filter-category-transport'));
    expect(screen.getByTestId('record-r2')).toBeTruthy();
    expect(screen.queryByTestId('record-r0')).toBeNull();
    await fireEvent.press(screen.getByTestId('browse-filter-category-all'));
    await fireEvent.changeText(screen.getByTestId('browse-search'), 'pharma');
    expect(screen.getByTestId('record-r1')).toBeTruthy();
    expect(screen.queryByTestId('record-r0')).toBeNull();
  });
});

describe('the spending page follows the time range (D-439, D-440)', () => {
  // 固定一个「今天」：2026-11-18（周三）。本周 11-16 到 11-22，本月 11 月，本年 2026。
  const records = [
    {
      table: 'receipts',
      values: { merchant: 'A', date: '2026-11-18', amount: 10, category: 'dining' },
    },
    {
      table: 'receipts',
      values: { merchant: 'B', date: '2026-11-02', amount: 20, category: 'transport' },
    },
    {
      table: 'receipts',
      values: { merchant: 'C', date: '2026-03-10', amount: 30, category: 'dining' },
    },
    {
      table: 'receipts',
      values: { merchant: 'D', date: '2025-12-01', amount: 40, category: 'other' },
    },
    {
      table: 'receipts',
      values: { merchant: 'E', date: '2026-10-10', amount: 5, category: 'dining' },
    },
  ];
  const spent = () => screen.getByTestId('stat-value-receipts-已花');
  const count = () => screen.getByTestId('stat-value-receipts-笔数');

  beforeEach(() => {
    jest.setSystemTime(new Date(2026, 10, 18, 12));
  });

  it('starts on this month, and the choices change the totals: week, month, year', async () => {
    await open('spending', records);
    await screen.findByTestId('period-thisMonth');
    expect(screen.getByTestId('period-thisMonth')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );
    expect(spent()).toHaveTextContent('¥30.00');
    expect(count()).toHaveTextContent('2');
    await fireEvent.press(screen.getByTestId('period-thisWeek'));
    expect(spent()).toHaveTextContent('¥10.00');
    await fireEvent.press(screen.getByTestId('period-thisYear'));
    expect(spent()).toHaveTextContent('¥65.00');
    expect(count()).toHaveTextContent('4');
  });

  it('the total is compared with the previous period, month to date', async () => {
    await open('spending', records);
    // 本月到 18 号：¥30；上个月 1–18 号：¥5。
    await screen.findByTestId('period-thisMonth');
    expect(screen.getByTestId('stat-compare-receipts-上一期：¥5.00')).toBeTruthy();
  });

  it('the chart reads out today with the previous period, and the pie follows the range', async () => {
    await open('spending', records);
    const [trend] = await screen.findAllByTestId('chart-readout-receipts');
    // 11-18 当天 ¥10；上个月同一格（10-18）没有。
    expect(trend).toHaveTextContent(/11-18：¥10\.00（上一期：¥0\.00）/);
    // 本月的饼图只有餐饮和交通。
    expect(screen.getByTestId('chart-slice-dining')).toHaveTextContent(/¥10\.00/);
    expect(screen.getByTestId('chart-slice-transport')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('period-thisYear'));
    // 本年：餐饮 10 + 30 + 5。
    expect(screen.getByTestId('chart-slice-dining')).toHaveTextContent(/¥45\.00/);
  });

  it('a custom range: two dates, applied only when they are valid', async () => {
    await open('spending', records);
    await fireEvent.press(await screen.findByTestId('period-custom'));
    await fireEvent.changeText(screen.getByTestId('period-start'), '2026-03-01');
    await fireEvent.changeText(screen.getByTestId('period-end'), '2026-02-01');
    expect(screen.getByTestId('period-invalid')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('period-apply'));
    // 没有应用：还是本月。
    expect(spent()).toHaveTextContent('¥30.00');
    await fireEvent.changeText(screen.getByTestId('period-end'), '2026-03-31');
    expect(screen.queryByTestId('period-invalid')).toBeNull();
    await fireEvent.press(screen.getByTestId('period-apply'));
    expect(spent()).toHaveTextContent('¥30.00');
    expect(count()).toHaveTextContent('1');
    expect(screen.getByTestId('period-range')).toHaveTextContent('2026-03-01 到 2026-03-31');
  });

  it('nothing in the range: totals read 0 and the page does not fail; choosing writes nothing', async () => {
    const { repo } = await open('spending', [records[3]!]);
    await screen.findByTestId('period-thisMonth');
    const before = JSON.stringify(await repo.listRecords('receipts'));
    expect(spent()).toHaveTextContent('¥0.00');
    await fireEvent.press(screen.getByTestId('period-thisWeek'));
    await fireEvent.press(screen.getByTestId('period-thisYear'));
    expect(JSON.stringify(await repo.listRecords('receipts'))).toBe(before);
  });
});
