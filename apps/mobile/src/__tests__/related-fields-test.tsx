import {
  applyOps,
  createDefaultWorkspace,
  formatMoney,
  localDate,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 查找、汇总、上一条（D-287–D-291）：列表和记录页显示本机算出来的值，表单里不能填。

const jobs: Collection = {
  id: 'jobs',
  name: '工作',
  fields: [
    { id: 'name', name: '名字', type: 'text' },
    { id: 'rate', name: '时薪', type: 'money', currency: 'CNY' },
    {
      id: 'total',
      name: '总工时',
      type: 'rollup',
      table: 'shifts',
      via: 'job',
      aggregate: 'sum',
      field: 'hours',
    },
    {
      id: 'streak',
      name: '连续',
      type: 'rollup',
      table: 'shifts',
      via: 'job',
      aggregate: 'streak',
    },
  ],
};
const shifts: Collection = {
  id: 'shifts',
  name: '工时',
  fields: [
    { id: 'job', name: '工作', type: 'link', table: 'jobs' },
    { id: 'date', name: '日期', type: 'date', default: 'today' },
    { id: 'hours', name: '小时', type: 'number', unit: 'h' },
    { id: 'rate', name: '时薪', type: 'lookup', via: 'job', field: 'rate' },
    { id: 'pay', name: '工资', type: 'formula', expression: '{hours} * {rate}', currency: 'CNY' },
  ],
};

const list = (id: string, table: string, title: string, trailing: string) => ({
  op: 'addContainer' as const,
  page: 'home',
  block: {
    id,
    look: 'list' as const,
    source: { table, limit: 10 },
    show: { title, subtitles: table === 'jobs' ? ['streak'] : [], trailing },
  },
});

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: { ...jobs, fields: jobs.fields.slice(0, 2) } },
      { op: 'addData', table: shifts },
      { op: 'addData', table: 'jobs', field: jobs.fields[2]! },
      { op: 'addData', table: 'jobs', field: jobs.fields[3]! },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'log',
          look: 'form',
          show: { mode: 'inline' },
          tools: [
            { as: 'submit', label: 'Log', do: 'create', table: 'shifts', ask: ['job', 'hours'] },
          ],
        },
      },
      list('job-list', 'jobs', 'name', 'total'),
      list('shift-list', 'shifts', 'date', 'pay'),
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const day = (offset: number) => localDate(new Date(Date.now() + offset * 86_400_000));

async function withData() {
  const repo = new MemoryWorkspaceRepo();
  const at = Date.now();
  const put = (id: string, collectionId: string, values: Record<string, unknown>) =>
    repo.insertRecord({ id, collectionId, values, createdAt: at, updatedAt: at });
  await put('job1', 'jobs', { name: '咖啡店', rate: 30 });
  await put('job2', 'jobs', { name: '书店', rate: 20 });
  await put('s1', 'shifts', { job: 'job1', date: day(-1), hours: 4 });
  await put('s2', 'shifts', { job: 'job1', date: day(0), hours: 2.5 });
  return repo;
}

it('a new user: the lists are empty and nothing breaks', async () => {
  await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
  expect(await screen.findAllByText('还没有记录')).toHaveLength(2);
});

it('shows the looked-up rate in the pay and the totals and streak per job', async () => {
  await renderToolsApp(await withData(), undefined, { seed });
  expect(await screen.findByText(formatMoney(120, 'CNY', 'zh'))).toBeTruthy();
  expect(screen.getByText(formatMoney(75, 'CNY', 'zh'))).toBeTruthy();
  expect(screen.getByText('6.5 h')).toBeTruthy();
  expect(screen.getByText('2 天')).toBeTruthy();
  // 没有工时的那份工作：合计 0，连续 0 天。
  expect(screen.getByText('0 h')).toBeTruthy();
  expect(screen.getByText('0 天')).toBeTruthy();
});

it('adding an entry updates the rollup; the form has no box for computed fields', async () => {
  const repo = await withData();
  await renderToolsApp(repo, undefined, { seed });
  expect(await screen.findByText('6.5 h')).toBeTruthy();
  expect(screen.queryByTestId('form-log-rate')).toBeNull();
  await fireEvent.press(screen.getByTestId('form-log-job'));
  await fireEvent.press(await screen.findByTestId('form-log-job-option-job1'));
  await fireEvent.changeText(screen.getByTestId('form-log-hours'), '1');
  await fireEvent.press(screen.getByTestId('form-log-submit'));
  expect(await screen.findByText('7.5 h')).toBeTruthy();
  const saved = (await repo.listRecords('shifts')).find((r) => r.values.hours === 1)!;
  // 算出来的值从不存进记录。
  expect(Object.keys(saved.values).sort()).toEqual(['date', 'hours', 'job']);
});

it('a deleted job leaves its shifts without a rate and pay', async () => {
  const repo = await withData();
  await renderToolsApp(repo, undefined, { seed });
  expect(await screen.findByText(formatMoney(120, 'CNY', 'zh'))).toBeTruthy();
  await act(async () => {
    await repo.deleteRecord('job1', Date.now());
  });
  await fireEvent.press(screen.getByTestId('record-job2'));
  await fireEvent.press(await screen.findByTestId('editor-save'));
  expect(screen.queryByText(formatMoney(120, 'CNY', 'zh'))).toBeNull();
});

it('the record page shows the computed values and has no box for them', async () => {
  await renderToolsApp(await withData(), undefined, { seed });
  await fireEvent.press(await screen.findByTestId('record-job1'));
  expect((await screen.findByTestId('editor-total')).props.children).toBe('6.5 h');
  expect(screen.getByTestId('editor-streak').props.children).toBe('2 天');
  await fireEvent.press(screen.getByTestId('editor-save'));
  await fireEvent.press(await screen.findByTestId('record-s1'));
  expect((await screen.findByTestId('editor-rate')).props.children).toBe(
    formatMoney(30, 'CNY', 'zh'),
  );
  expect(screen.getByTestId('editor-pay').props.children).toBe(formatMoney(120, 'CNY', 'zh'));
});
