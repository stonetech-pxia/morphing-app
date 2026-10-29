import {
  applyOps,
  createDefaultWorkspace,
  localDate,
  localDateTime,
  monthTitle,
  shiftMonth,
  type Collection,
  type DataRecord,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import type { SQLiteDatabase } from 'expo-sqlite';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { SQLiteWorkspaceRepo } from '../storage/sqlite';
import { renderToolsApp } from '../test-utils/render-app';

// 阶段 C2（方案 P7）：月历外观（D-302）、右侧字段的 elapsed / progress（D-303）、统计的目标和比较（D-304、D-305）。

const tables: Collection[] = [
  {
    id: 'mood',
    name: '心情',
    fields: [
      {
        id: 'feel',
        name: '心情',
        type: 'choice',
        options: [
          { id: 'good', label: '开心' },
          { id: 'bad', label: '难过' },
        ],
      },
      { id: 'date', name: '日期', type: 'date', default: 'today' },
      { id: 'note', name: '备注', type: 'text' },
    ],
  },
  {
    id: 'shifts',
    name: '上下班',
    fields: [
      { id: 'job', name: '工作', type: 'text' },
      { id: 'in', name: '上班', type: 'datetime', default: 'now' },
      { id: 'out', name: '下班', type: 'datetime' },
      { id: 'cups', name: '杯数', type: 'number' },
      { id: 'goal', name: '目标', type: 'number' },
    ],
  },
  {
    id: 'spend',
    name: '支出',
    fields: [
      { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
      { id: 'date', name: '日期', type: 'date', default: 'today' },
      {
        id: 'cat',
        name: '分类',
        type: 'choice',
        options: [
          { id: 'food', label: '吃饭' },
          { id: 'trip', label: '交通' },
        ],
      },
    ],
  },
];

const seedWith =
  (...components: NewComponent[]) =>
  (locale: Locale, registry: Registry) => {
    const result = applyOps(
      createDefaultWorkspace(locale),
      [
        ...tables.map((collection) => ({ op: 'addCollection' as const, collection })),
        ...components.map((component) => ({
          op: 'addComponent' as const,
          pageId: 'home',
          component,
        })),
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

const calendar: NewComponent = {
  id: 'cal',
  type: 'recordList',
  props: {
    collectionId: 'mood',
    display: 'calendar',
    titleField: 'feel',
    subtitleFields: ['note'],
    colorField: 'feel',
    limit: 20,
  },
};

let seq = 0;
const put = async (repo: MemoryWorkspaceRepo, collectionId: string, values: object) => {
  const record: DataRecord = {
    id: `r${++seq}`,
    collectionId,
    values: values as Record<string, unknown>,
    createdAt: Date.now() + seq,
    updatedAt: Date.now() + seq,
  };
  await repo.insertRecord(record);
  return record;
};

const today = () => localDate(new Date());
/** 这个月另一天（1 号，今天是 1 号时用 2 号）。 */
const otherDay = () => {
  const d = new Date();
  return localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() === 1 ? 2 : 1));
};

it('a new user sees an empty month with today marked', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed: seedWith(calendar) });
  const month = today().slice(0, 7);
  expect(await screen.findByText(monthTitle(month, 'zh'))).toBeTruthy();
  const cell = screen.getByTestId(`calendar-cal-day-${today()}`);
  expect(cell.props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByText('这一天没有记录。')).toBeTruthy();
});

it('days show entries in the color of their mood; tapping a day lists its entries', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'mood', { date: otherDay(), feel: 'bad', note: '下雨' });
  await put(repo, 'mood', { date: otherDay(), feel: 'good', note: '晴天' });
  await put(repo, 'mood', { date: today(), note: '还没选' });
  // 很久以前的记录：这个月不读它。
  await put(repo, 'mood', { date: '2001-01-01', feel: 'good', note: '旧的' });
  const listAll = jest.spyOn(repo, 'listRecords');
  await renderToolsApp(repo, undefined, { seed: seedWith(calendar) });
  expect(await screen.findByText('还没选')).toBeTruthy();
  const other = screen.getByTestId(`calendar-cal-day-${otherDay()}`);
  expect(other.props.accessibilityLabel).toMatch(/2 条记录/);
  expect(screen.getByTestId(`calendar-cal-day-${otherDay()}`).props.accessibilityHint).toBe('开心');
  await fireEvent.press(other);
  expect(await screen.findByText('晴天')).toBeTruthy();
  expect(screen.getByText('下雨')).toBeTruthy();
  expect(screen.queryByText('还没选')).toBeNull();
  // 图例列出选项和「未选」。
  expect(screen.getAllByText('开心').length).toBeGreaterThan(0);
  expect(screen.getAllByText('未选').length).toBeGreaterThan(0);
  expect(listAll).not.toHaveBeenCalledWith('mood');
  expect(screen.queryByText('旧的')).toBeNull();
});

it('moves to the previous month and back to today', async () => {
  const repo = new MemoryWorkspaceRepo();
  const lastMonth = shiftMonth(today().slice(0, 7), -1);
  await put(repo, 'mood', { date: `${lastMonth}-15`, feel: 'good', note: '上个月' });
  await renderToolsApp(repo, undefined, { seed: seedWith(calendar), locale: 'fr' });
  await fireEvent.press(await screen.findByTestId('calendar-cal-prev'));
  expect(await screen.findByText(monthTitle(lastMonth, 'fr'))).toBeTruthy();
  await fireEvent.press(await screen.findByTestId(`calendar-cal-day-${lastMonth}-15`));
  expect(await screen.findByText('上个月')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('calendar-cal-today'));
  expect(await screen.findByText(monthTitle(today().slice(0, 7), 'fr'))).toBeTruthy();
});

