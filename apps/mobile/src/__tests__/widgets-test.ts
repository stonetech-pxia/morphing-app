import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  type Collection,
  type DataRecord,
  type Op,
  type WorkspaceConfig,
} from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { actionHash } from '../widgets/ops';
import { buildWidgetSnapshot, REPEATS } from '../widgets/snapshot';
import type { PlacedWidget, WidgetSnapshot, WidgetView } from '../widgets/types';
import { drainMessage, runQueuedWidgetOps } from '../widgets/useWidgets';

// 桌面小组件（D-321–D-325）：画面按页面上同一份配置算；点了以后的画面预先算好；跨天换上明天那份；
// 小组件点的操作由 App 按点的时间执行。

const registry = createRegistry(BUILTIN_TOOLS);

const water: Collection = {
  id: 'water',
  name: '喝水',
  fields: [
    { id: 'day', name: '日期', type: 'date' },
    { id: 'glasses', name: '杯数', type: 'number' },
  ],
};
const habits: Collection = {
  id: 'habits',
  name: '习惯',
  fields: [
    { id: 'name', name: '名字', type: 'text' },
    { id: 'count', name: '次数', type: 'number' },
  ],
};

const add = (block: object) => ({ op: 'addContainer', page: 'home', block });

// 按钮和图块上的工具：配置里的写法和小组件指纹（actionHash）用同一份。
const DRINK = { do: 'create', table: 'water', values: { day: 'today' } } as const;
const PLUS_ONE = {
  as: 'tap',
  label: '+1',
  do: 'increment',
  table: 'habits',
  field: 'count',
  by: 1,
} as const;

