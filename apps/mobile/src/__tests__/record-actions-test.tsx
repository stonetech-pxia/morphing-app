import {
  applyOps,
  createDefaultWorkspace,
  localDate,
  type Collection,
  type Locale,
  type Op,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
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

const button = (id: string, label: string, action: object): Op =>
  ({
    op: 'addContainer',
    page: 'home',
    block: { id, look: 'button', show: { label, variant: 'filled' }, tools: [action] },
  }) as Op;
const list = (id: string, table: string, title: string, tools?: object[]): Op =>
  ({
    op: 'addContainer',
    page: 'home',
    block: { id, look: 'list', source: { table, limit: 100 }, show: { title }, tools },
  }) as Op;

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      ...[checkins, water, shifts, packing].map((table) => ({
        op: 'addData' as const,
        table,
      })),
      button('check', '打卡跑步', {
        do: 'create',
        table: 'checkins',
        values: { habit: 'run', day: 'today' },
      }),
      button('clock-in', '上班', {
        do: 'create',
        table: 'shifts',
        values: { start: 'now' },
      }),
      button('unpack', '全部取消', {
        do: 'setAll',
        table: 'packing',
        field: 'packed',
        value: false,
      }),
      list('water-list', 'water', 'day', [
        { as: 'button', label: '+1', do: 'increment', table: 'water', field: 'glasses', by: 1 },
      ]),
      list('shift-list', 'shifts', 'start', [
        {
          as: 'button',
          label: '下班',
          do: 'set',
          table: 'shifts',
          field: 'end',
          value: 'now',
          when: [{ field: 'end', op: 'isEmpty' }],
        },
      ]),
      list('checkin-list', 'checkins', 'day'),
    ],
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

// 底线 11（创始人 2026-10-31）：只有删除弹撤销；一键记下的、改过的，用户自己删掉或改回去。
it('a new user: one tap logs a habit for today, with no undo', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.press(await screen.findByText('打卡跑步'));
  expect(await screen.findByTestId('toast')).toHaveTextContent(/已在「打卡」添加一条/);
  expect(screen.queryByTestId('toast-undo')).toBeNull();
  const [record] = await repo.listRecords('checkins');
  expect(record?.values).toEqual({ habit: 'run', day: localDate(new Date()) });
});

it('+1 on a row adds up quick taps one after another, with no undo', async () => {
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
  expect(screen.queryByTestId('toast-undo')).toBeNull();
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
  expect(screen.queryByTestId('toast-undo')).toBeNull();
});

it('setAll asks first, changes only what differs, and shows no undo afterwards', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'p1aaaaaa', 'packing', { item: '护照', packed: true });
  await put(repo, 'p2aaaaaa', 'packing', { item: '充电器', packed: true });
  await put(repo, 'p3aaaaaa', 'packing', { item: '袜子', packed: false });
  await renderToolsApp(repo, undefined, { seed });
  const alert = pressInAlert('修改');
  await fireEvent.press(await screen.findByText('全部取消'));
  expect(alert).toHaveBeenCalledWith(
    '全部取消',
    '将修改 2 条记录。',
    expect.anything(),
    expect.anything(),
  );
  expect(await screen.findByTestId('toast')).toHaveTextContent(/已修改 2 条记录/);
  expect((await repo.listRecords('packing')).map((r) => r.values.packed)).toEqual([
    false,
    false,
    false,
  ]);
  expect(screen.queryByTestId('toast-undo')).toBeNull();
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

