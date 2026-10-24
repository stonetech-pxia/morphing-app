import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { renderToolsApp } from '../test-utils/render-app';

// 内置工具的界面旅程：安装 → 打开工具页 → 运行单功能工作流 → 结果页操作。

describe('tool journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function installImageTool() {
    const app = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-image'));
    await fireEvent.press(await screen.findByTestId('open-image'));
    return app;
  }

  it('compresses photos from the image tool page and saves them only when asked', async () => {
    const { files, repo } = await installImageTool();
    // 工具页的功能排成宫格，整块可点，没有单独的「开始」按钮（D-108）。
    // 方块上显示固定的设置；每次运行时问的大小不列出。
    expect(await screen.findByText('压缩图片')).toBeTruthy();
    expect(screen.getByText('格式 JPG')).toBeTruthy();
    expect(screen.queryAllByText('开始')).toEqual([]);

    files.nextPhotos = [
      files.offerImage('IMG_1.HEIC', 4032, 3024, 'image/heic', new Uint8Array(2_000_000)),
    ];
    await fireEvent.press(screen.getByTestId('run-image-compress'));
    // 运行时询问目标大小：点「240 KB」再确定。
    await fireEvent.press(await screen.findByTestId('ask-preset-kb-240'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByTestId('result-item-IMG_1.jpg')).toBeTruthy();
    // 变小了：显示原来和现在的大小。
    expect(screen.getByTestId('result-smaller')).toHaveTextContent(/^原来 .+，现在 .+$/);
    expect(await repo.listAssets()).toEqual([]);

    await fireEvent.press(screen.getByTestId('result-save'));
    expect(await screen.findByText('已保存 · IMG_1.jpg')).toBeTruthy();
    expect((await repo.listAssets()).map((a) => a.name)).toEqual(['IMG_1.jpg']);
    expect((await repo.listAssets())[0]!.size).toBeLessThanOrEqual(240 * 1024);

    await fireEvent.press(screen.getByTestId('result-photos'));
    expect(files.savedToPhotos).toHaveLength(1);

    // 「完成」关闭运行页，回到工具页（D-111）。
    expect(screen.getByTestId('run-done')).toHaveTextContent('完成');
    await fireEvent.press(screen.getByTestId('run-done'));
    expect(screen.queryByTestId('run-done')).toBeNull();
    expect(await screen.findByTestId('run-image-compress')).toBeTruthy();
  });

  it('shares every result in one sheet and saves them to a remembered folder from the result page', async () => {
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

    // 一次分享面板带上三个文件（D-119）。
    await fireEvent.press(screen.getByTestId('result-share'));
    expect(files.shareSheets.map((sheet) => sheet.length)).toEqual([3]);

    // 关掉文件夹选择器：不算存好，也不报错。
    files.folderChoice = 'cancel';
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(screen.getByText('存到文件夹')).toBeTruthy();
    expect(files.folders.size).toBe(0);

    files.folderChoice = 'notWritable';
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(await screen.findByText('不能存进这个文件夹，请换一个文件夹再试。')).toBeTruthy();

    files.folderChoice = 'pick';
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(await screen.findByText('已存到「MorphOut」')).toBeTruthy();
    expect([...files.folders.get('MorphOut')!.keys()]).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(files.folderPicks).toBe(3);

    // 换文件夹：再弹一次选择器，以后记住新的。
    files.nextFolder = 'Receipts';
    await fireEvent.press(screen.getByTestId('result-folderChange'));
    expect(await screen.findByText('已存到「Receipts」')).toBeTruthy();
    expect(files.folderPicks).toBe(4);
    expect(files.remembered).toBe('Receipts');
  });

  it('offers the remembered folder by name on the result page', async () => {
    const { files } = await installImageTool();
    files.remembered = 'MorphOut';
    files.nextPhotos = [files.offerImage('a.jpg', 400, 300)];
    await fireEvent.press(screen.getByTestId('run-image-compress'));
    await fireEvent.press(await screen.findByTestId('ask-preset-kb-240'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByText('存到「MorphOut」')).toBeTruthy();
    expect(screen.getByText('换文件夹')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('result-folder'));
    expect(await screen.findByText('已存到「MorphOut」')).toBeTruthy();
    // 直接存进去，没有弹选择器。
    expect(files.folderPicks).toBe(0);
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

  it('asks for the Wi-Fi password in a hidden field and never saves it (D-198)', async () => {
    const { repo } = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-qr'));
    await fireEvent.press(await screen.findByTestId('open-qr'));
    await fireEvent.press(await screen.findByTestId('run-qr-wifi'));
    await fireEvent.changeText(await screen.findByTestId('ask-network'), 'Home');
    const password = screen.getByTestId('ask-password');
    expect(password.props.secureTextEntry).toBe(true);
    // 没填密码：运行时报错，不会生成没用的码。
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByText('没有填密码。')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('run-again'));
    await fireEvent.changeText(await screen.findByTestId('ask-network'), 'Home');
    await fireEvent.changeText(screen.getByTestId('ask-password'), 'secret123');
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByTestId('result-share')).toBeTruthy();
    const head = await repo.getHead();
    expect(JSON.stringify(head!.config)).not.toContain('secret123');
  });
});
