import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 时间、日期时间、时长字段的填写和显示（D-279），工时公式（D-280、D-281）。

const shifts: Collection = {
  id: 'shifts',
  name: '工时',
  fields: [
    { id: 'start', name: '上班', type: 'time' },
    { id: 'end', name: '下班', type: 'time' },
    { id: 'in', name: '打卡', type: 'datetime', default: 'now' },
    { id: 'break', name: '休息', type: 'duration' },
    {
      id: 'worked',
      name: '工时',
      type: 'formula',
      expression: 'hours({start}, {end}) - {break} / 60',
      unit: 'h',
    },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addCollection', collection: shifts },
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'log',
          type: 'recordForm',
          props: {
            collectionId: 'shifts',
            fieldIds: ['start', 'end', 'in', 'break'],
            submitLabel: 'Log',
            mode: 'inline',
          },
        },
      },
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'list',
          type: 'recordList',
          props: {
            collectionId: 'shifts',
            display: 'list',
            titleField: 'in',
            subtitleFields: ['break'],
            trailingField: 'worked',
            limit: 10,
          },
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

it('a new user logs a night shift with a break and sees the worked hours', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.changeText(await screen.findByTestId('form-log-start'), '22:00');
  await fireEvent.changeText(screen.getByTestId('form-log-end'), '6:00');
  await fireEvent.changeText(screen.getByTestId('form-log-break-minutes'), '30');
  await fireEvent.press(screen.getByTestId('form-log-submit'));
  const saved = await repo.listRecords('shifts');
  expect(saved).toHaveLength(1);
  // 打卡没填，默认是现在。
  expect(saved[0]!.values).toEqual({
    start: '22:00',
    end: '06:00',
    break: 30,
    in: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  });
  // 跨午夜 8 小时减 30 分钟。
  expect(await screen.findByText('7.5 h')).toBeTruthy();
  expect(screen.getByText('0:30')).toBeTruthy();
});

it('the Now button fills in the current time', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed, locale: 'en' });
  await fireEvent.press(await screen.findByTestId('form-log-start-now'));
  expect(screen.getByTestId('form-log-start').props.value).toMatch(/^\d{2}:\d{2}$/);
  await fireEvent.press(screen.getByTestId('form-log-in-now'));
  expect(screen.getByTestId('form-log-in').props.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(screen.getAllByText('Now')).toHaveLength(3);
});

it('refuses 75 minutes and a time like 25:00 without saving anything', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.changeText(await screen.findByTestId('form-log-start'), '25:00');
  await fireEvent.changeText(screen.getByTestId('form-log-break-hours'), '1');
  await fireEvent.changeText(screen.getByTestId('form-log-break-minutes'), '75');
  await fireEvent.press(screen.getByTestId('form-log-submit'));
  expect(await screen.findAllByText('格式不对')).toHaveLength(2);
  expect(await repo.listRecords('shifts')).toEqual([]);
});

it('shows stored entries in French, and nothing for values that no longer fit', async () => {
  const repo = new MemoryWorkspaceRepo();
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'shifts',
    values: { start: '09:00', end: '17:00', in: '2026-10-21T08:55', break: 90 },
    createdAt: 1,
    updatedAt: 1,
  });
  // 恢复旧版本后类型对不上的值：不显示，也不让公式算错。
  await repo.insertRecord({
    id: 'r2',
    collectionId: 'shifts',
    values: { start: 900, end: '17:00', in: '2026-10-20', break: '1:30' },
    createdAt: 2,
    updatedAt: 2,
  });
  await renderToolsApp(repo, undefined, { seed, locale: 'fr' });
  expect(await screen.findByText('21/10/2026 08:55')).toBeTruthy();
  expect(screen.getByText('1:30')).toBeTruthy();
  expect(screen.getByText('6,5 h')).toBeTruthy();
  expect(screen.queryByText('2026-10-20')).toBeNull();
  expect(screen.getAllByText(/ h$/)).toHaveLength(1);
});
