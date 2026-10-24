import { createStarterWorkspace } from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 新用户的精简首页和工具箱（D-181、D-182）。

describe('starter home and toolbox (UI)', () => {
  const start = () =>
    renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: createStarterWorkspace });

  it('shows three quick actions and a toolbox entry, with no Tools tab', async () => {
    await start();
    expect(await screen.findByTestId('run-video-too-big')).toBeTruthy();
    expect(screen.getByTestId('run-email-photos')).toBeTruthy();
    expect(screen.getByTestId('run-pdf-too-big')).toBeTruthy();
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
