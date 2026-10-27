import { ReminderTargetSchema, type ReminderTarget } from '@morph/core';
import {
  addNotificationResponseReceivedListener,
  AndroidImportance,
  cancelAllScheduledNotificationsAsync,
  clearLastNotificationResponse,
  getLastNotificationResponse,
  getPermissionsAsync,
  requestPermissionsAsync,
  SchedulableTriggerInputTypes,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
  type SchedulableNotificationTriggerInput,
} from 'expo-notifications';
import { Platform } from 'react-native';

import { OPENS_KEY, type NotificationPlatform } from './platform';

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
let channelNamed: string | null = null;
/** Android 8 起通知要有频道：「提醒」一个，默认重要程度。换了界面语言（D-254）时同一个频道改名。 */
function ensureChannel(name: string) {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady || channelNamed !== name) {
    channelNamed = name;
    channelReady = setNotificationChannelAsync(CHANNEL, {
      name,
      importance: AndroidImportance.DEFAULT,
    });
  }
  return channelReady;
}

const opensOf = (data: unknown): ReminderTarget | null => {
  const raw = (data as Record<string, unknown> | null | undefined)?.[OPENS_KEY];
  const parsed = ReminderTargetSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export function expoReminders(channelName: () => string): NotificationPlatform {
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
      await ensureChannel(channelName());
      // Morph 只用 expo-notifications 排提醒（长任务的进度通知走 morph-background，不受影响）。
      await cancelAllScheduledNotificationsAsync();
      for (const n of planned) {
        const channelId = CHANNEL;
        const trigger: SchedulableNotificationTriggerInput =
          n.trigger.kind === 'daily'
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
        await scheduleNotificationAsync({
          identifier: n.id,
          content: { title: n.title, body: n.body, data: { [OPENS_KEY]: n.opens } },
          trigger,
        });
      }
    },
    onOpen(listener) {
      // 从提醒冷启动：最后一次点的那条。
      const last = getLastNotificationResponse();
      const lastOpens = last ? opensOf(last.notification.request.content.data) : null;
      if (lastOpens) {
        listener(lastOpens);
        clearLastNotificationResponse();
      }
      const sub = addNotificationResponseReceivedListener((response) => {
        const opens = opensOf(response.notification.request.content.data);
        if (opens) listener(opens);
      });
      return () => sub.remove();
    },
  };
}
