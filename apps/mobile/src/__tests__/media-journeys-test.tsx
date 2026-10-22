import { BUILTIN_TOOLS, createMockAIProvider, createRegistry, type AIProvider } from '@morph/core';
import { createClaudePlanner, type PlannerMessage } from '@morph/planner';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Alert, Linking } from 'react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type SecretStore } from '../ai/settings';
import ChangeRoute from '../app/change';
import HomeRoute from '../app/index';
import PageRoute from '../app/page/[pageId]';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 图片、富文本、emoji 图标（D-044–D-046）。

const registry = createRegistry(BUILTIN_TOOLS);

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
          <Stack />
        </WorkspaceProvider>
      </AISettingsProvider>
    ),
    index: HomeRoute,
    change: ChangeRoute,
    'page/[pageId]': PageRoute,
  });
  return { repo, store, files };
}

async function askAi(text: string) {
  await fireEvent.press(screen.getByTestId('nav-ai'));
  await fireEvent.changeText(await screen.findByTestId('change-input'), text);
  await fireEvent.press(screen.getByTestId('change-submit'));
  await fireEvent.press(await screen.findByTestId('change-apply'));
  expect(await screen.findByTestId('banner')).toBeTruthy();
}

/** 系统弹窗：点名字为 label 的按钮。 */
function pressInNextAlert(label: string) {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('pictures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('AI adds an empty slot; the user picks, replaces and removes the photo', async () => {
    const { repo, store, files } = await renderApp();
    await askAi('在首页顶部加一张横幅');
    expect(await screen.findByText('点按选择一张照片')).toBeTruthy();
    expect(store.getState().config!.pages[0]!.components[1]).toMatchObject({
      type: 'image',
      props: { aspect: 'wide' },
    });

    // 选照片：照片成为用户文件，配置里只记录文件 ID，这次修改记为“手动修改”。
    files.nextImage = files.offer('IMG_0001.jpg', photo, 'image/jpeg');
    await fireEvent.press(screen.getByTestId('image-slot-image-1'));
    expect(await screen.findByTestId('image-image-1')).toBeTruthy();
    const [asset] = await repo.listAssets();
    expect(asset).toMatchObject({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', source: 'picked' });
    expect(store.getState().config!.pages[0]!.components[1]).toMatchObject({
      props: { assetId: asset!.id },
    });
    expect(store.getState().head).toMatchObject({ source: 'user', summary: '设置图片' });

    // 取消选择不做任何修改。
    files.nextImage = null;
    pressInNextAlert('更换照片');
    await fireEvent.press(screen.getByTestId('image-slot-image-1'));
    expect(store.getState().head).toMatchObject({ summary: '设置图片' });

    // 移除照片：回到图片位；照片文件本身保留。
    pressInNextAlert('移除照片');
    await fireEvent.press(screen.getByTestId('image-slot-image-1'));
    expect(await screen.findByText('点按选择一张照片')).toBeTruthy();
    expect(await repo.listAssets()).toHaveLength(1);

    // 撤销：照片回来。
    await fireEvent.press(screen.getByText('撤销'));
    await store.getState().confirm();
    expect(await screen.findByTestId('image-image-1')).toBeTruthy();
  });

  it('the model sees the picture slot, never the file name or the picture', async () => {
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
    await store.getState().proposeOps(
      [
        {
          op: 'addComponent',
          pageId: 'home',
          component: { id: 'pic', type: 'image', props: { aspect: 'square', fit: 'cover' } },
        },
      ],
      '图片位',
    );
    await store.getState().confirm();
    files.nextImage = files.offer('全家福-王小明-SECRET.jpg', photo, 'image/jpeg');
    await fireEvent.press(await screen.findByTestId('image-slot-pic'));
    expect(await screen.findByTestId('image-pic')).toBeTruthy();

    expect((await store.getState().propose('圆角小一点')).kind).toBe('preview');
    expect(sent).toHaveLength(1);
    const request = String(sent[0]![0]!.content);
    expect(request).toContain('"type":"image"');
    for (const secret of ['全家福', '王小明', 'SECRET', '.jpg'])
      expect(request).not.toContain(secret);
  });
});

describe('rich text and emoji icons', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders bold text and lists; links open only after the user confirms', async () => {
    const { store } = await renderApp();
    await store.getState().proposeOps(
      [
        {
          op: 'addComponent',
          pageId: 'home',
          index: 1,
          component: {
            id: 'intro',
            type: 'text',
            props: {
              text: '全部**在本机**处理。\n- 不上传\n- 不联网\n\n见[帮助](https://example.com/help)',
            },
          },
        },
        { op: 'setPageIcon', pageId: 'home', icon: '🏡' },
      ],
      '介绍',
    );
    await store.getState().confirm();

    expect(await screen.findByText('在本机')).toBeTruthy();
    expect(screen.getByText('不上传')).toBeTruthy();
    expect(screen.getByText('🏡')).toBeTruthy();

    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    pressInNextAlert('取消');
    await fireEvent.press(screen.getByText('帮助'));
    expect(open).not.toHaveBeenCalled();
    pressInNextAlert('打开');
    await fireEvent.press(screen.getByText('帮助'));
    expect(open).toHaveBeenCalledWith('https://example.com/help');
  });
});
