import {
  hasActiveReminders,
  planNotifications,
  reminderCollections,
  reminderWorkflowId,
  type DataRecord,
  type Locale,
  type NavTarget,
  type ReminderTarget,
  type WorkspaceConfig,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { create } from 'zustand';

import { useNavigate } from '../shell/navigation';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { NotificationPermission, NotificationPlatform } from './platform';

// 提醒（D-251）：配置或记录有变化时重新排本地通知；点提醒只打开页面或快捷操作，绝不运行。

/** 通知权限的状态（设置 → 提醒 显示「通知已关闭」用）。 */
export const useNotificationState = create<{ permission: NotificationPermission | null }>(() => ({
  permission: null,
}));

/**
 * 重新排提醒。没有开着的提醒时只清掉已排的，不问权限；第一次真的有提醒要排时才弹系统的权限请求，
 * 用户拒绝了就不排（设置页说明怎么打开）。返回权限状态（没有提醒时为 null）。
 */
export async function syncReminders(
  platform: NotificationPlatform,
  config: WorkspaceConfig,
  listRecords: (collectionId: string) => Promise<DataRecord[]>,
  locale: Locale,
  now: Date,
): Promise<NotificationPermission | null> {
  if (!hasActiveReminders(config)) {
    await platform.replaceAll([]);
    return null;
  }
  let permission = await platform.permission();
  if (permission === 'undetermined') permission = (await platform.request()) ? 'granted' : 'denied';
  if (permission !== 'granted') return permission;
  const records = new Map<string, DataRecord[]>();
  for (const id of reminderCollections(config)) records.set(id, await listRecords(id));
  await platform.replaceAll(planNotifications(config, records, now, locale));
  return permission;
}

/** 配置里的提醒、用到的表或记录变了就重排（D-251）。 */
export function useReminderSync(platform: NotificationPlatform | null) {
  const { repo, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config);
  const recordsVersion = useWorkspace((s) => s.recordsVersion);
  const reminders = config?.reminders;
  useEffect(() => {
    if (!platform || !config) return;
    syncReminders(platform, config, (id) => repo.listRecords(id), locale, new Date())
      .then((permission) => permission && useNotificationState.setState({ permission }))
      .catch(() => undefined);
    // 只在提醒的设置、用到的表或记录变了时重排（config 里其他部分变了不用）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, reminders, config?.collections, recordsVersion, repo, locale]);
}

/** 点了提醒去哪里：快捷操作去它的提醒页（不是运行页，运行页一打开就开始运行），其他照常打开。 */
export function reminderDestination(
  opens: ReminderTarget,
): { kind: 'workflow'; workflowId: string } | { kind: 'target'; target: NavTarget } {
  const workflowId = reminderWorkflowId(opens);
  return workflowId !== null
    ? { kind: 'workflow', workflowId }
    : { kind: 'target', target: opens as NavTarget };
}

/** 点了提醒：快捷操作打开它的提醒页（用户自己点「开始」），页面和系统入口照常打开。 */
export function useReminderOpen(platform: NotificationPlatform | null) {
  const router = useRouter();
  const navigate = useNavigate();
  useEffect(() => {
    if (!platform) return;
    return platform.onOpen((opens: ReminderTarget) => {
      const to = reminderDestination(opens);
      if (to.kind === 'workflow')
        router.push({ pathname: '/reminder/[workflowId]', params: { workflowId: to.workflowId } });
      else navigate(to.target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);
}
