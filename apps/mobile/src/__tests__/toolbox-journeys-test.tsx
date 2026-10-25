import { createStarterWorkspace } from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useIncoming } from '../share/incoming';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 新用户的精简首页和工具箱（D-181、D-182）。

describe('starter home and toolbox (UI)', () => {
  const start = () =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: createStarterWorkspace });

  it('shows file pickers, the category entry and toolbox without preset shortcuts', async () => {
    await start();
    expect(await screen.findByTestId('file-pick-media')).toBeTruthy();
    expect(screen.getByTestId('file-pick-files')).toBeTruthy();
    expect(screen.getByText('Morph 可以做什么')).toBeTruthy();
    expect(screen.queryByTestId('run-video-too-big')).toBeNull();
    expect(screen.queryByTestId('run-email-photos')).toBeNull();
    expect(screen.queryByTestId('run-pdf-too-big')).toBeNull();
    expect(screen.getByText('工具箱')).toBeTruthy();
    expect(screen.queryByTestId('nav-tools')).toBeNull();
  });

  it('opens added tools from the toolbox and adds a new one with one tap', async () => {
    const { store } = await start();
    await fireEvent.press(await screen.findByText('全部工具'));
    expect(await screen.findByText('照片、视频和声音'.toUpperCase())).toBeTruthy();
    // 添加过的工具没有「+」，没添加的有。
    expect(screen.queryByTestId('toolgrid-add-image')).toBeNull();
    expect(screen.getByTestId('toolgrid-add-zip')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('toolgrid-zip'));
    expect(await screen.findByTestId('run-zip-files')).toBeTruthy();
    const config = store.getState().config!;
    expect(config.tools.some((t) => t.toolId === 'zip')).toBe(true);
    // 工具箱里已经有它：首页不多出工具入口。
    const home = config.pages.find((p) => p.id === 'home')!;
    expect(JSON.stringify(home)).not.toContain('toolCard');
  });
});

describe('home file pickers', () => {
  const start = () =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: createStarterWorkspace });
  it('cancelling leaves the home and incoming batch unchanged', async () => {
    const { files } = await start();
    const pick = jest.spyOn(files, 'pickMedia');
    await fireEvent.press(await screen.findByTestId('file-pick-media'));
    expect(pick).toHaveBeenCalledWith(50);
    expect(screen.queryByTestId('share-screen')).toBeNull();
  });
  it('accepts photos and videos together, opens the inbox, then describes picked files to AI', async () => {
    const { files } = await start();
    const photo = files.offerImage('private-name.jpg', 400, 300);
    const video = files.offerVideo('private-movie.mp4', { size: 1000, durationMs: 1000 });
    files.nextMedia = [photo, video];
    await fireEvent.press(await screen.findByTestId('file-pick-media'));
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(useIncoming.getState().share).toMatchObject({ source: 'picker', files: [photo, video] });
    expect(screen.queryByTestId('run-screen')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-ask-ai'));
    expect(await screen.findByTestId('change-about')).toHaveTextContent(/给你选的/);
    expect(screen.getByTestId('change-about')).not.toHaveTextContent(/private/);
    expect(screen.getByTestId('change-input').props.placeholder).toBe(
      '说出你想要的，Morph 会努力完成你的需求',
    );
  });
  it('opens any documents in the same inbox and removes the picker copy on dismissal', async () => {
    const { files } = await start();
    const pdf = files.offer('picked.pdf', new Uint8Array([1, 2, 3]));
    files.nextPick = [pdf];
    await fireEvent.press(await screen.findByTestId('file-pick-files'));
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
    await fireEvent.press(await screen.findByTestId('file-pick-media'));
    expect(alert).toHaveBeenCalled();
    expect(screen.queryByTestId('share-screen')).toBeNull();
    // 不收的那一批，选择器的副本也删掉。
    expect([...files.disk.keys()].some((k) => k.startsWith('picker://'))).toBe(false);
    alert.mockRestore();
  });
});