function seed(extra: object[] = []): WorkspaceConfig {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [
      { op: 'addData', table: water },
      { op: 'addData', table: habits },
      add({
        id: 'water-today',
        look: 'number',
        show: { label: '今天喝水' },
        source: {
          table: 'water',
          aggregate: 'count',
          filter: [{ field: 'day', op: 'inPeriod', value: 'today' }],
          goal: 8,
        },
      }),
      add({
        id: 'drink',
        look: 'button',
        show: { label: '+1 杯水', variant: 'filled', icon: 'plus' },
        tools: [DRINK],
      }),
      add({
        id: 'habit-tiles',
        look: 'tiles',
        source: { table: 'habits', limit: 24 },
        show: { title: 'name', trailing: 'count', format: { kind: 'progress', goal: 2 } },
        tools: [PLUS_ONE],
      }),
      ...extra,
    ] as unknown as Op[],
    { registry, locale: 'zh' },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

const NOW = new Date(2026, 9, 30, 9, 0);
const placed = (...ids: string[]): PlacedWidget[] =>
  ids.map((componentId, i) => ({ componentId, placedAt: i }));
const rec = (id: string, collectionId: string, values: object, at = NOW.getTime()): DataRecord => ({
  id,
  collectionId,
  values: { ...values },
  createdAt: at,
  updatedAt: at,
});
const byTable = (...records: DataRecord[]) => {
  const map = new Map<string, DataRecord[]>([
    ['water', []],
    ['habits', []],
  ]);
  for (const r of records) map.get(r.collectionId)!.push(r);
  return map;
};

const build = (
  config: WorkspaceConfig,
  ids: string[],
  records = byTable(),
  locale: 'zh' | 'en' | 'fr' = 'zh',
) => buildWidgetSnapshot({ config, placed: placed(...ids), locale, registry, now: NOW, records });

const view = (snap: WidgetSnapshot, id: string, state = 0) => snap.states[state]!.views[id]!;
type Of<K extends WidgetView['kind']> = Extract<WidgetView, { kind: K }>;

it('a new user with nothing placed: no items, no actions, two days of (empty) views', async () => {
  const snap = await build(seed(), []);
  expect(snap.items).toEqual([]);
  expect(snap.ops).toEqual({});
  expect(snap.states).toHaveLength(2);
  expect(snap.states[0]!.until).toBe(snap.states[1]!.from);
  expect(snap.states[1]!.from).toBe(new Date(2026, 9, 31).getTime());
  expect(snap.colors.light.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
  // 风格固定浅色时，深色桌面上的小组件也要用深色那份（淡色不能还是浅色那份）。
  expect(snap.colors.dark.tint).not.toBe(snap.colors.light.tint);
});

it('a stat with a goal shows value / goal and a ring; a button tap is predicted on every widget', async () => {
  const snap = await build(
    seed(),
    ['water-today', 'drink'],
    byTable(rec('w1', 'water', { day: '2026-10-30' })),
  );
  expect(snap.items.map((i) => i.id)).toEqual(['water-today', 'drink']);
  const stat = view(snap, 'water-today') as Of<'stat'>;
  expect(stat).toMatchObject({ kind: 'stat', title: '今天喝水', ratio: 0.125, percent: '13%' });
  expect(stat.value).toContain('1');
  expect(stat.value).toContain('8');
  const button = view(snap, 'drink') as Of<'button'>;
  expect(button).toMatchObject({ kind: 'button', title: '+1 杯水', op: 'b:drink' });
  expect(button.note).toBeUndefined();
  expect(snap.ops['b:drink']).toEqual({ component: 'drink', hash: expect.any(String) });
  // 连点 1…4 次以后：统计跟着涨，按钮下面写「已记下」。
  const after = snap.states[0]!.after['b:drink']!;
  expect(after).toHaveLength(REPEATS);
  expect((after[0]!['water-today'] as Of<'stat'>).ratio).toBe(0.25);
  expect((after[3]!['water-today'] as Of<'stat'>).ratio).toBe(0.625);
  expect((after[0]!['drink'] as Of<'button'>).note).toBe('已记下');
});

it('tiles: each circle can be tapped; the ring fills as the entry reaches its goal', async () => {
  const records = byTable(
    rec('h1', 'habits', { name: '跑步', count: 1 }),
    rec('h2', 'habits', { name: '阅读', count: 2 }),
  );
  const snap = await build(seed(), ['habit-tiles'], records);
  const list = view(snap, 'habit-tiles') as Of<'list'>;
  expect(list.display).toBe('tiles');
  expect(list.rows.map((r) => [r.title, r.ratio, r.full, r.op])).toEqual(
    expect.arrayContaining([
      ['跑步', 0.5, false, 'r:habit-tiles:h1'],
      ['阅读', 1, true, 'r:habit-tiles:h2'],
    ]),
  );
  const tapped = snap.states[0]!.after['r:habit-tiles:h1']![0]!['habit-tiles'] as Of<'list'>;
  expect(tapped.rows.find((r) => r.id === 'h1')).toMatchObject({ ratio: 1, full: true });
});

it('edge cases: an unsupported component, a removed one, and an empty list say so', async () => {
  const config = seed([
    add({ id: 'note', look: 'text', show: { text: '你好' } }),
    add({
      id: 'plain-list',
      look: 'list',
      source: { table: 'water', limit: 5 },
      show: { title: 'day' },
    }),
  ]);
  const snap = await build(config, ['note', 'deleted-one', 'plain-list']);
  expect(view(snap, 'note')).toMatchObject({
    kind: 'message',
    note: expect.stringContaining('小组件显示不了'),
  });
  expect(view(snap, 'deleted-one')).toMatchObject({
    kind: 'message',
    title: 'deleted-one',
    note: expect.stringContaining('移除'),
  });
  expect(view(snap, 'plain-list')).toMatchObject({
    kind: 'list',
    display: 'list',
    rows: [],
    empty: expect.any(String),
  });
});

it('across midnight: tomorrow’s view is ready in advance, and today’s count starts over', async () => {
  const snap = await build(
    seed(),
    ['water-today'],
    byTable(rec('w1', 'water', { day: '2026-10-30' })),
  );
  expect((view(snap, 'water-today', 0) as Of<'stat'>).ratio).toBe(0.125);
  expect((view(snap, 'water-today', 1) as Of<'stat'>).ratio).toBe(0);
});

it('French: the widget text follows the app language', async () => {
  const snap = await build(seed(), ['water-today', 'drink'], byTable(), 'fr');
  expect(snap.strings.stale).toBe('Ouvrez Morph pour mettre à jour');
  expect((snap.states[0]!.after['b:drink']![0]!['drink'] as Of<'button'>).note).toBe('Enregistré');
});

describe('running the taps the widget queued', () => {
  const tap = (op: string, component: string, hash: string, at: number, record?: string) =>
    JSON.stringify({ op, component, hash, at, ...(record ? { record } : {}) });

  it('creates entries at the time of the tap (yesterday’s tap counts for yesterday) and can undo them together', async () => {
    const config = seed();
    const repo = new MemoryWorkspaceRepo();
    const hash = actionHash(DRINK);
    const yesterday = new Date(2026, 9, 29, 23, 50).getTime();
    const result = await runQueuedWidgetOps(
      [tap('b:drink', 'drink', hash, NOW.getTime()), tap('b:drink', 'drink', hash, yesterday)],
      repo,
      config,
      NOW,
    );
    expect(result).toMatchObject({ done: 2, skipped: 0 });
    const list = (await repo.listRecords('water')).sort((a, b) => a.createdAt - b.createdAt);
    expect(list.map((r) => [r.values.day, r.createdAt])).toEqual([
      ['2026-10-29', yesterday],
      ['2026-10-30', NOW.getTime()],
    ]);
    expect(result!.undo.discard).toHaveLength(2);
    expect(drainMessage(result!, 'zh')).toBe('记下了桌面小组件上的 2 次点按');
    expect(drainMessage({ ...result!, done: 1 }, 'en')).toBe(
      'Recorded 1 tap from the Home Screen widget',
    );
  });

  it('increments one after another from the stored value; undo goes back to before the first tap', async () => {
    const config = seed();
    const repo = new MemoryWorkspaceRepo();
    await repo.insertRecord(rec('h1', 'habits', { name: '跑步', count: 1 }));
    const hash = actionHash(PLUS_ONE);
    const result = await runQueuedWidgetOps(
      [1, 2, 3].map((k) => tap('r:habit-tiles:h1', 'habit-tiles', hash, NOW.getTime() + k, 'h1')),
      repo,
      config,
      NOW,
    );
    expect(result).toMatchObject({ done: 3 });
    expect((await repo.getRecord('h1'))?.values.count).toBe(4);
    expect(result!.undo.records).toEqual([{ id: 'h1', values: { name: '跑步', count: 1 } }]);
  });

  it('skips taps whose button changed or is gone, and broken lines, and says how many', async () => {
    const config = seed();
    const repo = new MemoryWorkspaceRepo();
    const result = await runQueuedWidgetOps(
      [
        tap('b:drink', 'drink', 'old-hash', NOW.getTime()),
        tap('b:gone', 'gone', 'x', NOW.getTime()),
        tap('r:habit-tiles:nope', 'habit-tiles', 'x', NOW.getTime(), 'nope'),
        '{not json',
      ],
      repo,
      config,
      NOW,
    );
    expect(result).toMatchObject({ done: 0, skipped: 4 });
    expect(await repo.listRecords('water')).toEqual([]);
    expect(drainMessage(result!, 'fr')).toBe(
      '4 appuis sur le widget n’ont pas été enregistrés, car la page a changé',
    );
    expect(await runQueuedWidgetOps([], repo, config, NOW)).toBeNull();
  });
});
