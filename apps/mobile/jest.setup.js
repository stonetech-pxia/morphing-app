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
