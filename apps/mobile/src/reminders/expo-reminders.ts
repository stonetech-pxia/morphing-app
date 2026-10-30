import {
  ReminderTargetSchema,
  t,
  type Locale,
  type NotificationButtons,
  type PlannedNotification,
  type ReminderTarget,
} from '@morph/core';
import {
  addNotificationResponseReceivedListener,
  AndroidImportance,
  cancelScheduledNotificationAsync,
  clearLastNotificationResponse,
  DEFAULT_ACTION_IDENTIFIER,
  dismissNotificationAsync,
  getAllScheduledNotificationsAsync,
  getLastNotificationResponse,
  getPermissionsAsync,
  requestPermissionsAsync,
  SchedulableTriggerInputTypes,
  scheduleNotificationAsync,
  setNotificationCategoryAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
  type NotificationResponse,
  type SchedulableNotificationTriggerInput,
} from 'expo-notifications';
import { Platform } from 'react-native';

import {
  DONE_ACTION,
  OPENS_KEY,
  RECORD_KEY,
  SNOOZE_ACTION,
  type NotificationPlatform,
  type ReminderAction,
} from './platform';

// NotificationPlatform 的实现：expo-notifications 的本地通知（D-251）。不取推送令牌、不连服务器。

const CHANNEL = 'reminders';

// App 开着时提醒也显示出来（横幅 + 通知中心），不响铃以外的打扰。
setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady: Promise<unknown> | null = null;
/** Android 8 起通知要有频道：「提醒」一个，默认重要程度。 */
function ensureChannel(name: string) {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= setNotificationChannelAsync(CHANNEL, {
    name,
    importance: AndroidImportance.DEFAULT,
  });
  return channelReady;
}

/** 稍后提醒的 ID 前缀（core 的 snoozeId）：重排时保留。 */
const SNOOZE_PREFIX = 'snooze-';

const categoryOf = (buttons: NotificationButtons) => `morph-${buttons}`;

/**
 * 通知上的按钮（D-318）：完成、稍后提醒两种，按提醒的设置组成三个分类。按钮不把 App 打开到前台：
 * iOS 在后台拉起 App 处理，Android 由后台任务处理（App 没在运行时也行，见 background.ts）。
 */
export async function setupReminderButtons(locale: Locale) {
  const done = {
    identifier: DONE_ACTION,
    buttonTitle: t(locale, 'reminderDoneButton'),
    options: { opensAppToForeground: false },
  };
  const later = {
    identifier: SNOOZE_ACTION,
    buttonTitle: t(locale, 'reminderSnoozeButton'),
    options: { opensAppToForeground: false },
  };
  await setNotificationCategoryAsync(categoryOf('done'), [done]);
  await setNotificationCategoryAsync(categoryOf('snooze'), [later]);
  await setNotificationCategoryAsync(categoryOf('doneSnooze'), [done, later]);
}

