// iOS 桌面小组件（D-321）：WidgetKit 扩展，由 @bacons/apple-targets 在 prebuild 时生成 target。
// 只读 App Group 里 App 算好的画面（snapshot.json），点一下把操作写进 queue/，App 下次打开时执行。
// 点一下要 App Intents（iOS 17），所以扩展的最低版本是 17.0；主 App 不变。
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'MorphWidget',
  displayName: 'Morph',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups': ['group.app.morph.mobile'],
  },
};
