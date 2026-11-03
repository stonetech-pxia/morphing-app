import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  BUILTIN_TOOLS,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_THEME,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type Op,
  type Theme,
} from '@morph/core';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import HomeRoute from '../app/index';
import { makePalette, onPage, onSurface } from '../renderer/theme';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 卡片单独的文字颜色（D-409）：放在卡片上的文字用 surfaceText，放在页面背景上的用 text。
// 断言看真正画出来的颜色，每种块都要走到；没设 surfaceText 的主题一个像素都不变。

const registry = createRegistry(BUILTIN_TOOLS);
const PAGE = '#F5EFE0';
const INK = '#2A2420';
const FOREST: Theme = {
  ...DEFAULT_THEME,
  colors: { background: '#0B3D2E', surface: '#F5EFE0', text: PAGE, surfaceText: INK },
};

const memorySecrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

const color = (text: string) =>
  StyleSheet.flatten(screen.getByText(text).props.style).color as string;

/** 一张表、一页把每种放卡片和放页面上的块都摆上。 */
const BLOCKS: Op[] = [
  {
    op: 'addData',
    table: {
      id: 'spend',
      name: '记账',
      fields: [
        { id: 'item', name: '项目', type: 'text' },
        { id: 'kind', name: '类别', type: 'choice', options: [{ id: 'food', label: '吃饭' }] },
        { id: 'place', name: '地方', type: 'choice', options: [{ id: 'home', label: '家里' }] },
      ],
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 0,
    block: { id: 'title', look: 'header', show: { title: '页面标题', subtitle: '页面副标题' } },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 1,
    block: { id: 'para', look: 'text', show: { text: '页面上的说明' } },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 2,
    block: {
      id: 'tip',
      look: 'notice',
      style: { tone: 'primary' },
      show: { title: '提示标题', text: '提示内容' },
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 3,
    block: {
      id: 'stat',
      look: 'number',
      show: { label: '笔数' },
      source: { table: 'spend', aggregate: 'count' },
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 4,
    block: {
      id: 'empty-list',
      look: 'list',
      show: { title: 'item', emptyText: '列表还是空的' },
      source: { table: 'spend', limit: 5 },
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 5,
    block: {
      id: 'board',
      look: 'board',
      show: { title: 'item' },
      source: { table: 'spend', limit: 5, group: { by: 'kind' } },
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 6,
    block: {
      id: 'sections',
      look: 'list',
      show: { title: 'item' },
      source: { table: 'spend', limit: 5, group: { by: 'place', showEmpty: true } },
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    index: 7,
    block: {
      id: 'go',
      look: 'entry',
      show: { icon: 'apps', title: '入口标题', subtitle: '入口说明' },
      opens: 'settings',
    },
  },
];

async function renderHome(theme: Theme) {
  const repo = new MemoryWorkspaceRepo();
  const aiSettings = createAISettingsStore({ secrets: memorySecrets(), serverAvailable: false });
  await aiSettings.getState().load();
  const store = createWorkspaceStore({
    repo,
    provider: createMockAIProvider(),
    registry,
    locale: 'zh',
    now: () => new Date(),
  });
  await store.getState().boot();
  const result = await store.getState().proposeOps(
    [
      ...BLOCKS,
      {
        op: 'setTheme',
        colors: { background: null, surface: null, text: null, ...theme.colors },
      },
    ],
    '换主题',
  );
  if (result.kind !== 'preview') throw new Error(JSON.stringify(result));
  await store.getState().confirm();
  await renderRouter({
    _layout: () => (
      <AISettingsProvider store={aiSettings}>
        <WorkspaceProvider value={{ store, repo, files: new FakeFiles(), registry, locale: 'zh' }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack />
          </GestureHandlerRootView>
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
  });
  await screen.findByText('页面标题');
}

describe('card text color (D-409)', () => {
  it('text on cards uses surfaceText, text on the page uses text', async () => {
    await renderHome(FOREST);
    const card = onSurface(makePalette(FOREST, false));
    const page = makePalette(FOREST, false);
    // 页面背景上的。
    expect(color('页面标题')).toBe(PAGE);
    expect(color('页面副标题')).toBe(page.muted);
    expect(color('家里')).toBe(PAGE);
    // 卡片上的。
    expect(color('入口标题')).toBe(INK);
    expect(color('入口说明')).toBe(card.muted);
    expect(color('提示标题')).toBe(INK);
    expect(color('列表还是空的')).toBe(card.caption);
    expect(screen.getByTestId('stat-value-spend-笔数')).toHaveStyle({ color: INK });
    expect(color('笔数')).toBe(card.primaryText);
    expect(color('吃饭')).toBe(INK);
  });

  it('a theme without surfaceText draws cards and page with one text color', async () => {
    const plain: Theme = { ...DEFAULT_THEME, colors: { text: '#111111' } };
    await renderHome(plain);
    const palette = makePalette(plain, false);
    expect(onSurface(palette)).toBe(palette);
    expect(onPage(palette)).toBe(palette);
    expect(color('页面标题')).toBe('#111111');
    expect(color('入口标题')).toBe('#111111');
    expect(color('入口说明')).toBe(palette.muted);
    expect(color('页面副标题')).toBe(palette.muted);
  });

  it('the default theme has the same palette with or without the new field', () => {
    const palette = makePalette(createDefaultWorkspace('zh').theme, false);
    expect(palette.surfacePalette).toBeUndefined();
    expect(palette.pagePalette).toBeUndefined();
    expect(CURRENT_SCHEMA_VERSION).toBe(36);
  });
});