it('a shift with no end is a running timer; a finished one shows its length', async () => {
  jest.useFakeTimers({ now: new Date() });
  try {
    const repo = new MemoryWorkspaceRepo();
    const start = new Date(Date.now() - 65 * 60_000);
    await put(repo, 'shifts', { job: '咖啡店', in: localDateTime(start) });
    await put(repo, 'shifts', { job: '书店', in: '2026-10-20T09:00', out: '2026-10-20T17:30' });
    await renderToolsApp(repo, undefined, {
      seed: seedWith({
        id: 'work',
        type: 'recordList',
        props: {
          collectionId: 'shifts',
          display: 'list',
          titleField: 'job',
          trailingField: 'in',
          trailingFormat: { kind: 'elapsed', until: 'out' },
          limit: 10,
        },
      }),
    });
    expect(await screen.findByText('8:30')).toBeTruthy();
    const running = screen.getByText(/^1:0[5-6]:\d\d$/);
    const before = running.props.children as string;
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/^1:0[5-6]:\d\d$/).props.children).not.toBe(before);
  } finally {
    jest.useRealTimers();
  }
});

it('progress against another field of the entry', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'shifts', { job: '喝水', cups: 6, goal: 8 });
  await put(repo, 'shifts', { job: '没有目标', cups: 3 });
  await renderToolsApp(repo, undefined, {
    seed: seedWith({
      id: 'water',
      type: 'recordList',
      props: {
        collectionId: 'shifts',
        display: 'list',
        titleField: 'job',
        trailingField: 'cups',
        trailingFormat: { kind: 'progress', goal: 'goal' },
        limit: 10,
      },
    }),
  });
  expect(await screen.findByText('6 / 8')).toBeTruthy();
  expect(screen.getAllByTestId(/^progress-ring-/)).toHaveLength(1);
  // 没有目标的那条照常显示数值。
  expect(screen.getByText('3')).toBeTruthy();
});

it('a stat with a goal and compared with the same days last month', async () => {
  const repo = new MemoryWorkspaceRepo();
  const lastMonth = shiftMonth(today().slice(0, 7), -1);
  await put(repo, 'shifts', { job: '早上', cups: 3 });
  await put(repo, 'shifts', { job: '下午', cups: 2 });
  await put(repo, 'spend', { amount: 150, date: today() });
  await put(repo, 'spend', { amount: 100, date: `${lastMonth}-01` });
  await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seedWith(
      {
        id: 'cups',
        type: 'stat',
        props: {
          collectionId: 'shifts',
          aggregate: 'sum',
          fieldId: 'cups',
          label: '今天喝水',
          filter: [{ field: 'createdAt', op: 'inPeriod', value: 'today' }],
          goal: 8,
        },
      },
      {
        id: 'month',
        type: 'stat',
        props: {
          collectionId: 'spend',
          aggregate: 'sum',
          fieldId: 'amount',
          label: '本月支出',
          filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
          compare: 'previous',
        },
      },
    ),
  });
  expect(await screen.findByText('5 / 8')).toBeTruthy();
  expect(screen.getByText('63%')).toBeTruthy();
  expect(await screen.findByText('上月同期：¥100.00')).toBeTruthy();
  expect(screen.getByText('↑ 50%')).toBeTruthy();
});

it('a grouped stat compares each option with the same days last month', async () => {
  const repo = new MemoryWorkspaceRepo();
  const lastMonth = shiftMonth(today().slice(0, 7), -1);
  await put(repo, 'spend', { amount: 150, cat: 'food', date: today() });
  await put(repo, 'spend', { amount: 100, cat: 'food', date: `${lastMonth}-01` });
  await put(repo, 'spend', { amount: 40, cat: 'trip', date: today() });
  await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seedWith({
      id: 'bycat',
      type: 'stat',
      props: {
        collectionId: 'spend',
        aggregate: 'sum',
        fieldId: 'amount',
        label: '本月各类',
        groupBy: 'cat',
        filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
        compare: 'previous',
      },
    }),
  });
  expect(await screen.findByText('↑ 50%')).toBeTruthy();
  // 交通上月同期是 0：只写「增加」。
  expect(screen.getByText('↑ 增加')).toBeTruthy();
});

it('SQLite reads one month by the stored date, or by created time', async () => {
  const getAllAsync = jest.fn(async () => []);
  const repo = new SQLiteWorkspaceRepo({ getAllAsync } as unknown as SQLiteDatabase);
  const month = { from: '2026-10-01', until: '2026-11-02', fromMs: 1, untilMs: 2 };
  await repo.listRecordsInRange('mood', { by: 'my-date', ...month });
  await repo.listRecordsInRange('mood', { by: 'createdAt', ...month });
  const [byDate, byCreated] = getAllAsync.mock.calls as unknown as unknown[][];
  expect(byDate).toEqual([
    expect.stringContaining(
      'json_extract(values_json, ?) >= ? AND json_extract(values_json, ?) < ?',
    ),
    'mood',
    '$."my-date"',
    '2026-10-01',
    '$."my-date"',
    '2026-11-02',
  ]);
  expect(byCreated).toEqual([
    expect.stringContaining('created_at >= ? AND created_at < ?'),
    'mood',
    1,
    2,
  ]);
});
