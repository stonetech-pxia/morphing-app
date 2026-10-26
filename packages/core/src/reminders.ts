import { linkTitle, localDate, readValue, type DataRecord } from './data';
import { t } from './messages';
import {
  pageIdOf,
  type Locale,
  type NavTarget,
  type Reminder,
  type ReminderTarget,
  type WorkspaceConfig,
} from './schema';

// 提醒（D-251）：用本地通知，不用推送、不需要服务器。配置里只有提醒的设置（AI 能新建、修改）；
// 到期提醒要的记录在本机读，正文在本机生成，记录内容不进配置、不发给 AI。
// 点通知只打开对应的页面或快捷操作，绝不自动运行任何东西（收件页面不自动运行的规则不变）。

/** iOS 最多同时排 64 条本地通知：到期提醒最多排这么多条（最近的先排），每次打开 App 再补上后面的。 */
export const MAX_DATE_NOTIFICATIONS = 48;

/** 快捷操作的提醒目标 workflow:<id> → id；不是时为 null。 */
export const reminderWorkflowId = (target: ReminderTarget): string | null =>
  target.startsWith('workflow:') ? target.slice('workflow:'.length) : null;

/** 提醒的设置有没有问题：时间表需要的参数、要打开的地方、要看的表和日期字段都要在。 */
export function reminderProblems(r: Reminder, config: WorkspaceConfig): string[] {
  const problems: string[] = [];
  const where = `reminder ${r.id}`;
  if (r.schedule === 'weekly' && !r.weekdays?.length)
    problems.push(`${where}: weekly needs weekdays`);
  if (r.schedule === 'dateField') {
    const collection = config.collections.find((c) => c.id === r.collectionId);
    if (!collection) problems.push(`${where}: data table ${String(r.collectionId)} does not exist`);
    else if (collection.fields.find((f) => f.id === r.fieldId)?.type !== 'date')
      problems.push(`${where}: fieldId must be a date field of ${collection.id}`);
    if (r.daysBefore === undefined) problems.push(`${where}: dateField needs daysBefore`);
  }
  const workflowId = reminderWorkflowId(r.opens);
  if (workflowId !== null) {
    if (!config.workflows.some((w) => w.id === workflowId))
      problems.push(`${where}: opens missing quick action ${workflowId}`);
  } else {
    const pageId = pageIdOf(r.opens as NavTarget);
    if (pageId !== null && !config.pages.some((p) => p.id === pageId))
      problems.push(`${where}: opens missing page ${pageId}`);
  }
  return problems;
}

export type NotificationTrigger =
  | { kind: 'daily'; hour: number; minute: number }
  /** weekday：1 = 周一 … 7 = 周日（App 交给 expo-notifications 时换成它的 1 = 周日）。 */
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'date'; at: number };

export interface PlannedNotification {
  /** 稳定的 ID：提醒 ID，周提醒加星期几，到期提醒加记录 ID。 */
  id: string;
  reminderId: string;
  title: string;
  body: string;
  trigger: NotificationTrigger;
  opens: ReminderTarget;
}

const hm = (time: string) => {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return { hour, minute };
};

/**
 * 要排的本地通知（纯函数，App 每次打开、提醒或记录有变化时重新排一遍）。
 * records：到期提醒用到的表的记录（没删的）。到期提醒：日期 − daysBefore 天的 time，已经过去的不排；
 * 最多 MAX_DATE_NOTIFICATIONS 条，最近的先排。
 */
export function planNotifications(
  config: WorkspaceConfig,
  records: ReadonlyMap<string, readonly DataRecord[]>,
  now: Date,
  locale: Locale,
): PlannedNotification[] {
  const repeating: PlannedNotification[] = [];
  const dated: PlannedNotification[] = [];
  for (const r of config.reminders ?? []) {
    if (!r.enabled || reminderProblems(r, config).length > 0) continue;
    const { hour, minute } = hm(r.time);
    const base = { reminderId: r.id, title: r.title, opens: r.opens };
    if (r.schedule === 'daily') {
      repeating.push({ ...base, id: r.id, body: '', trigger: { kind: 'daily', hour, minute } });
    } else if (r.schedule === 'weekly') {
      for (const weekday of [...new Set(r.weekdays)].sort()) {
        repeating.push({
          ...base,
          id: `${r.id}-${weekday}`,
          body: '',
          trigger: { kind: 'weekly', weekday, hour, minute },
        });
      }
    } else {
      const collection = config.collections.find((c) => c.id === r.collectionId)!;
      const field = collection.fields.find((f) => f.id === r.fieldId)!;
      const before = r.daysBefore ?? 0;
      for (const record of records.get(collection.id) ?? []) {
        const due = readValue(field, record.values[field.id]);
        if (typeof due !== 'string') continue;
        const [y, m, d] = due.split('-').map(Number) as [number, number, number];
        const at = new Date(y, m - 1, d - before, hour, minute);
        if (at.getTime() <= now.getTime()) continue;
        const name = linkTitle(record, collection, locale);
        const body =
          before === 0
            ? t(locale, 'reminderDueToday', { name })
            : t(locale, 'reminderDueIn', {
                name,
                n: before,
                date: localDate(new Date(y, m - 1, d)),
              });
        dated.push({
          ...base,
          id: `${r.id}-${record.id}`,
          body,
          trigger: { kind: 'date', at: at.getTime() },
        });
      }
    }
  }
  dated.sort((a, b) => (a.trigger as { at: number }).at - (b.trigger as { at: number }).at);
  return [...repeating, ...dated.slice(0, MAX_DATE_NOTIFICATIONS)];
}

/** 到期提醒要读哪些表的记录。 */
export const reminderCollections = (config: WorkspaceConfig): string[] => [
  ...new Set(
    (config.reminders ?? []).flatMap((r) =>
      r.enabled && r.schedule === 'dateField' && r.collectionId ? [r.collectionId] : [],
    ),
  ),
];

/** 有没有开着的提醒（没有时不申请通知权限）。 */
export const hasActiveReminders = (config: WorkspaceConfig) =>
  (config.reminders ?? []).some((r) => r.enabled);
