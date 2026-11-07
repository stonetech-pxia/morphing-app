import { createStarterWorkspace } from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useIncoming } from '../share/incoming';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import {
  openPick,
  renderToolsApp,
  starterAfterGuide,
  testRegistry,
} from '../test-utils/render-app';

// 新用户的空白首页（D-231）、工具箱（D-181、D-182）和首页文件入口。

describe('starter home and toolbox (UI)', () => {
  const start = () =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: createStarterWorkspace });

  it('starts with an empty home page (D-231)', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    expect(store.getState().config!.containers.pages.find((p) => p.id === 'home')!.blocks).toEqual(
      [],
    );
    expect(screen.queryByTestId('file-pick-open')).toBeNull();
    expect(screen.queryByText('Tinkrum 可以做什么')).toBeNull();
    expect(screen.queryByTestId('nav-tools')).toBeNull();
  });

  it('opens added tools from the toolbox and adds a new one with one tap', async () => {
    const { store } = await start();
    await screen.findByTestId('nav-settings');
    await act(() => router.push('/page/toolbox'));
    expect(await screen.findByText('照片、视频和声音'.toUpperCase())).toBeTruthy();
    // 添加过的工具没有「+」，没添加的有。
    expect(screen.queryByTestId('toolgrid-add-image')).toBeNull();
    expect(screen.getByTestId('toolgrid-add-zip')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('toolgrid-zip'));
    expect(await screen.findByTestId('run-zip-files')).toBeTruthy();
    const config = store.getState().config!;
    expect(config.packages.some((p) => p.id === 'zip')).toBe(true);
    // 工具箱里已经有它：首页不多出工具入口。
    const home = config.containers.pages.find((p) => p.id === 'home')!;
    expect(JSON.stringify(home)).not.toContain('package:zip');
  });
});

describe('home file pickers', () => {
  const start = () =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: starterAfterGuide });
  it('the toolbox entry looks like a settings row (icon, name, arrow) and opens the toolbox', async () => {
    await start();
    const entry = await screen.findByText('工具箱');
    // 设置页的按钮是带箭头的一行，不是描边按钮。
    expect(screen.getAllByText('›').length).toBeGreaterThan(0);
    await fireEvent.press(entry);
    expect(await screen.findByText('照片、视频和声音'.toUpperCase())).toBeTruthy();
  });

  it('cancelling leaves the home and incoming batch unchanged', async () => {
    const { files } = await start();
    const pick = jest.spyOn(files, 'pickMedia');
    await openPick('media');
    expect(pick).toHaveBeenCalledWith(50);
    expect(screen.queryByTestId('share-screen')).toBeNull();
  });
  it('accepts photos and videos together, opens the inbox, then describes picked files to AI', async () => {
    const { files } = await start();
    const photo = files.offerImage('private-name.jpg', 400, 300);
    const video = files.offerVideo('private-movie.mp4', { size: 1000, durationMs: 1000 });
    files.nextMedia = [photo, video];
    await openPick('media');
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(useIncoming.getState().share).toMatchObject({ source: 'picker', files: [photo, video] });
    expect(screen.queryByTestId('run-screen')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-ask-ai'));
    expect(await screen.findByTestId('change-about')).toHaveTextContent(/给你选的/);
    expect(screen.getByTestId('change-about')).not.toHaveTextContent(/private/);
    expect(screen.getByTestId('change-input').props.placeholder).toBe(
      '说出你想要的，Tinkrum 会努力完成你的需求',
    );
  });
  it('opens any documents in the same inbox and removes the picker copy on dismissal', async () => {
    const { files } = await start();
    const pdf = files.offer('picked.pdf', new Uint8Array([1, 2, 3]));
    files.nextPick = [pdf];
    await openPick('files');
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(files.lastPickTypes).toEqual(['*/*']);
    await act(() => router.back());
    // 选择器复制进缓存的那份（picker://）用完就删；相册和「文件」里的原件不受影响。
    expect(files.disk.has(pdf.uri)).toBe(false);
    expect(useIncoming.getState().share).toBeNull();
  });
  it('rejects more than ten videos before receiving a batch', async () => {
    const { files } = await start();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    files.nextMedia = Array.from({ length: 11 }, (_, i) =>
      files.offerVideo(`${i}.mp4`, { size: 1000, durationMs: 1000 }),
    );
    await openPick('media');
    expect(alert).toHaveBeenCalled();
    expect(screen.queryByTestId('share-screen')).toBeNull();
    // 不收的那一批，选择器的副本也删掉。
    expect([...files.disk.keys()].some((k) => k.startsWith('picker://'))).toBe(false);
    alert.mockRestore();
  });
});

// 用户报告（2026-11-06 模拟器）：中文建的工作空间在设置里切到法文后，底栏、首页和工具箱还是中文。
describe('starter texts follow the interface language', () => {
  it('shows a Chinese starter workspace in French without writing the config', async () => {
    const { store } = await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      locale: 'fr',
      seed: (_locale, registry) => starterAfterGuide('zh', registry),
    });
    await screen.findByTestId('nav-settings');
    const before = JSON.stringify(store.getState().config);
    const fr = starterAfterGuide('fr', testRegistry);
    const frHome = fr.containers.pages.find((p) => p.id === 'home')!;
    expect(screen.getByTestId('nav-page:home').props.accessibilityLabel).toBe(frHome.title);
    expect(screen.queryByText('最近操作')).toBeNull();

    await act(() => router.push('/page/toolbox'));
    const frGroup = fr.containers.pages
      .find((p) => p.id === 'toolbox')!
      .blocks.find((b) => b.id === 'tools-media') as { show: { title: string } };
    expect(await screen.findByText(frGroup.show.title.toUpperCase())).toBeTruthy();
    expect(screen.queryByText('照片、视频和声音'.toUpperCase())).toBeNull();
    const frImage = fr.containers.pages.find((p) => p.package === 'image')!.title;
    expect(screen.getByTestId('toolgrid-image').props.accessibilityLabel).toBe(frImage);
    // 只在显示时换：配置里还是建立时的中文。
    expect(JSON.stringify(store.getState().config)).toBe(before);
  });
});
