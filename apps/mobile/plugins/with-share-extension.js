// iOS 分享扩展的两处调整（D-095、D-099），在 expo-share-intent 生成扩展之后执行：
// 1. 显示名：expo-share-intent 用 iosShareExtensionName 同时做 Xcode target 名和显示名，但 target 不能和
//    主 App 同名（「Morph」），所以 target 叫 MorphShare，这里把分享面板里显示的名字改回「Morph」。
// 2. 控制器：换成我们自己的 ShareViewController.swift（按顺序逐个复制，全部复制完才跳回主 App；
//    expo-share-intent 9.0.0 的控制器并行处理多个附件，处理完最后一个序号就跳转，前面的文件可能还没复制完）。
const fs = require('node:fs');
const path = require('node:path');
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withShareExtension(config, { target, displayName }) {
  return withFinalizedMod(config, [
    'ios',
    (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, target);
      const plist = path.join(dir, 'ShareExtension-Info.plist');
      const xml = fs.readFileSync(plist, 'utf8');
      const next = xml.replace(
        /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
        `$1${displayName}$2`,
      );
      if (!next.includes(`<string>${displayName}</string>`)) {
        throw new Error(`[with-share-extension] CFBundleDisplayName not found in ${plist}`);
      }
      fs.writeFileSync(plist, next);
      fs.copyFileSync(
        path.join(
          config.modRequest.projectRoot,
          'plugins',
          'share-extension',
          'ShareViewController.swift',
        ),
        path.join(dir, 'ShareViewController.swift'),
      );
      return config;
    },
  ]);
};
