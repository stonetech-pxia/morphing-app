import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { acceptNextAlert, renderToolsApp } from '../test-utils/render-app';

// 内置工具的界面旅程：安装 → 打开工具页 → 运行单功能工作流 → 结果页操作。

describe('tool journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function installImageTool() {
    const app = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('install-image'));
    await fireEvent.press(await screen.findByTestId('open-image'));
    return app;
  }

  it('compresses photos from the image tool page and saves them only when asked', async () => {
    const { files, repo } = await installImageTool();
    // 卡片上显示固定的设置；每次运行时问的大小不列出。
    expect(await screen.findByText('压缩图片')).toBeTruthy();
    expect(screen.getByText('格式 JPG')).toBeTruthy();

    files.nextPhotos = [files.offerImage('IMG_1.HEIC', 4032, 3024, 'image/heic')];
    await fireEvent.press(screen.getByTestId('run-image-compress'));
    // 运行时询问目标大小：点「240 KB」再确定。
    await fireEvent.press(await screen.findByTestId('ask-preset-kb-240'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByTestId('result-item-IMG_1.jpg')).toBeTruthy();
    expect(await repo.listAssets()).toEqual([]);

    await fireEvent.press(screen.getByTestId('result-save'));
    expect(await screen.findByText('已保存 · IMG_1.jpg')).toBeTruthy();
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['IMG_1.jpg']);
    expect((await repo.listAssets())[0]!.size).toBeLessThanOrEqual(240 * 1024);

    await fireEvent.press(screen.getByTestId('result-photos'));
    expect(files.savedToPhotos).toHaveLength(1);
  });

  it('shares every result in one sheet and saves them to a folder from the result page', async () => {
    const { files } = await installImageTool();
    files.nextPhotos = [
      files.offerImage('a.jpg', 400, 300),
      files.offerImage('b.jpg', 400, 300),
      files.offerImage('c.jpg', 400, 300),
    ];
    await fireEvent.press(screen.getByTestId('run-image-compress'));
    await fireEvent.press(await screen.findByTestId('ask-preset-kb-240'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByTestId('result-item-c.jpg')).toBeTruthy();

    // 一次分享面板带上三个文件（D-100）。
    await fireEvent.press(screen.getByTestId('result-share'));
    expect(files.shareSheets.map((sheet) => sheet.length)).toEqual([3]);

    // 关掉文件夹选择器：不算存好，也不报错。
    files.folderChoice = 'cancel';
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(screen.getByText('存到文件夹')).toBeTruthy();
    expect(files.folder.size).toBe(0);

    files.folderChoice = 'notWritable';
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(await screen.findByText('不能存进这个文件夹，请换一个文件夹再试。')).toBeTruthy();

    files.folderChoice = 'pick';
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(await screen.findByText('已存到文件夹')).toBeTruthy();
    expect([...files.folder.keys()]).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('a wrong value in the question is caught before running', async () => {
    const { files } = await installImageTool();
    files.nextPhotos = [files.offerImage('a.jpg', 400, 300)];
    await fireEvent.press(await screen.findByTestId('run-image-compress'));
    await fireEvent.changeText(await screen.findByTestId('ask-maxKB'), '5');
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByText('请检查：不超过')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('prompt-cancel'));
    expect(await screen.findByTestId('run-cancelled')).toBeTruthy();
  });
});
