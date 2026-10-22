/* global jest */
// Jest 里没有原生模块：WebView（扩展包页面）用一个空组件代替。扩展包的逻辑在测试里通过假的 PackRuntime 测。
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: View, default: View };
});