/** 通知里带的数据（Android 后台任务里有时是 JSON 文字）。 */
function dataOf(response: NotificationResponse): Record<string, unknown> {
  const data = response.notification?.request?.content?.data as
    Record<string, unknown> | null | undefined;
  if (typeof data?.dataString === 'string') {
    try {
      return JSON.parse(data.dataString) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data ?? {};
}

const opensOf = (data: unknown): ReminderTarget | null => {
  const raw = (data as Record<string, unknown> | null | undefined)?.[OPENS_KEY];
  const parsed = ReminderTargetSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** 按钮的点击 → ReminderAction；不是 Morph 的按钮时为 null。 */
export function reminderActionOf(response: NotificationResponse): ReminderAction | null {
  const id = response.actionIdentifier;
  if (id !== DONE_ACTION && id !== SNOOZE_ACTION) return null;
  const raw = dataOf(response)[RECORD_KEY] as Record<string, unknown> | undefined;
  if (typeof raw?.reminderId !== 'string' || typeof raw.recordId !== 'string') return null;
  const notificationId = response.notification.request.identifier;
  return {
    button: id === DONE_ACTION ? 'done' : 'snooze',
    reminderId: raw.reminderId,
    recordId: raw.recordId,
    notificationId,
    key: `${notificationId}:${response.notification.date}:${id}`,
  };
}

const isTap = (response: NotificationResponse) =>
  response.actionIdentifier === DEFAULT_ACTION_IDENTIFIER;

function triggerOf(n: PlannedNotification): SchedulableNotificationTriggerInput {
  const channelId = CHANNEL;
  return n.trigger.kind === 'daily'
    ? {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: n.trigger.hour,
        minute: n.trigger.minute,
        channelId,
      }
    : n.trigger.kind === 'weekly'
      ? {
          type: SchedulableTriggerInputTypes.WEEKLY,
          // core 里 1 = 周一 … 7 = 周日；expo-notifications 里 1 = 周日。
          weekday: (n.trigger.weekday % 7) + 1,
          hour: n.trigger.hour,
          minute: n.trigger.minute,
          channelId,
        }
      : {
          type: SchedulableTriggerInputTypes.DATE,
          date: n.trigger.at,
          channelId,
        };
}

/** 通知里记着排它时的全部设置：下次重排时一样就不动它（D-319）。 */
const PLAN_KEY = 'morphPlan';
const planOf = (n: PlannedNotification) =>
  JSON.stringify([n.title, n.body, n.trigger, n.opens, n.recordId ?? null, n.buttons ?? null]);

function schedule(n: PlannedNotification) {
  return scheduleNotificationAsync({
    identifier: n.id,
    content: {
      title: n.title,
      body: n.body,
      data: {
        [OPENS_KEY]: n.opens,
        [PLAN_KEY]: planOf(n),
        ...(n.recordId ? { [RECORD_KEY]: { reminderId: n.reminderId, recordId: n.recordId } } : {}),
      },
      ...(n.buttons ? { categoryIdentifier: categoryOf(n.buttons) } : {}),
    },
    trigger: triggerOf(n),
  });
}

export function expoReminders(channelName: string): NotificationPlatform {
  return {
    async permission() {
      const { status } = await getPermissionsAsync();
      return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
    },
    async request() {
      const { granted } = await requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
      return granted;
    },
    async replaceAll(planned) {
      await ensureChannel(channelName);
      // Morph 只用 expo-notifications 排提醒（长任务的进度通知走 morph-background，不受影响）。
      // 按通知 ID 做差（D-319）：只取消不再要的、只排新的或设置变了的（同一个 ID 再排就是替换）。每一条都要
      // 过一次桥，App 在后台时随时会被挂起；这样中途停下，还要的提醒一条也不会少。先取消再排，免得新旧加起来
      // 超过 iOS 的 64 条被系统丢掉。还在等的稍后提醒是用户点出来的，保留（D-318）。
      const wanted = new Set(planned.map((n) => n.id));
      const existing = new Map<string, unknown>();
      for (const n of await getAllScheduledNotificationsAsync())
        existing.set(n.identifier, (n.content.data as Record<string, unknown> | null)?.[PLAN_KEY]);
      for (const id of existing.keys())
        if (!wanted.has(id) && !id.startsWith(SNOOZE_PREFIX))
          await cancelScheduledNotificationAsync(id);
      for (const n of planned) if (existing.get(n.id) !== planOf(n)) await schedule(n);
    },
    async snoozed() {
      return (await getAllScheduledNotificationsAsync()).filter((n) =>
        n.identifier.startsWith(SNOOZE_PREFIX),
      ).length;
    },
    async snooze(planned) {
      await ensureChannel(channelName);
      await schedule(planned);
    },
    async cancel(id) {
      await cancelScheduledNotificationAsync(id);
    },
    async dismiss(notificationId) {
      await dismissNotificationAsync(notificationId);
    },
    onOpen(listener) {
      // 从提醒冷启动：最后一次点的那条（按钮的点击由 onAction 处理）。
      const last = getLastNotificationResponse();
      const lastOpens =
        last && isTap(last) ? opensOf(last.notification.request.content.data) : null;
      if (lastOpens) {
        listener(lastOpens);
        clearLastNotificationResponse();
      }
      const sub = addNotificationResponseReceivedListener((response) => {
        if (!isTap(response)) return;
        const opens = opensOf(response.notification.request.content.data);
        if (opens) listener(opens);
      });
      return () => sub.remove();
    },
    onAction(listener) {
      // iOS 在后台拉起 App 时，点击可能比这里的监听先到：先看最后一次。
      const last = getLastNotificationResponse();
      const lastAction = last && reminderActionOf(last);
      if (lastAction) {
        listener(lastAction);
        clearLastNotificationResponse();
      }
      const sub = addNotificationResponseReceivedListener((response) => {
        const action = reminderActionOf(response);
        if (action) listener(action);
      });
      return () => sub.remove();
    },
  };
}
