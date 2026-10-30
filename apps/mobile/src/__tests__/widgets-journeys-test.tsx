import { applyOps, createDefaultWorkspace, type Locale, type Op, type Registry } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { directEditEntry } from '../editing/entry';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';
import { actionHash } from '../widgets/ops';
import { useWidgetPlacement } from '../widgets/placed';
import type { WidgetPlatform, WidgetSnapshot } from '../widgets/types';

// 桌面小组件在 App 里（D-323、D-325）：打开 App 时执行小组件上点了的操作，一起撤销；
// 长按组件「放到桌面」只记在本机，画面跟着写出去；不支持的组件说明能放哪几种。

const action = { do: 'create', collectionId: 'water', values: { day: 'today' } };
const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      {
        op: 'addCollection',
        collection: {
          id: 'water',
          name: '喝水',
          fields: [{ id: 'day', name: '日期', type: 'date' }],
        },
      },
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'drink',
          type: 'button',
          props: { label: '+1 杯水', variant: 'filled', action },
        },
      },
      {
        op: 'addComponent',
        pageId: 'home',
        component: { id: 'hello', type: 'text', props: { text: '你好' } },
      },
    ] as unknown as Op[],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config as never;
};

function fakeWidgets(queue: string[] = [], canPin = false) {
  const written: string[] = [];
  const platform: WidgetPlatform & { written: string[] } = {
    written,
    setSnapshot: jest.fn(async (json: string) => void written.push(json)),
    takeQueue: jest.fn(async () => queue.splice(0)),
    canPin: () => canPin,
    pin: jest.fn(async () => true),
    onQueue: () => () => undefined,
  };
  return platform;
}

const last = (p: { written: string[] }) => JSON.parse(p.written.at(-1)!) as WidgetSnapshot;

async function openEditSheet(id: string) {
  await fireEvent.press(await screen.findByTestId('page-edit'));
  await fireEvent.press(await screen.findByTestId(`arrange-edit-${id}`));
  expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
}

// 整页编辑入口在 App 里关着（D-235），测试里打开它进组件的操作面板。
beforeAll(() => {
  directEditEntry.pageButton = true;
});
afterAll(() => {
  directEditEntry.pageButton = false;
});
beforeEach(() => useWidgetPlacement.setState({ placed: null, repo: null }));
afterEach(() => jest.restoreAllMocks());

it('Add to Home Screen is the user’s own step: kept on this device, written to the widget, explained on iOS', async () => {
  const repo = new MemoryWorkspaceRepo();
  const widgets = fakeWidgets();
  await renderToolsApp(repo, undefined, { seed, widgets });
  // 新用户：还没放过，画面里没有组件。
  await waitFor(() => expect(widgets.written.length).toBeGreaterThan(0));
  expect(last(widgets).items).toEqual([]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await openEditSheet('drink');
  await fireEvent.press(screen.getByTestId('edit-widget'));
  expect(alert).toHaveBeenCalledWith('已加进小组件列表', expect.stringContaining('编辑小组件'));
  expect(JSON.parse((await repo.getMeta('widgets.placed'))!)).toEqual([
    { componentId: 'drink', placedAt: expect.any(Number) },
  ]);
  await waitFor(() => expect(last(widgets).items.map((i) => i.id)).toEqual(['drink']));
  expect(last(widgets).states[0]!.views.drink).toMatchObject({ kind: 'button', op: 'b:drink' });
  // 再点一次是移除。
  expect(screen.getByTestId('edit-widget')).toHaveTextContent('从桌面移除');
  await fireEvent.press(screen.getByTestId('edit-widget'));
  await waitFor(() => expect(last(widgets).items).toEqual([]));
  // AI 改不到：配置里没有任何放到桌面的记录。
  expect(JSON.stringify(await repo.getHead())).not.toContain('widgets.placed');
});

it('Android asks the launcher to pin the widget instead of explaining', async () => {
  const widgets = fakeWidgets([], true);
  await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed, widgets });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await openEditSheet('drink');
  await act(() => fireEvent.press(screen.getByTestId('edit-widget')));
  expect(widgets.pin).toHaveBeenCalledWith('drink', expect.any(String));
  expect(alert).not.toHaveBeenCalled();
});

it('a component a widget can’t show says which ones it can, and is not placed', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed, widgets: fakeWidgets() });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await openEditSheet('hello');
  await fireEvent.press(screen.getByTestId('edit-widget'));
  expect(alert).toHaveBeenCalledWith(
    '这个组件还不能放到桌面',
    expect.stringContaining('统计、按钮和记录列表'),
  );
  expect(await repo.getMeta('widgets.placed')).toBeNull();
});

it('without the native module (Expo Go, web) there is no Add to Home Screen', async () => {
  await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
  await openEditSheet('drink');
  expect(screen.queryByTestId('edit-widget')).toBeNull();
});

it('taps queued on the widget are recorded when Morph opens, and one undo takes them all back', async () => {
  const repo = new MemoryWorkspaceRepo();
  const at = Date.now() - 60_000;
  const tap = JSON.stringify({
    op: 'b:drink',
    component: 'drink',
    hash: actionHash(action as never),
    at,
  });
  const widgets = fakeWidgets([tap, tap]);
  await renderToolsApp(repo, undefined, { seed, widgets });
  expect(await screen.findByTestId('toast')).toHaveTextContent(/记下了桌面小组件上的 2 次点按/);
  expect((await repo.listRecords('water')).map((r) => r.createdAt)).toEqual([at, at]);
  await fireEvent.press(screen.getByTestId('toast-undo'));
  await waitFor(async () => expect(await repo.listRecords('water')).toEqual([]));
});
