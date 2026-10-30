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

// 记录列表的大圆块（D-311、D-312）和看板（D-313、D-314）。拖动本身要在模拟器上测，这里测点按和「移到…」。

const habits: Collection = {
  id: 'habits',
  name: '习惯',
  fields: [
    { id: 'name', name: '名字', type: 'text' },
    { id: 'today', name: '今天', type: 'number' },
    { id: 'goal', name: '目标', type: 'number' },
  ],
};
const tasks: Collection = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'title', name: '标题', type: 'text' },
    {
      id: 'status',
      name: '状态',
      type: 'choice',
      options: [
        { id: 'todo', label: '待办' },
        { id: 'doing', label: '进行中' },
        { id: 'done', label: '完成' },
      ],
    },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData', table: habits },
      { op: 'addData', table: tasks },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'grid',
          look: 'tiles',
          source: { table: 'habits', limit: 100 },
          show: { title: 'name', trailing: 'today', format: { kind: 'progress', goal: 'goal' } },
          tools: [
            { as: 'tap', label: '打卡', do: 'increment', table: 'habits', field: 'today', by: 1 },
          ],
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'board',
          look: 'board',
          source: { table: 'tasks', group: { by: 'status' }, limit: 30 },
          show: { title: 'title' },
          tools: [{ as: 'drag', do: 'set', table: 'tasks', field: 'status', value: '$group' }],
        },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config as never;
};

const at = Date.now();
const put = (repo: MemoryWorkspaceRepo, id: string, collectionId: string, values: object) =>
  repo.insertRecord({ id, collectionId, values: { ...values }, createdAt: at, updatedAt: at });

it('a new user sees the empty text for tiles and empty columns on the board', async () => {
  await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
  expect(await screen.findByText('还没有记录')).toBeTruthy();
  for (const name of ['待办', '进行中', '完成', '未分'])
    expect(await screen.findByText(name)).toBeTruthy();
  expect(screen.getAllByText('这一栏没有记录')).toHaveLength(4);
});

it('tapping a tile runs its row action, fills the circle at the goal, and undo puts it back', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'run', 'habits', { name: '跑步', today: 1, goal: 2 });
  await renderToolsApp(repo, undefined, { seed });
  expect(await screen.findByText('1 / 2')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('tile-run'));
  expect(await screen.findByText('2 / 2')).toBeTruthy();
  expect((await repo.getRecord('run'))?.values.today).toBe(2);
  expect(await screen.findByTestId('toast')).toHaveTextContent(/打卡：已记下/);
  await fireEvent.press(await screen.findByText('撤销'));
  expect(await screen.findByText('1 / 2')).toBeTruthy();
  expect((await repo.getRecord('run'))?.values.today).toBe(1);
});

it('long-pressing a tile with a row action opens its entry instead of editing the page (D-311)', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'run', 'habits', { name: '跑步', today: 1, goal: 2 });
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent(await screen.findByTestId('tile-run'), 'longPress');
  expect(await screen.findByDisplayValue('跑步')).toBeTruthy();
  expect(screen.queryByTestId('single-toolbar-grid')).toBeNull();
  // 长按只是打开，不打卡。
  expect((await repo.getRecord('run'))?.values.today).toBe(1);
});

it('long-pressing the tiles outside a circle still edits the component (D-235)', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'run', 'habits', { name: '跑步', today: 1, goal: 2 });
  await renderToolsApp(repo, undefined, { seed });
  await screen.findByTestId('tile-run');
  await fireEvent(screen.getByTestId('component-grid'), 'longPress');
  expect(await screen.findByTestId('single-toolbar-grid')).toBeTruthy();
});

it('shows at most 24 tiles (D-312)', async () => {
  const repo = new MemoryWorkspaceRepo();
  for (let i = 0; i < 30; i++) await put(repo, `h${i}`, 'habits', { name: `习惯${i}`, goal: 1 });
  await renderToolsApp(repo, undefined, { seed });
  await screen.findByTestId('tile-h0');
  expect(screen.queryAllByTestId(/^tile-h\d+$/)).toHaveLength(24);
});

it('moves a card with "Move to…" without dragging, and undo moves it back', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 't1', 'tasks', { title: '写报告', status: 'todo' });
  await put(repo, 't2', 'tasks', { title: '没分的' });
  await renderToolsApp(repo, undefined, { seed });
  await fireEvent.press(await screen.findByTestId('board-card-t1'));
  // 菜单里没有它现在所在的「待办」。
  expect(screen.queryByTestId('board-menu-to:todo')).toBeNull();
  expect(screen.getByTestId('board-menu-to:')).toHaveTextContent('移到「未分」');
  await fireEvent.press(screen.getByTestId('board-menu-to:doing'));
  expect(await screen.findByTestId('toast')).toHaveTextContent(/已移到「进行中」/);
  expect((await repo.getRecord('t1'))?.values).toEqual({ title: '写报告', status: 'doing' });
  await fireEvent.press(await screen.findByText('撤销'));
  await screen.findByTestId('board-card-t1');
  expect((await repo.getRecord('t1'))?.values).toEqual({ title: '写报告', status: 'todo' });
  // 「未分」里的卡片移到一个选项。
  await fireEvent.press(screen.getByTestId('board-card-t2'));
  await fireEvent.press(screen.getByTestId('board-menu-to:done'));
  await screen.findByText('已移到「完成」');
  expect((await repo.getRecord('t2'))?.values.status).toBe('done');
});

it('a screen reader can move a card straight from its actions', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 't1', 'tasks', { title: '写报告', status: 'todo' });
  await renderToolsApp(repo, undefined, { seed });
  const card = await screen.findByTestId('board-card-t1');
  await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'move:done' } });
  await screen.findByText('已移到「完成」');
  expect((await repo.getRecord('t1'))?.values.status).toBe('done');
});

it('in French: "Non classé", the move menu and the undo toast', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 't1', 'tasks', { title: 'Rapport', status: 'todo' });
  await renderToolsApp(repo, undefined, { seed, locale: 'fr' });
  expect(await screen.findByText('Non classé')).toBeTruthy();
  expect(screen.getAllByText('Aucune entrée dans cette colonne')).toHaveLength(3);
  await fireEvent.press(await screen.findByTestId('board-card-t1'));
  expect(screen.getByTestId('board-menu-open')).toHaveTextContent('Ouvrir');
  expect(screen.getByTestId('board-menu-to:doing')).toHaveTextContent('Déplacer dans « 进行中 »');
  await fireEvent.press(screen.getByTestId('board-menu-to:doing'));
  expect(await screen.findByTestId('toast')).toHaveTextContent(/Déplacé dans « 进行中 »/);
  expect(await screen.findByText('Annuler')).toBeTruthy();
});