describe('v34: tools on blocks', () => {
  // 一张卡片列表（喝水）每条上两种工具：「清零」改这一条，「记一次」往另一张表（记录）新建一条、
  // 引用这一条（关系规则 12：写到别的表时要有引用字段设成 "$row"）。
  const logs: Collection = {
    id: 'logs',
    name: '记录',
    fields: [
      { id: 'cup', name: '哪天', type: 'link', table: 'water' },
      { id: 'day', name: '日期', type: 'date' },
    ],
  };
  const cardsSeed = (locale: Locale, registry: Registry) => {
    const result = applyOps(
      createDefaultWorkspace(locale),
      [
        { op: 'addData', table: checkins },
        { op: 'addData', table: water },
        { op: 'addData', table: logs },
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'water-cards',
            look: 'cards',
            source: { table: 'water', limit: 10 },
            show: { title: 'day' },
            tools: [
              {
                as: 'button',
                label: '清零',
                do: 'set',
                table: 'water',
                field: 'glasses',
                value: 0,
                when: [{ field: 'glasses', op: 'gt', value: 5 }],
              },
              {
                as: 'button',
                label: '记一次',
                do: 'create',
                table: 'logs',
                values: { cup: '$row', day: 'today' },
              },
            ],
          },
        },
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'add-run',
            look: 'button',
            show: { label: '添加跑步', variant: 'filled' },
            tools: [
              {
                do: 'create',
                table: 'checkins',
                ask: 'all',
                values: { habit: 'run', day: 'today' },
              },
            ],
          },
        },
      ],
      { registry, locale },
    );
    if (!result.ok) throw new Error(result.error);
    return result.config;
  };

  it('a tool on a card writes the table named in the tool, not the list it sits on', async () => {
    const repo = new MemoryWorkspaceRepo();
    await put(repo, 'w1aaaaaa', 'water', { day: '2026-10-29', glasses: 3 });
    await put(repo, 'w2aaaaaa', 'water', { day: '2026-10-30', glasses: 8 });
    await renderToolsApp(repo, undefined, { seed: cardsSeed });
    // 3 杯那条只显示「记一次」（清零的条件不满足）：新的一条在记录表里、引用这一条，喝水表不变。
    const log = await screen.findByTestId('row-action-w1aaaaaa');
    expect(log).toHaveTextContent('记一次');
    await fireEvent.press(log);
    expect(await screen.findByTestId('toast')).toHaveTextContent(/已在「记录」添加一条/);
    expect((await repo.listRecords('logs')).map((r) => r.values)).toEqual([
      { cup: 'w1aaaaaa', day: localDate(new Date()) },
    ]);
    expect((await repo.getRecord('w1aaaaaa'))?.values).toEqual({ day: '2026-10-29', glasses: 3 });
    // 8 杯那条显示「清零」：改的是这一条自己。
    const reset = screen.getByTestId('row-action-w2aaaaaa');
    expect(reset).toHaveTextContent('清零');
    await fireEvent.press(reset);
    expect((await repo.getRecord('w2aaaaaa'))?.values.glasses).toBe(0);
    expect(await repo.listRecords('logs')).toHaveLength(1);
  });

  it('a button that opens the full add form fills in its preset values first (Q6)', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { router } = await renderToolsApp(repo, undefined, { seed: cardsSeed });
    await fireEvent.press(await screen.findByText('添加跑步'));
    await waitFor(() => expect(router.getPathname()).toBe('/record/checkins'));
    // v33 打开的是空表单；v34 预设的习惯和日期先填好，用户补完再保存（没有直接存）。
    expect(JSON.parse(router.getSearchParams().prefill as string)).toEqual({
      habit: 'run',
      day: localDate(new Date()),
    });
    expect(await repo.listRecords('checkins')).toEqual([]);
  });

  // 底线 11（创始人 2026-10-31）：用户在表单里确认过、存下的，不弹撤销（新建到另一张表也一样）。
  it('saving the add form a button opened into another table shows no undo', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { router } = await renderToolsApp(repo, undefined, { seed: cardsSeed });
    await fireEvent.press(await screen.findByText('添加跑步'));
    await waitFor(() => expect(router.getPathname()).toBe('/record/checkins'));
    await fireEvent.press(await screen.findByTestId('editor-save'));
    await waitFor(async () => expect(await repo.listRecords('checkins')).toHaveLength(1));
    await waitFor(() => expect(router.getPathname()).not.toBe('/record/checkins'));
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});
