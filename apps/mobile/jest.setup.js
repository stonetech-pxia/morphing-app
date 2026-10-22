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
