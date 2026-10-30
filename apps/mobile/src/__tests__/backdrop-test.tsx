import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  BUILTIN_TOOLS,
  createMockAIProvider,
  createRegistry,
  overlayOpacity,
  resolveColors,
  type AIProvider,
  type Op,
} from '@morph/core';
import { createClaudePlanner, type PlannerMessage } from '@morph/planner';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import { BACKDROP_SIDE } from '../renderer/Backdrop';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore, type WorkspaceStore } from '../workspace/store';

// 图片背景（D-258）：AI 只能打开、关掉、调遮罩；图片由用户在长按编辑里选、换、移除，存成用户文件，
// 配置里只有 ID。图片上的文字用正文色，遮罩保证对比度。

const registry = createRegistry(BUILTIN_TOOLS);

beforeEach(() => {
  jest
    .requireActual('@react-native/jest-preset/jest/MockNativeMethods')
    .default.measureLayout.mockImplementation(
      (_to: unknown, success: (x: number, y: number, w: number, h: number) => void) =>
        success(20, 100, 320, 40),
    );
});
afterEach(() => jest.restoreAllMocks());

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

async function renderApp(provider: AIProvider = createMockAIProvider()) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider,
    registry,
    locale: 'zh',
    now: () => new Date(),
  });
  await store.getState().boot();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack />
          </GestureHandlerRootView>
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
  });
  return { repo, store, files };
}

async function commit(store: WorkspaceStore, ops: Op[], summary: string) {
  expect((await store.getState().proposeOps(ops, summary)).kind).toBe('preview');
  await store.getState().confirm();
  expect(await screen.findByText(`已改好：${summary}`)).toBeTruthy();
}

const NOTE: Op = {
  op: 'addContainer',
  page: 'home',
  index: 0,
  block: {
    id: 'tip',
    look: 'notice',
    show: { title: '喝水', text: '每天八杯' },
    style: { backdrop: { overlay: 'medium' } },
  },
};
const home = (store: WorkspaceStore) => store.getState().config!.containers.pages[0]!;
const tipStyle = (store: WorkspaceStore) =>
  (home(store).blocks.find((c) => c.id === 'tip') as { style?: Record<string, unknown> }).style;

/** 长按 → 编辑：打开这个组件的操作面板。 */
async function openSheet(id: string) {
  await fireEvent(screen.getByTestId(`component-${id}`), 'longPress');
  await fireEvent.press(await screen.findByTestId(`single-edit-${id}`));
  expect(await screen.findByTestId('edit-sheet')).toBeTruthy();
}
async function done(id: string) {
  await fireEvent.press(screen.getByTestId(`single-done-${id}`));
  expect(await screen.findByText('已改好：编辑「首页」（1 处修改）')).toBeTruthy();
}

