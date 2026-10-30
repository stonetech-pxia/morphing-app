// 桌面小组件（D-321–D-325）：App 在本机算好、写给小组件的画面，和小组件写回来的点按。
// iOS 扩展（targets/widget/Snapshot.swift）和 Android（modules/morph-widgets/…/WidgetStore.kt）按这份格式读，
// 改格式时三处一起改。AI 看不到这些（D-042）：只在本机算、只写进本机的共享存储。

/** 一行：列表的一条记录、tiles 的一个圆、分组统计的一个选项。 */
export interface WidgetRow {
  id: string;
  title: string;
  trailing?: string;
  /** 点一下执行的操作（snapshot.ops 的键）。 */
  op?: string;
  /** 点一下打开 App 的地址。 */
  link?: string;
  /** 进度环（0–1）。 */
  ratio?: number;
  /** 到了目标，圆填满。 */
  full?: boolean;
}

/** 一个组件的画面。message：不支持的组件、已经删掉的组件。 */
export type WidgetView =
  | {
      kind: 'stat';
      title: string;
      value: string;
      ratio?: number;
      percent?: string;
      note?: string;
      /** 按单选分组：每个选项一行。 */
      rows?: WidgetRow[];
      link?: string;
    }
  | { kind: 'button'; title: string; icon?: string; op?: string; link?: string; note?: string }
  | {
      kind: 'list';
      title: string;
      display: 'list' | 'tiles';
      rows: WidgetRow[];
      empty: string;
      link?: string;
    }
  | { kind: 'message'; title: string; note: string; link?: string };

export type WidgetViews = Record<string, WidgetView>;

/** 一段时间里的画面：现在这份，和每个操作连点 1…N 次以后的（D-322）。 */
export interface WidgetState {
  from: number;
  until: number;
  views: WidgetViews;
  after: Record<string, WidgetViews[]>;
}

/** 小组件上能点的操作：哪个组件、哪条记录（列表每一行的操作），hash 是当时的操作定义（改过就不执行）。 */
export interface WidgetOpRef {
  component: string;
  record?: string;
  hash: string;
}

export interface WidgetPalette {
  primary: string;
  tint: string;
  onPrimary: string;
}

export interface WidgetSnapshot {
  v: 1;
  strings: { stale: string };
  colors: { light: WidgetPalette; dark: WidgetPalette };
  /** 放到桌面的组件，最近放的在最后（iOS「编辑小组件」的列表；没选时显示最后一个）。 */
  items: { id: string; name: string }[];
  ops: Record<string, WidgetOpRef>;
  /** 今天和明天（跨天时小组件自己换上，不用等 App 打开）。 */
  states: WidgetState[];
}

/** 小组件写进队列的一次点按（at：点的时间，毫秒）。 */
export interface QueuedWidgetOp extends WidgetOpRef {
  op: string;
  at: number;
}

/** 本机记着的「放到桌面」（不进配置，D-325）。 */
export interface PlacedWidget {
  componentId: string;
  placedAt: number;
}

export interface WidgetPlatform {
  setSnapshot(json: string): Promise<void>;
  takeQueue(): Promise<string[]>;
  canPin(): boolean;
  pin(itemId: string, label: string): Promise<boolean>;
  /** Android：App 开着时小组件上点了操作。返回取消订阅。 */
  onQueue(listener: () => void): () => void;
}
