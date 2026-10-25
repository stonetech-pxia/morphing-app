/* global jest */
// Jest 里没有原生模块：WebView（扩展包页面）用一个空组件代替。扩展包的逻辑在测试里通过假的 PackRuntime 测。
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: View, default: View };
});

// Skia（签名板、拼图、二维码）也是原生模块：界面用空组件代替，离屏绘制在测试里不可用（由注入的平台能力替身完成）。
jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  const unavailable = () => {
    throw new Error('Skia is not available in tests');
  };
  return {
    Canvas: View,
    Path: () => null,
    Text: () => null,
    Image: () => null,
    Rect: () => null,
    ImageFormat: { JPEG: 3, PNG: 4, WEBP: 6 },
    Skia: new Proxy({}, { get: () => unavailable }),
    matchFont: unavailable,
  };
});

// 视频播放（expo-video）也是原生模块：画面用空组件代替，播放器只记录状态（剪一段、结果页播放）。
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  const makePlayer = (source) => {
    const listeners = new Map();
    const emit = (name, payload) => listeners.get(name)?.forEach((fn) => fn(payload));
    return {
      source,
      playing: false,
      currentTime: 0,
      timeUpdateEventInterval: 0,
      play() {
        this.playing = true;
        emit('playingChange', { isPlaying: true });
      },
      pause() {
        this.playing = false;
        emit('playingChange', { isPlaying: false });
      },
      generateThumbnailsAsync: async () => [],
      addListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return { remove: () => listeners.get(name)?.delete(fn) };
      },
      removeListener(name, fn) {
        listeners.get(name)?.delete(fn);
      },
      release() {},
    };
  };
  return {
    VideoView: View,
    createVideoPlayer: makePlayer,
    useVideoPlayer: (source, setup) =>
      React.useMemo(() => {
        const player = makePlayer(source);
        setup?.(player);
        return player;
        // 和真的一样只随地址重建；setup 只在创建时调用一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [source]),
  };
});

// expo-audio（录音，D-154）：假的录音机。record() 之后每次读状态时长加 1 秒；stop() 写出一个小文件地址。
// global.__audioPermission 可以设成 false 测「没有麦克风权限」。
jest.mock('expo-audio', () => {
  const React = require('react');
  const makeRecorder = () => {
    const recorder = {
      uri: null,
      isRecording: false,
      durationMillis: 0,
      async prepareToRecordAsync() {
        this.uri = 'file:///cache/ExpoAudio/recording.m4a';
      },
      record() {
        this.isRecording = true;
      },
      pause() {
        this.isRecording = false;
      },
      async stop() {
        this.isRecording = false;
      },
    };
    return recorder;
  };
  return {
    AudioQuality: { MIN: 0, LOW: 32, MEDIUM: 64, HIGH: 96, MAX: 127 },
    IOSOutputFormat: { MPEG4AAC: 'aac ' },
    useAudioRecorder: () => React.useMemo(makeRecorder, []),
    useAudioRecorderState: (recorder) => {
      const [, tick] = React.useState(0);
      React.useEffect(() => {
        const timer = setInterval(() => {
          if (recorder.isRecording) {
            recorder.durationMillis += 1000;
            tick((n) => n + 1);
          }
        }, 200);
        return () => clearInterval(timer);
      }, [recorder]);
      return {
        canRecord: true,
        isRecording: recorder.isRecording,
        durationMillis: recorder.durationMillis,
        fileSize: 0,
        mediaServicesDidReset: false,
        metering: recorder.isRecording ? -20 : undefined,
        url: recorder.uri,
      };
    },
    requestRecordingPermissionsAsync: async () => ({
      granted: global.__audioPermission !== false,
      status: global.__audioPermission !== false ? 'granted' : 'denied',
    }),
    setAudioModeAsync: async () => undefined,
  };
});