const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('picture backgrounds', () => {
  it('a card turned on by AI shows its color until the user picks a picture in the long-press sheet', async () => {
    const { repo, store, files } = await renderApp();
    await commit(store, [NOTE], '加提示');
    // 开着但还没有图片：照常显示底色。
    expect(screen.queryByTestId('backdrop-picture')).toBeNull();

    await openSheet('tip');
    files.nextImage = files.offer('IMG_7.jpg', photo, 'image/jpeg');
    await fireEvent.press(screen.getByTestId('edit-backdrop-choose'));
    expect(await screen.findByTestId('backdrop-picture')).toBeTruthy();
    // 卡片的图片缩到 1200 以内再存。
    expect(files.imageSides).toEqual([BACKDROP_SIDE.card]);
    await done('tip');

    const [asset] = await repo.listAssets();
    expect(asset).toMatchObject({ name: 'IMG_7.jpg', source: 'picked' });
    expect(tipStyle(store)).toEqual({ backdrop: { overlay: 'medium', assetId: asset!.id } });
    expect(JSON.stringify(store.getState().config)).not.toContain('IMG_7');

    // 遮罩是卡片的底色，不透明度保证正文过对比度检查；图片上的文字用正文色。
    const c = resolveColors(store.getState().config!.theme, false);
    expect(StyleSheet.flatten(screen.getByTestId('backdrop-overlay').props.style)).toMatchObject({
      backgroundColor: c.secondaryTint,
      opacity: overlayOpacity('medium', c.secondaryTint, c.text),
    });
    expect(StyleSheet.flatten(screen.getByText('喝水').props.style).color).toBe(c.text);
  });

  it('overlay, remove and turn off from the sheet; undo brings the picture back; the file is kept', async () => {
    const { repo, store, files } = await renderApp();
    await commit(store, [NOTE], '加提示');
    await openSheet('tip');
    files.nextImage = files.offer('IMG_7.jpg', photo, 'image/jpeg');
    await fireEvent.press(screen.getByTestId('edit-backdrop-choose'));
    await screen.findByTestId('backdrop-picture');
    // 选好图片面板就关了；再点「编辑」。调遮罩时面板不关，可以连着试。
    await fireEvent.press(await screen.findByTestId('single-edit-tip'));
    await fireEvent.press(screen.getByTestId('edit-backdrop-overlay-strong'));
    expect(screen.getByTestId('edit-sheet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-backdrop-remove'));
    await waitFor(() => expect(screen.queryByTestId('backdrop-picture')).toBeNull());
    await fireEvent.press(screen.getByTestId('edit-backdrop-off'));
    await done('tip');
    expect(tipStyle(store)).toBeUndefined();
    expect(await repo.listAssets()).toHaveLength(1);

    await fireEvent.press(await screen.findByText('撤销'));
    await waitFor(() => expect(tipStyle(store)).toEqual({ backdrop: { overlay: 'medium' } }));
  });

  it('a page picture: AI turns it on, the user picks it from any component sheet, text uses the text color in dark mode', async () => {
    const { store, files } = await renderApp();
    await commit(
      store,
      [
        { op: 'setTheme', mode: 'dark' },
        { op: 'updateContainer', page: 'home', changes: { backdrop: { overlay: 'light' } } },
      ],
      '深色加背景',
    );
    expect(screen.queryByTestId('backdrop-picture')).toBeNull();
    const first = home(store).blocks[0]!.id;
    await openSheet(first);
    files.nextImage = files.offer('wall.jpg', photo, 'image/jpeg');
    await fireEvent.press(screen.getByTestId('edit-page-backdrop-choose'));
    expect(await screen.findByTestId('backdrop-picture')).toBeTruthy();
    expect(files.imageSides).toEqual([BACKDROP_SIDE.page]);
    await done(first);
    expect(home(store).backdrop).toMatchObject({ overlay: 'light', assetId: expect.any(String) });

    const c = resolveColors(store.getState().config!.theme, true);
    expect(StyleSheet.flatten(screen.getByTestId('backdrop-overlay').props.style)).toMatchObject({
      backgroundColor: c.background,
      opacity: overlayOpacity('light', c.background, c.text),
    });
  });

  it('components that are not cards cannot have one', async () => {
    const { store } = await renderApp();
    const first = home(store).blocks.find((c) => c.look === 'header')!;
    const result = await store.getState().proposeOps(
      [
        {
          op: 'updateContainer',
          page: 'home',
          block: first.id,
          changes: { style: { backdrop: { overlay: 'medium' } } },
        },
      ],
      '标题加背景',
    );
    expect(result.kind).toBe('invalid');
  });

  it('the model sees that a picture is set, never which one', async () => {
    const sent: PlannerMessage[][] = [];
    const planner = createClaudePlanner({
      registry,
      now: () => new Date(),
      complete: async (messages) => {
        sent.push(JSON.parse(JSON.stringify(messages)));
        const text = JSON.stringify({ kind: 'ops', ops: [{ op: 'setTheme', radius: 8 }] });
        return {
          text,
          stopReason: 'end_turn',
          content: [{ type: 'text', text }],
          model: 'test',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    });
    const { store, files } = await renderApp(planner);
    await commit(store, [NOTE], '加提示');
    await openSheet('tip');
    files.nextImage = files.offer('张三家-SECRET.jpg', photo, 'image/jpeg');
    await fireEvent.press(screen.getByTestId('edit-backdrop-choose'));
    await done('tip');
    expect((await store.getState().propose('圆角小一点')).kind).toBe('preview');
    const request = JSON.stringify(sent);
    expect(request).toContain('backdrop');
    for (const secret of ['张三', 'SECRET', '.jpg']) expect(request).not.toContain(secret);
  });
});
