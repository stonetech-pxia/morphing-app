// 手机桌面（D-271）：长按 Morph 图标的菜单和 Android 桌面上单独的图标。App 里由本地模块 MorphShortcuts
// 实现（native.ts），测试里换成假的。

export interface HomeScreenEntry {
  /** 快捷操作的 ID。 */
  id: string;
  title: string;
  /** iOS 菜单里的 SF Symbol 名字。 */
  symbol?: string;
}

export interface HomeScreenPlatform {
  /** 整份换掉菜单；Android 上不在菜单里的已固定图标停用，点了显示 disabledMessage。 */
  setItems(items: readonly HomeScreenEntry[], disabledMessage: string): Promise<void>;
  /** 能不能在桌面上单独放一个图标（只有 Android 能）。 */
  canPin(): boolean;
  /** 弹系统的确认框，只能在用户点了按钮之后调用。返回请求有没有发出去。 */
  pin(item: HomeScreenEntry): Promise<boolean>;
  /** 冷启动时是从哪个快捷操作打开的；只返回一次。 */
  takeLaunched(): string | null;
  /** App 开着时点了桌面菜单或图标；返回取消订阅的函数。 */
  onOpen(listener: (workflowId: string) => void): () => void;
}
