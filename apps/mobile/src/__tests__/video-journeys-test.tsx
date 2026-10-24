import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { FakeBackground } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 视频工具的界面旅程（D-140–D-143）：工具页 → 压缩 → 结果页（播放、存到相册）；剪一段的界面。

const MB = 1024 * 1024;

describe('video journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function openVideoTool() {
    const app = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-video'));
    await fireEvent.press(await screen.findByTestId('open-video'));
    return app;
  }

  it('compresses a video to 20 MB from the tool page, plays it and saves it to Photos', async () => {
    const { files, repo } = await openVideoTool();
    expect(await screen.findByText('压缩视频')).toBeTruthy();
    expect(screen.getByText('转成 MP4')).toBeTruthy();
    expect(screen.getByText('剪一段')).toBeTruthy();
    expect(screen.getByText('全部在本机处理，不会上传。')).toBeTruthy();

    files.nextVideos = [files.offerVideo('IMG_0001.MOV', { size: 120 * MB })];
    await fireEvent.press(screen.getByTestId('run-video-compress'));
    // 运行时问：按大小（默认）→ 点「20 MB」。按画质的选项这时不显示。
    await fireEvent.press(await screen.findByTestId('ask-preset-20mb'));
    expect(screen.queryByTestId('ask-quality-720p')).toBeNull();
    await fireEvent.press(screen.getByTestId('prompt-ok'));

    expect(await screen.findByTestId('result-item-IMG_0001.mp4')).toBeTruthy();
    expect(screen.getByText(/^1:00 · 1280×720 · /)).toBeTruthy();
    expect(screen.getByTestId('result-smaller')).toHaveTextContent(
      /^原来 120\.0 MB，现在 1\d\.\d MB$/,
    );
    // 视频不能打印，但能存到相册。
    expect(screen.queryByTestId('result-print')).toBeNull();
    await fireEvent.press(screen.getByTestId('result-photos'));
    expect(files.savedToPhotos).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('result-play-IMG_0001.mp4'));
    expect(await screen.findByTestId('media-player')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('media-close'));
    expect(screen.queryByTestId('media-player')).toBeNull();

    await fireEvent.press(screen.getByTestId('result-save'));
    expect((await repo.listAssets()).map((a) => [a.name, a.mimeType])).toEqual([
      ['IMG_0001.mp4', 'video/mp4'],
    ]);
  });

  it('asks for the quality tier when compressing by quality', async () => {
    const { files } = await openVideoTool();
    files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
    await fireEvent.press(screen.getByTestId('run-video-compress'));
    await fireEvent.press(await screen.findByTestId('ask-preset-480p'));
    expect(screen.getByTestId('ask-quality-480p')).toBeTruthy();
    expect(screen.queryByTestId('ask-maxMB')).toBeNull();
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByText(/^1:00 · \d+×480 · /)).toBeTruthy();
  });

  it('trims a video on the trim screen with the ±1 s buttons', async () => {
    const { files } = await openVideoTool();
    files.nextVideos = [files.offerVideo('trip.mov', { size: 60 * MB })];
    await fireEvent.press(screen.getByTestId('run-video-trim'));

    expect(await screen.findByTestId('trim-start', {}, { timeout: 3000 })).toHaveTextContent(
      '0:00.0',
    );
    expect(screen.getByTestId('trim-end')).toHaveTextContent('1:00.0');
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('trim-start-plus'));
    for (let i = 0; i < 2; i++) await fireEvent.press(screen.getByTestId('trim-end-minus'));
    // 开始不能早于 0。
    for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByTestId('trim-start-minus'));
    await fireEvent.press(screen.getByTestId('trim-start-plus'));
    expect(screen.getByTestId('trim-start')).toHaveTextContent('0:01.0');
    expect(screen.getByTestId('trim-end')).toHaveTextContent('0:58.0');
    expect(screen.getByTestId('trim-length')).toHaveTextContent('留下 0:57.0');
    await fireEvent.press(screen.getByTestId('trim-play'));
    expect(screen.getByText('暂停')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('local-done'));
    expect(await screen.findByText(/^0:57 · /)).toBeTruthy();
  });

  it('says whether you can switch apps while a video step runs', async () => {
    const { files } = await openVideoTool();
    files.nextVideos = [files.offerVideo('trip.mov', { size: 60 * MB })];
    await fireEvent.press(screen.getByTestId('run-video-trim'));
    // 没有后台模块（像 iOS 现在）：请留在 Morph 里。
    await screen.findByTestId('trim-start', {}, { timeout: 3000 });
    expect(screen.getByTestId('run-background-hint')).toHaveTextContent('处理时请留在 Morph 里。');
    await fireEvent.press(screen.getByTestId('local-done'));
    await screen.findByText(/^1:00 · /);
    expect(screen.queryByTestId('run-background-hint')).toBeNull();

    // Android：可以切走。
    files.background = new FakeBackground();
    files.nextVideos = [files.offerVideo('trip.mov', { size: 60 * MB })];
    await fireEvent.press(screen.getByTestId('run-again'));
    await screen.findByTestId('trim-start', {}, { timeout: 3000 });
    expect(screen.getByTestId('run-background-hint')).toHaveTextContent(
      '可以切到别的 App，Morph 会在后台接着处理。',
    );
  });

  it('says videos need the full app when the native module is missing', async () => {
    const { files } = await openVideoTool();
    files.media = null;
    files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
    await fireEvent.press(screen.getByTestId('run-video-trim'));
    expect(
      await screen.findByText('视频和音频要在正式版 Morph 里处理，这个预览版里不行。'),
    ).toBeTruthy();
  });
});
