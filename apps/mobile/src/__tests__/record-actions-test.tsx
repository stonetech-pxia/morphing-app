import {
  applyOps,
  createDefaultWorkspace,
  localDate,
  type Collection,
  type Locale,
  type Op,
  type Registry,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 一键记录操作（D-300–D-304）：习惯打卡、喝水 +1、上下班、旅行清单一键清空。

const checkins: Collection = {
  id: 'checkins',
  name: '打卡',
  fields: [
    {
      id: 'habit',
      name: '习惯',
      type: 'choice',
      options: [
        { id: 'run', label: '跑步' },
        { id: 'read', label: '阅读' },
      ],
    },
    { id: 'day', name: '日期', type: 'date' },
  ],
};
const water: Collection = {
  id: 'water',
  name: '喝水',
  fields: [
    { id: 'day', name: '日期', type: 'date' },
    { id: 'glasses', name: '杯数', type: 'number' },
  ],
};
const shifts: Collection = {
  id: 'shifts',
  name: '工时',
  fields: [
    { id: 'start', name: '开始', type: 'datetime' },
    { id: 'end', name: '结束', type: 'datetime' },
  ],
};
const packing: Collection = {
  id: 'packing',
  name: '行李',
  fields: [
    { id: 'item', name: '物品', type: 'text' },
    { id: 'packed', name: '已装', type: 'checkbox' },
  ],
};

const button = (id: string, label: string, action: unknown) => ({
  op: 'addComponent' as const,
  pageId: 'home',
  component: { id, type: 'button' as const, props: { label, variant: 'filled', action } },
});
const list = (id: string, collectionId: string, titleField: string, rowActions?: unknown) => ({
  op: 'addComponent' as const,
  pageId: 'home',
  component: {
    id,
    type: 'recordList' as const,
    props: { collectionId, display: 'list', titleField, limit: 100, rowActions },
  },
});

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      ...[checkins, water, shifts, packing].map((collection) => ({
        op: 'addCollection' as const,
        collection,
      })),
      button('check', '打卡跑步', {
        do: 'create',
        collectionId: 'checkins',
        values: { habit: 'run', day: 'today' },
      }),
      button('clock-in', '上班', {
        do: 'create',
        collectionId: 'shifts',
        values: { start: 'now' },
      }),
      button('unpack', '全部取消', {
        do: 'setAll',
        collectionId: 'packing',
        fieldId: 'packed',
        value: false,
      }),
      list('water-list', 'water', 'day', [
        { label: '+1', do: 'increment', fieldId: 'glasses', by: 1 },
      ]),
      list('shift-list', 'shifts', 'start', [
        {
          label: '下班',
          do: 'set',
          fieldId: 'end',
          value: 'now',
          when: [{ field: 'end', op: 'isEmpty' }],
        },
      ]),
      list('checkin-list', 'checkins', 'day'),
    ] as unknown as Op[],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config as never;
};

/** 系统弹窗：点名字为 label 的按钮，返回 spy 看弹了什么。 */
function pressInAlert(label: string) {
  const spy = jest.spyOn(Alert, 'alert');
  spy.mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
  return spy;
}

afterEach(() => jest.restoreAllMocks());

const at = Date.now();
const put = (repo: MemoryWorkspaceRepo, id: string, collectionId: string, values: object) =>
  repo.insertRecord({ id, collectionId, values: { ...values }, createdAt: at, updatedAt: at });

it('a new user: one tap logs a habit for today, and undo takes it away without a trace', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.press(await screen.findByText('打卡跑步'));
  expect(await screen.findByTestId('toast')).toHaveTextContent(/已在「打卡」添加一条/);
  const [record] = await repo.listRecords('checkins');
  expect(record?.values).toEqual({ habit: 'run', day: localDate(new Date()) });
  await fireEvent.press(screen.getByTestId('toast-undo'));
  expect(await repo.listRecords('checkins')).toEqual([]);
  // 撤销刚建的不进「最近删除」。
  expect(await repo.listDeletedRecords()).toEqual([]);
});

