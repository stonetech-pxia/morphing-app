import { fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { FakeMedia, FakeSpeech } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 音频工具的界面旅程（D-150–D-156）：工具页 → 录音 → 结果页；语音转文字的结果和说明；
// 剪一段的波形和铃声说明；压小音频的运行时询问。

const MB = 1024 * 1024;

describe('audio journeys (UI)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as { __audioPermission?: boolean }).__audioPermission;
  });

  async function openAudioTool() {
    const app = await renderToolsApp();
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-audio'));
    await fireEvent.press(await screen.findByTestId('open-audio'));
    return app;
  }

  it('records from the tool page: start, pause, continue, done, then plays and saves it', async () => {
    const { files, repo } = await openAudioTool();
    expect(
      await screen.findByText('全部在本机处理，不会上传。识别出的文字可能有错字，请核对。'),
    ).toBeTruthy();
    // 录音机写出的文件（假的 expo-audio 的地址）。
    files.disk.set('file:///cache/ExpoAudio/recording.m4a', new Uint8Array(4000));
    files.videos.set('file:///cache/ExpoAudio/recording.m4a', {
      kind: 'audio',
      durationMs: 3000,
      size: 4000,
      hasVideo: false,
      hasAudio: true,
    });

    await fireEvent.press(screen.getByTestId('run-audio-record'));
    expect(await screen.findByText('锁屏后会继续录。录完点「完成」。')).toBeTruthy();
    expect(screen.getByTestId('local-done')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('开始录音'));
    // 假的录音机每 0.2 秒走 1 秒。
    await waitFor(() => expect(screen.getByTestId('record-time')).not.toHaveTextContent('0:00'));
    await fireEvent.press(screen.getByLabelText('暂停'));
    expect(screen.getByLabelText('继续录')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('继续录'));
    await fireEvent.press(screen.getByTestId('local-done'));

    // 录音按开始录的时间命名（运行页用的是真实时间）。
    expect(
      await screen.findByTestId(
        /^result-item-录音 \d{4}-\d\d-\d\d_\d\d\.\d\d\.m4a$/,
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('result-save'));
    expect((await repo.listAssets()).map((a) => [a.name, a.mimeType])).toEqual([
      [expect.stringMatching(/^录音 .+\.m4a$/), 'audio/mp4'],
    ]);
  });

  it('without microphone permission the recorder says how to allow it', async () => {
    (globalThis as { __audioPermission?: boolean }).__audioPermission = false;
    await openAudioTool();
    await fireEvent.press(screen.getByTestId('run-audio-record'));
    await fireEvent.press(await screen.findByLabelText('开始录音'));
    expect(
      await screen.findByText('需要权限才能继续（麦克风），可以在系统「设置」里允许。'),
    ).toBeTruthy();
    expect(screen.getByTestId('local-done')).toBeDisabled();
  });

  it('turns a recording into text with a note to check it', async () => {
    const { files } = await openAudioTool();
    const speech = new FakeSpeech();
    speech.engine = 'system';
    speech.texts = ['明天上午九点在三楼开会。'];
    files.speech = speech;
    files.nextPick = [files.offerAudio('会议.m4a', { size: 1 * MB })];
    await fireEvent.press(screen.getByTestId('run-audio-transcribe'));
    // 运行时问来源（默认从文件选）和语言（默认普通话）。
    await fireEvent.press(await screen.findByTestId('prompt-ok'));
    await fireEvent.press(await screen.findByTestId('prompt-ok'));
    expect(await screen.findByText('明天上午九点在三楼开会。', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByTestId('speech-note')).toHaveTextContent(
      '本机自动识别，有噪音或口音时可能有错字，请核对。',
    );
  });

  it('shows the waveform and the ringtone note when trimming audio', async () => {
    const { files } = await openAudioTool();
    files.nextPick = [files.offerAudio('song.mp3', { size: 5 * MB }, 'audio/mpeg')];
    await fireEvent.press(screen.getByTestId('run-audio-trim'));
    expect(await screen.findByTestId('trim-waveform', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/iPhone 不能由 App 设成铃声/)).toBeTruthy();
    for (let i = 0; i < 10; i++) await fireEvent.press(screen.getByTestId('trim-start-plus'));
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(await screen.findByTestId('result-item-song.m4a')).toBeTruthy();
    expect(screen.getByText(/^0:50 · /)).toBeTruthy();
  });

  it('opens the trim screen before the waveform is read (long recordings on Android)', async () => {
    const { files } = await openAudioTool();
    jest.spyOn(files.media as FakeMedia, 'waveform').mockReturnValue(new Promise(() => {}));
    files.nextPick = [files.offerAudio('song.mp3', { size: 5 * MB }, 'audio/mpeg')];
    await fireEvent.press(screen.getByTestId('run-audio-trim'));
    expect(await screen.findByText('正在读取波形…', {}, { timeout: 3000 })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('trim-start-plus'));
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(await screen.findByTestId('result-item-song.m4a')).toBeTruthy();
  });

  it('asks how small, then compresses a recording to M4A', async () => {
    const { files } = await openAudioTool();
    files.nextPick = [
      files.offerAudio('lecture.wav', { size: 100 * MB, durationMs: 10 * 60_000 }, 'audio/wav'),
    ];
    await fireEvent.press(screen.getByTestId('run-audio-compress'));
    await fireEvent.press(await screen.findByTestId('ask-preset-5mb'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(
      await screen.findByTestId('result-item-lecture.m4a', {}, { timeout: 3000 }),
    ).toBeTruthy();
    expect(screen.getByTestId('result-smaller')).toHaveTextContent(
      /^原来 100\.0 MB，现在 4\.\d MB$/,
    );
  });
});
