import { registerTaskAsync, type NotificationResponse } from 'expo-notifications';
import { defineTask } from 'expo-task-manager';
import { Platform } from 'react-native';

import MorphBackground from '../../modules/morph-background';
import { getDeviceLocale, t } from '../i18n';
import { openRepo } from '../storage/open';
import { expoReminders, reminderActionOf, setupReminderButtons } from './expo-reminders';
import type { ReminderAction } from './platform';
import { handleReminderAction, type ReminderActionResult } from './reminder-actions';

// 提醒通知上的按钮（D-318）在 App 没开着时也要能用。这个文件在入口（index.ts）最先加载，界面还没起来就
// 开始听按钮：
// - iOS：按钮不打开 App，系统在后台拉起或唤醒 App，点击交给这里的监听；morph-background 一收到按钮就先
//   要一段后台时间，处理完再还（releaseActionTime），否则写完之前 App 可能就被挂起。
// - Android：App 在后台或没在运行时，expo-notifications 用 expo-task-manager 跑下面的后台任务（没在运行
//   时在无界面的 JS 里跑）；App 开着时走监听。两条路可能都送到，handleReminderAction 按点击去重。

const locale = getDeviceLocale();

/** 提醒（D-251）的本地通知。频道名跟随界面语言。 */
export const reminders = expoReminders(t(locale, 'remindersTitle'));

const TASK = 'morph-reminder-buttons';

type Listener = (result: ReminderActionResult) => void;
const listeners = new Set<Listener>();

/** 界面开着时：按钮写了记录要刷新、提示一下（_layout 订阅）。 */
export function onReminderAction(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 正在处理的点击：都处理完了才还后台时间。 */
let busy = 0;
const release = () => {
  if (busy === 0) MorphBackground?.releaseActionTime();
};

async function run(action: ReminderAction) {
  busy++;
  try {
    const repo = await openRepo();
    const result = await handleReminderAction(action, {
      repo,
      platform: reminders,
      locale,
      now: () => new Date(),
    });
    for (const l of listeners) l(result);
  } finally {
    busy--;
    release();
  }
}

defineTask<NotificationResponse>(TASK, async ({ data }) => {
  const action = data && 'actionIdentifier' in data ? reminderActionOf(data) : null;
  if (action) await run(action).catch(() => undefined);
});

if (Platform.OS === 'android') registerTaskAsync(TASK).catch(() => undefined);
setupReminderButtons(locale).catch(() => undefined);
// App 在后台启动、却不是因为按钮（或点击已经处理完）：morph-background 先要的后台时间几秒后还掉。
setTimeout(release, 8000);
// 打 release 包时 Expo 会在 web 上把路由先跑一遍，web 没有通知按钮，一听就抛错、打包失败。
if (Platform.OS !== 'web') reminders.onAction((action) => void run(action).catch(() => undefined));