it('+1 on a row adds up quick taps one after another; undo goes back one tap', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'w1aaaaaa', 'water', { day: '2026-10-29', glasses: 3 });
  await renderToolsApp(repo, undefined, { seed });
  const plus = await screen.findByTestId('row-action-w1aaaaaa');
  await act(async () => {
    fireEvent.press(plus);
    fireEvent.press(plus);
  });
  expect(await screen.findByTestId('toast')).toHaveTextContent(/\+1：已记下/);
  expect((await repo.getRecord('w1aaaaaa'))?.values.glasses).toBe(5);
  await fireEvent.press(screen.getByTestId('toast-undo'));
  expect((await repo.getRecord('w1aaaaaa'))?.values.glasses).toBe(4);
});

it('clock in creates a shift; clock out shows only while the end is empty', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.press(await screen.findByText('上班'));
  const [shift] = await repo.listRecords('shifts');
  expect(shift?.values.start).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  await fireEvent.press(await screen.findByTestId(`row-action-${shift!.id}`));
  expect((await repo.getRecord(shift!.id))?.values.end).toMatch(/T\d\d:\d\d$/);
  expect(screen.queryByTestId(`row-action-${shift!.id}`)).toBeNull();
  // 撤销：结束时间又空了，「下班」回来。
  await fireEvent.press(screen.getByTestId('toast-undo'));
  expect(await screen.findByTestId(`row-action-${shift!.id}`)).toBeTruthy();
});

it('setAll asks first, changes only what differs, and undo puts every entry back', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'p1aaaaaa', 'packing', { item: '护照', packed: true });
  await put(repo, 'p2aaaaaa', 'packing', { item: '充电器', packed: true });
  await put(repo, 'p3aaaaaa', 'packing', { item: '袜子', packed: false });
  await renderToolsApp(repo, undefined, { seed });
  const alert = pressInAlert('修改');
  await fireEvent.press(await screen.findByText('全部取消'));
  expect(alert).toHaveBeenCalledWith(
    '全部取消',
    '将修改 2 条记录，之后可以撤销。',
    expect.anything(),
    expect.anything(),
  );
  expect(await screen.findByTestId('toast')).toHaveTextContent(/已修改 2 条记录/);
  expect((await repo.listRecords('packing')).map((r) => r.values.packed)).toEqual([
    false,
    false,
    false,
  ]);
  await fireEvent.press(screen.getByTestId('toast-undo'));
  expect((await repo.listRecords('packing')).map((r) => r.values.packed)).toEqual([
    true,
    true,
    false,
  ]);
});

it('setAll with nothing to change, or too many entries, changes nothing', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.press(await screen.findByText('全部取消'));
  expect(await screen.findByTestId('toast')).toHaveTextContent(/没有需要修改的记录/);
  for (let i = 0; i < 201; i++)
    await put(repo, `q${i}aaaaaa`, 'packing', { item: 'x', packed: true });
  const alert = pressInAlert('修改');
  await fireEvent.press(screen.getByText('全部取消'));
  expect(alert).toHaveBeenCalledWith('全部取消', '一次最多修改 200 条，这次会修改 201 条。');
  expect((await repo.listRecords('packing')).every((r) => r.values.packed === true)).toBe(true);
});

it('a row whose entry was deleted meanwhile says so and changes nothing', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'w1aaaaaa', 'water', { day: '2026-10-29', glasses: 3 });
  await renderToolsApp(repo, undefined, { seed });
  const plus = await screen.findByTestId('row-action-w1aaaaaa');
  await repo.deleteRecord('w1aaaaaa', Date.now());
  await fireEvent.press(plus);
  expect(await screen.findByTestId('toast')).toHaveTextContent(/这条记录已经删除。/);
  expect((await repo.getRecord('w1aaaaaa'))?.values.glasses).toBe(3);
});

it('French', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed, locale: 'fr' });
  await fireEvent.press(await screen.findByText('上班'));
  expect(await screen.findByTestId('toast')).toHaveTextContent(/Ajouté à « 工时 »/);
});
