import type { PlannedNotification, ReminderTarget } from '@morph/core';

import type {
  NotificationPermission,
  NotificationPlatform,
  ReminderAction,
} from '../reminders/platform';

/** 测试用的本地通知：记下排了什么、稍后提醒、取消和收起了哪些。 */
export class FakeNotifications implements NotificationPlatform {
  status: NotificationPermission = 'undetermined';
  answer = true;
  requests = 0;
  scheduled: PlannedNotification[] | null = null;
  async permission() {
    return this.status;
  }
  async request() {
    this.requests++;
    this.status = this.answer ? 'granted' : 'denied';
    return this.answer;
  }
  snoozes: PlannedNotification[] = [];
  cancelled: string[] = [];
  dismissed: string[] = [];
  async replaceAll(planned: readonly PlannedNotification[]) {
    this.scheduled = [...planned];
  }
  async snoozed() {
    return this.snoozes.length;
  }
  async snooze(planned: PlannedNotification) {
    this.snoozes = [...this.snoozes.filter((n) => n.id !== planned.id), planned];
  }
  async cancel(id: string) {
    this.cancelled.push(id);
    this.snoozes = this.snoozes.filter((n) => n.id !== id);
  }
  async dismiss(id: string) {
    this.dismissed.push(id);
  }
  onOpen(_listener: (opens: ReminderTarget) => void) {
    return () => {};
  }
  onAction(_listener: (action: ReminderAction) => void) {
    return () => {};
  }
}
