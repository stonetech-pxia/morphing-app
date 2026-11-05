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
    expect(await screen.findByText('每月开销')).toBeTruthy();
    expect(screen.getByText('按类别')).toBeTruthy();
  });

  it('the Spending button opens the spending page', async () => {
    await open('receipts');
    await fireEvent.press(await screen.findByTestId('bottom-pill'));
    expect(await screen.findByText('每周开销')).toBeTruthy();
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

describe('spending compared with the previous period (D-439)', () => {
  it('the monthly chart reads out the latest month with the same month six months earlier', async () => {
    const earlier = new Date();
    earlier.setDate(15);
    earlier.setMonth(earlier.getMonth() - 6);
    const pad = (n: number) => String(n).padStart(2, '0');
    const before = `${earlier.getFullYear()}-${pad(earlier.getMonth() + 1)}-15`;
    await open('spending', [
      {
        table: 'receipts',
        values: { merchant: 'Café', date: day(0), amount: 12.5, category: 'dining' },
      },
      {
        table: 'receipts',
        values: { merchant: 'Metro', date: before, amount: 20, category: 'transport' },
      },
    ]);
    // 开销页有三张图，每张图的读数 testID 相同：第一张是每月。
    const [readout] = await screen.findAllByTestId('chart-readout-receipts');
    expect(readout).toHaveTextContent(/¥12\.50（上一期：¥20\.00）/);
    // 读屏标签也带上一期。
    expect(screen.getAllByTestId('chart-bar-5')[0]).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('上一期：¥20.00'),
    );
  });

  it('with no earlier receipts the previous period reads 0, and nothing fails without any receipt', async () => {
    await open('spending', [
      {
        table: 'receipts',
        values: { merchant: 'Café', date: day(0), amount: 12.5, category: 'dining' },
      },
    ]);
    const [readout] = await screen.findAllByTestId('chart-readout-receipts');
    expect(readout).toHaveTextContent(/上一期：¥0\.00/);
  });
});
