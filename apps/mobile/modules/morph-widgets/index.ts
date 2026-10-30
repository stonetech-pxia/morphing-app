import { requireOptionalNativeModule, type EventSubscription } from 'expo';

// 本地 Expo 模块 MorphWidgets（D-321–D-323）：桌面小组件和 App 之间的两份文件。
// - snapshot.json：App 算好的画面（src/widgets/types.ts），写完让系统重画小组件。
// - queue/：小组件上点了的操作，一次点按一个文件；App 取走后删掉，再按点的时间执行。
// iOS 放在 App Group group.app.morph.mobile 里（小组件扩展 targets/widget 读写），Android 放在 App 自己的
// files/widgets 里（小组件的 AppWidgetProvider 就在 App 里）。只用系统框架，不联网。Expo Go 和测试里是 null。

export interface MorphWidgetsModule {
  /** 换掉画面，让系统重画所有 Morph 小组件。 */
  setSnapshot(json: string): Promise<void>;
  /** 取走点了还没执行的操作（每条是一个 JSON），取完就删。 */
  takeQueue(): Promise<string[]>;
  /** 能不能直接请求把小组件放到桌面（只有 Android 8 起、桌面支持时能；iOS 永远是 false）。 */
  canPin(): boolean;
  /** 请求在桌面上放一个显示这个组件的小组件：系统弹确认框，由用户决定。返回请求有没有发出去。 */
  pin(itemId: string, label: string): Promise<boolean>;
  /** Android：App 开着时小组件上点了操作，马上取走执行。 */
  addListener(event: 'onQueue', listener: () => void): EventSubscription;
}

export default requireOptionalNativeModule<MorphWidgetsModule>('MorphWidgets');
