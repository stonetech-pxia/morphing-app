import type { PlannedNotification, ReminderTarget } from '@morph/core';

// 提醒（D-251）用的本地通知。App 里由 expo-notifications 实现（expo-reminders.ts），测试里换成假的。
// 只排本地通知，不注册推送、不需要服务器。

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export interface NotificationPlatform {
  permission(): Promise<NotificationPermission>;
  /** 弹系统的通知权限请求；只在第一次真的有提醒要排时调用。 */
  request(): Promise<boolean>;
  /** 换成这一批：先取消 Morph 排过的全部提醒，再排这些。 */
  replaceAll(planned: readonly PlannedNotification[]): Promise<void>;
  /** 用户点了提醒（App 开着或从提醒冷启动）；返回取消订阅的函数。 */
  onOpen(listener: (opens: ReminderTarget) => void): () => void;
}

/** 通知里只带「打开哪里」，不带记录内容以外的东西；读出来时再检查一遍格式。 */
export const OPENS_KEY = 'morphOpens';
