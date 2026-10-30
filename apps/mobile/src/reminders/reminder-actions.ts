import {
  RECORD_LIMITS,
  calendarOf,
  linkTitle,
  migrateWorkspace,
  prepareRecordValues,
  reminderButtons,
  reminderDoneInput,
  reminderTable,
  remindersOf,
  snoozeId,
  type Locale,
  type WorkspaceConfig,
} from '@morph/core';

import { newAssetId } from '../runtime/runner';
import type { WorkspaceRepo } from '../storage/types';
import type { NotificationPlatform, ReminderAction } from './platform';
import { syncReminders } from './useReminders';

// 提醒通知上的按钮（D-318）：「完成」对这条记录做提醒里配好的一键操作，「稍后提醒」过几分钟再提醒一次。
// 用户点了才做；只写记录（和表单一样直接写数据库，不经过 AI、不生成版本），不运行快捷操作、不打开 AI。
// App 可能是被系统在后台拉起来的，所以配置从数据库现读，不依赖界面。

export interface ReminderActionDeps {
  repo: WorkspaceRepo;
  platform: NotificationPlatform;
  locale: Locale;
  now: () => Date;
}

export type ReminderActionResult =
  | { kind: 'done'; title: string }
  | { kind: 'snoozed' }
  /** 已经处理过、提醒或记录不在了、写不进去：什么也没写。 */
  | { kind: 'skipped' };

/** 处理过的点击（同一次点击可能从两条路送到）；存在设备上，App 重启也不会再做一遍。 */
const HANDLED_KEY = 'reminderActionsHandled';
const HANDLED_KEEP = 30;
/** 没写 snoozeMinutes 时（旧配置不会有，只是保险）。 */
const DEFAULT_SNOOZE = 10;

let queue: Promise<unknown> = Promise.resolve();

/** 一个接一个处理：连点两下「完成」也不会两次都从同一个旧值加。 */
export function handleReminderAction(
  action: ReminderAction,
  deps: ReminderActionDeps,
): Promise<ReminderActionResult> {
  const next = queue.then(
    () => handle(action, deps),
    () => handle(action, deps),
  );
  queue = next.catch(() => undefined);
  return next;
}

async function handled(repo: WorkspaceRepo): Promise<string[]> {
  try {
    const raw = await repo.getMeta(HANDLED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function loadConfig(repo: WorkspaceRepo): Promise<WorkspaceConfig | null> {
  const head = await repo.getHead();
  if (!head) return null;
  const migrated = migrateWorkspace(head.config);
  return migrated.ok ? (migrated.config as WorkspaceConfig) : null;
}

async function handle(
  action: ReminderAction,
  { repo, platform, locale, now }: ReminderActionDeps,
): Promise<ReminderActionResult> {
  const seen = await handled(repo);
  if (seen.includes(action.key)) return { kind: 'skipped' };
  await repo.setMeta(HANDLED_KEY, JSON.stringify([...seen, action.key].slice(-HANDLED_KEEP)));
  // Android 点了按钮通知不会自己收起来。
  await platform.dismiss(action.notificationId).catch(() => undefined);

  const config = await loadConfig(repo);
  const r = config
    ? remindersOf(config).find((x) => x.id === action.reminderId && 'each' in x.when)
    : undefined;
  const table = r && reminderTable(r)?.table;
  const collection = config?.data.tables.find((c) => c.id === table);
  const record = await repo.getRecord(action.recordId);
  if (!config || !r || !collection || !record || record.deletedAt !== null)
    return { kind: 'skipped' };
  const at = now();
  const title = linkTitle(record, collection, locale);

  if (action.button === 'snooze') {
    const minutes = r.snoozeMinutes ?? DEFAULT_SNOOZE;
    const buttons = reminderButtons(r);
    await platform.snooze({
      id: snoozeId(r.id, record.id),
      reminderId: r.id,
      title,
      body: r.title,
      trigger: { kind: 'date', at: at.getTime() + minutes * 60_000 },
      opens: r.opens,
      recordId: record.id,
      ...(buttons ? { buttons } : {}),
    });
    return { kind: 'snoozed' };
  }

  if (!r.done) return { kind: 'skipped' };
  const cal = calendarOf(config);
  const planned = reminderDoneInput(r.done, config, collection, record, at);
  if (!planned) return { kind: 'skipped' };
  if (planned.kind === 'create') {
    const counts = await repo.countRecords();
    const count = counts.find((c) => c.collectionId === planned.collection.id)?.count ?? 0;
    if (count >= RECORD_LIMITS.perCollection) return { kind: 'skipped' };
    const prepared = prepareRecordValues(planned.collection, planned.input, null, at, cal);
    // 存不进去（旧配置里必填字段没有值）：后台没法打开表单，什么也不写。
    if (!prepared.ok) return { kind: 'skipped' };
    await repo.insertRecord({
      id: newAssetId(),
      collectionId: planned.collection.id,
      values: prepared.values,
      createdAt: at.getTime(),
      updatedAt: at.getTime(),
    });
  } else {
    const prepared = prepareRecordValues(collection, planned.input, record.values, at, cal);
    if (!prepared.ok) return { kind: 'skipped' };
    await repo.updateRecord(record.id, prepared.values, at.getTime());
  }
  // 做完了：这条的稍后提醒不用了；记录变了，提醒重新排（D-316）。
  await platform.cancel(snoozeId(r.id, record.id)).catch(() => undefined);
  await syncReminders(platform, config, (id) => repo.listRecords(id), locale, at);
  return { kind: 'done', title };
}
