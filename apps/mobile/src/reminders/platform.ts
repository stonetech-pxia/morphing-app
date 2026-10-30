import type { PlannedNotification, ReminderTarget } from '@morph/core';

// 提醒（D-251）用的本地通知。App 里由 expo-notifications 实现（expo-reminders.ts），测试里换成假的。
// 只排本地通知，不注册推送、不需要服务器。

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

/** 用户点了按记录排的提醒上的按钮（D-318）。 */
export interface ReminderAction {
  button: 'done' | 'snooze';
  reminderId: string;
  recordId: string;
  /** 这条通知的 ID（Android 要自己收起通知）。 */
  notificationId: string;
  /** 同一次点击的标识：同一次点击可能从两条路送到（监听和 Android 的后台任务），只处理一次。 */
  key: string;
}

export interface NotificationPlatform {
  permission(): Promise<NotificationPermission>;
  /** 弹系统的通知权限请求；只在第一次真的有提醒要排时调用。 */
  request(): Promise<boolean>;
  /** 换成这一批：先取消 Morph 排过的提醒（还在等的稍后提醒保留），再排这些。 */
  replaceAll(planned: readonly PlannedNotification[]): Promise<void>;
  /** 还在等的稍后提醒有几条（从系统待发通知的上限里扣掉，D-319）。 */
  snoozed(): Promise<number>;
  /** 排一条稍后提醒（ID 用 snoozeId，同一条记录只留一条）。 */
  snooze(planned: PlannedNotification): Promise<void>;
  /** 取消一条还没响的通知。 */
  cancel(id: string): Promise<void>;
  /** 收起通知中心里已经出现的一条。 */
  dismiss(notificationId: string): Promise<void>;
  /** 用户点了提醒（App 开着或从提醒冷启动）；返回取消订阅的函数。 */
  onOpen(listener: (opens: ReminderTarget) => void): () => void;
  /** 用户点了提醒上的按钮（App 开着，或者被系统在后台拉起）；返回取消订阅的函数。 */
  onAction(listener: (action: ReminderAction) => void): () => void;
}

/** 通知里只带「打开哪里」，不带记录内容以外的东西；读出来时再检查一遍格式。 */
export const OPENS_KEY = 'morphOpens';
/** 按记录排的提醒：哪个提醒、哪条记录（只有 ID）。 */
export const RECORD_KEY = 'morphRecord';
/** 通知上的按钮（D-318）：expo-notifications 的分类 ID 和按钮 ID。 */
export const DONE_ACTION = 'morph-done';
export const SNOOZE_ACTION = 'morph-snooze';
