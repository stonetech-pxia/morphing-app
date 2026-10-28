import { requireOptionalNativeModule, type EventSubscription } from 'expo';

// 本地 Expo 模块 MorphShortcuts（D-269）：用户标了「放到桌面」的快捷操作出现在长按 Morph 图标的菜单里。
// iOS 是 ios/MorphShortcutsModule.swift（UIApplicationShortcutItem，点了由 app delegate 订阅者收到；
// SDK 58 的 ExpoAppSceneDelegate 把冷启动和 App 开着时的点按都转给它）。
// Android 是 android/…/MorphShortcutsModule.kt（ShortcutManagerCompat 的动态快捷方式；用户点按钮时
// requestPinShortcut 在桌面上单独放一个图标，系统弹确认框；不在菜单里的已固定图标用 disableShortcuts 停用）。
// 只用系统框架，不联网。Expo Go 和测试里是 null，调用方什么也不做。

export interface ShortcutItem {
  /** 快捷操作的 ID：点了之后用它找到要开始的快捷操作。 */
  id: string;
  title: string;
  /** iOS 的 SF Symbol 名字；Android 用 App 图标。 */
  symbol?: string;
}

export interface MorphShortcutsModule {
  /**
   * 整份换掉长按菜单。Android 上同时整理已经固定在桌面上的图标：在 items 里的更新名字并启用，
   * 不在的停用（点了显示 disabledMessage），因为 App 不能替用户把桌面上的图标拿掉。
   */
  setItems(items: readonly ShortcutItem[], disabledMessage: string): Promise<void>;
  /** 这台设备能不能在桌面上单独放一个图标（Android 8 起、桌面支持时为 true；iOS 永远是 false）。 */
  canPin(): boolean;
  /** 请求在桌面上放一个图标：系统弹确认框，由用户决定。返回请求有没有发出去（不代表用户同意了）。 */
  pin(item: ShortcutItem): Promise<boolean>;
  /** 冷启动时是从哪个快捷操作打开的；只返回一次，之后是 null。 */
  takeLaunched(): string | null;
  /** App 开着时（或从后台回来）点了桌面菜单 / 图标。 */
  addListener(event: 'onOpen', listener: (e: { id: string }) => void): EventSubscription;
}

export default requireOptionalNativeModule<MorphShortcutsModule>('MorphShortcuts');
