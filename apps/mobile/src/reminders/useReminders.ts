import {
  calendarOf,
  hasActiveReminders,
  loadComputedRecords,
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

import { t } from '../i18n';
import { useNavigate } from '../shell/navigation';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { NotificationPermission, NotificationPlatform } from './platform';
import type { ReminderActionResult } from './reminder-actions';

// 提醒（D-251）：配置或记录有变化时重新排本地通知；点提醒只打开页面或快捷操作，绝不运行。

/** 通知权限的状态（设置 → 提醒 显示「通知已关闭」用）。 */
export const useNotificationState = create<{ permission: NotificationPermission | null }>(() => ({
  permission: null,
}));

let syncing: Promise<unknown> = Promise.resolve();

/**
 * 重新排提醒。没有开着的提醒时只清掉已排的，不问权限；第一次真的有提醒要排时才弹系统的权限请求，
 * 用户拒绝了就不排（设置页说明怎么打开）。返回权限状态（没有提醒时为 null）。
 * 一次排完再排下一次：界面和提醒按钮（D-318）可能同时要重排，交错着取消和排会留下旧的通知。
 */
export function syncReminders(
  platform: NotificationPlatform,
  config: WorkspaceConfig,
  listRecords: (collectionId: string) => Promise<DataRecord[]>,
  locale: Locale,
  now: Date,
): Promise<NotificationPermission | null> {
  const run = () => sync(platform, config, listRecords, locale, now);
  const next = syncing.then(run, run);
  syncing = next.catch(() => undefined);
  return next;
}

async function sync(
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
  // 算好的记录：日程的「上次完成」可能是汇总，unless 的筛选可能用查找来的值（D-316、D-317）。
  const records = new Map<string, DataRecord[]>();
  for (const id of reminderCollections(config)) {
    const collection = config.collections.find((c) => c.id === id);
    if (!collection) continue;
    const loaded = await loadComputedRecords(
      listRecords,
      config.collections,
      collection,
      now,
      calendarOf(config),
    );
    records.set(id, loaded.records);
  }
  const reserved = await platform.snoozed();
  await platform.replaceAll(planNotifications(config, records, now, locale, { reserved }));
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

/**
 * 界面开着时点了提醒上的「完成」（D-318）：记录列表刷新，提示一下写了哪条。onAction 是入口里
 * background.ts 的 onReminderAction。
 */
export function useReminderActionFeedback(
  onAction: (listener: (result: ReminderActionResult) => void) => () => void,
) {
  const { locale } = useWorkspaceContext();
  const bump = useWorkspace((s) => s.bumpRecords);
  const showToast = useWorkspace((s) => s.showToast);
  useEffect(() => {
    return onAction((result) => {
      if (result.kind !== 'done') return;
      bump();
      showToast({ message: t(locale, 'reminderDoneToast', { title: result.title }) });
    });
  }, [onAction, locale, bump, showToast]);
}
