import { calendarOf, dateOfDayNumber, todayNumber, weekStartOf, type Calendar } from './calendar';
import { conditionProblems } from './conditions';
import {
  filterRecords,
  isSystemField,
  linkTitle,
  localDate,
  readValue,
  recordDay,
  scheduleDoneDays,
  type DataRecord,
} from './data';
import { dayNumber } from './formula';
import { t } from './messages';
import { createInput, recordActionProblems, rowUpdateInput, type ReminderDone } from './record-ops';
import { expandCollection } from './related';
import { scheduleOccurrences, type ScheduleRule } from './schedule';
import {
  pageIdOf,
  workflowTargetId,
  type Collection,
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
/** 系统待发通知的上限（iOS 64 条，D-319）：全部提醒加上稍后提醒一起不超过它，超了只排最近的。 */
export const MAX_PENDING_NOTIFICATIONS = 64;
/** 按记录排的提醒（scheduleField）最多排几条（D-319，待创始人确认）：最近的先排。 */
export const MAX_RECORD_NOTIFICATIONS = 40;
/** 每条记录最多往后排几次（之后的等 App 下次重排）。 */
export const RECORD_OCCURRENCES = 7;

/** 快捷操作的提醒目标 workflow:<id> → id；不是时为 null。 */
export const reminderWorkflowId = (target: ReminderTarget): string | null =>
  workflowTargetId(target);

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
  if (r.schedule === 'scheduleField') problems.push(...recordReminderProblems(r, config));
  else if (r.unless || r.done || r.snoozeMinutes !== undefined)
    problems.push(
      `${where}: unless, done and snoozeMinutes only work with schedule "scheduleField"`,
    );
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

/** 按记录排的提醒（D-316–D-318）：日程字段、unless 条件、「完成」按钮的操作。 */
function recordReminderProblems(r: Reminder, config: WorkspaceConfig): string[] {
  const where = `reminder ${r.id}`;
  const collection = config.collections.find((c) => c.id === r.collectionId);
  if (!collection) return [`${where}: data table ${String(r.collectionId)} does not exist`];
  const problems: string[] = [];
  if (collection.fields.find((f) => f.id === r.fieldId)?.type !== 'schedule')
    problems.push(`${where}: fieldId must be a schedule field of ${collection.id}`);
  const u = r.unless;
  if (u) {
    const other = config.collections.find((c) => c.id === u.collectionId);
    if (!other) problems.push(`${where} unless: data table ${u.collectionId} does not exist`);
    else {
      problems.push(
        ...conditionProblems(u.filter, expandCollection(config.collections, other)).map(
          (x) => `${where} unless: ${x}`,
        ),
      );
      const date = u.dateField;
      const dateType = date && other.fields.find((f) => f.id === date)?.type;
      if (date && !isSystemField(date) && dateType !== 'date' && dateType !== 'datetime')
        problems.push(`${where} unless: dateField must be a date or datetime field of ${other.id}`);
      if (u.link !== undefined) {
        const link = other.fields.find((f) => f.id === u.link);
        if (link?.type !== 'link' || link.collectionId !== collection.id)
          problems.push(
            `${where} unless: link must be a link field of ${other.id} pointing to ${collection.id}`,
          );
      }
    }
  }
  if (r.done)
    problems.push(
      ...recordActionProblems(r.done, config, {
        label: `${where} done`,
        rowOf: collection,
      }),
    );
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
  /** 按记录排的提醒：是哪条记录（「完成」和「稍后提醒」按钮用）。 */
  recordId?: string;
  /** 通知上的按钮（D-318）：完成、稍后提醒，或者两个都有。 */
  buttons?: NotificationButtons;
}

export type NotificationButtons = 'done' | 'snooze' | 'doneSnooze';

/** 提醒上有哪些按钮。 */
export function reminderButtons(r: Reminder): NotificationButtons | undefined {
  if (r.done && r.snoozeMinutes !== undefined) return 'doneSnooze';
  if (r.done) return 'done';
  return r.snoozeMinutes !== undefined ? 'snooze' : undefined;
}

export interface PlanOptions {
  /** 已经占用的待发通知（稍后提醒），从上限里扣掉。 */
  reserved?: number;
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
  options: PlanOptions = {},
): PlannedNotification[] {
  const repeating: PlannedNotification[] = [];
  const dated: PlannedNotification[] = [];
  const perRecord: PlannedNotification[] = [];
  const cal = calendarOf(config);
  for (const r of config.reminders ?? []) {
    if (!r.enabled || reminderProblems(r, config).length > 0) continue;
    const { hour, minute } = hm(r.time);
    const base = { reminderId: r.id, title: r.title, opens: r.opens };
    if (r.schedule === 'scheduleField') {
      perRecord.push(...planRecordReminder(r, config, records, now, locale, cal));
    } else if (r.schedule === 'daily') {
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
        // 通知会出现在锁屏上：正文只写表名，不写记录的标题（P-043 ②）。
        const table = collection.name;
        const body =
          before === 0
            ? t(locale, 'reminderDueToday', { table })
            : t(locale, 'reminderDueIn', {
                table,
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
  const at = (n: PlannedNotification) => (n.trigger as { at: number }).at;
  const byTime = (a: PlannedNotification, b: PlannedNotification) => at(a) - at(b);
  dated.sort(byTime);
  perRecord.sort(byTime);
  // 系统上限（D-319）：重复的提醒每条只占一个位置，先排；剩下的位置给到期提醒和按记录的提醒，最近的先排。
  const room = Math.max(0, MAX_PENDING_NOTIFICATIONS - (options.reserved ?? 0) - repeating.length);
  const timed = [
    ...dated.slice(0, MAX_DATE_NOTIFICATIONS),
    ...perRecord.slice(0, MAX_RECORD_NOTIFICATIONS),
  ].sort(byTime);
  return [...repeating.slice(0, MAX_PENDING_NOTIFICATIONS), ...timed.slice(0, room)];
}

/** 天数那一天的 hour:minute（本机时间）。早于一天开始的钟点时是下一个日历日的（D-286）。 */
function atDay(day: number, hour: number, minute: number, cal: Calendar): number {
  const [y, m, d] = dateOfDayNumber(day).split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d + (hour < cal.dayStartHour ? 1 : 0), hour, minute).getTime();
}

/** 这一天所在的这一天 / 这一周 / 这个月（天数，含两端）。 */
function periodAround(day: number, within: 'day' | 'week' | 'month', cal: Calendar) {
  if (within === 'day') return [day, day] as const;
  if (within === 'week') return [weekStartOf(day, cal), weekStartOf(day, cal) + 6] as const;
  const [y, m] = dateOfDayNumber(day).split('-').map(Number) as [number, number];
  return [
    dayNumber(localDate(new Date(y, m - 1, 1)))!,
    dayNumber(localDate(new Date(y, m, 0)))!,
  ] as const;
}

/**
 * unless（D-317）：record 这条的 day 那天要不要跳过。看 unless 表里符合筛选的记录（同一张表只看这条自己，
 * 有 link 只看指向这条的）有没有一条落在那天所在的时间段里。
 */
export function reminderSkipped(
  r: Reminder,
  record: DataRecord,
  day: number,
  config: WorkspaceConfig,
  records: ReadonlyMap<string, readonly DataRecord[]>,
  now: Date,
): boolean {
  const u = r.unless;
  if (!u) return false;
  const table = config.collections.find((c) => c.id === u.collectionId);
  if (!table) return false;
  const cal = calendarOf(config);
  const view = expandCollection(config.collections, table);
  const [from, to] = periodAround(day, u.within, cal);
  const candidates = (records.get(table.id) ?? []).filter((x) =>
    table.id === r.collectionId
      ? x.id === record.id
      : u.link === undefined || x.values[u.link] === record.id,
  );
  return filterRecords(candidates, view, u.filter, now, cal).some((x) => {
    const date = recordDay(x, view, u.dateField ?? 'createdAt', now, cal);
    const n = date === undefined ? undefined : dayNumber(date);
    return n !== undefined && n >= from && n <= to;
  });
}

/**
 * 一个 scheduleField 提醒要排的通知（D-316）：每条记录按自己的日程接下来几次，每次在 time；已经过去的、
 * unless 说要跳过的不排。标题是记录的标题，在本机拼出来（AI 看不到记录），正文是提醒的 title。
 */
function planRecordReminder(
  r: Reminder,
  config: WorkspaceConfig,
  records: ReadonlyMap<string, readonly DataRecord[]>,
  now: Date,
  locale: Locale,
  cal: Calendar,
): PlannedNotification[] {
  const collection = config.collections.find((c) => c.id === r.collectionId)!;
  const field = collection.fields.find((f) => f.id === r.fieldId) as Extract<
    Collection['fields'][number],
    { type: 'schedule' }
  >;
  const { hour, minute } = hm(r.time);
  const today = todayNumber(now, cal);
  const buttons = reminderButtons(r);
  const out: PlannedNotification[] = [];
  for (const record of records.get(collection.id) ?? []) {
    const rule = readValue(field, record.values[field.id]) as ScheduleRule | undefined;
    if (!rule) continue;
    const done = scheduleDoneDays(record, collection, field, now, cal);
    // 多算一次：今天的时间已经过了时用后面的补上。
    const days = scheduleOccurrences(rule, done, today, RECORD_OCCURRENCES + 1, cal);
    const title = linkTitle(record, collection, locale);
    let added = 0;
    for (const day of days) {
      if (added >= RECORD_OCCURRENCES) break;
      const time = atDay(day, hour, minute, cal);
      if (time <= now.getTime() || reminderSkipped(r, record, day, config, records, now)) continue;
      out.push({
        id: `${r.id}-${record.id}-${day}`,
        reminderId: r.id,
        title,
        body: r.title,
        trigger: { kind: 'date', at: time },
        opens: r.opens,
        recordId: record.id,
        ...(buttons ? { buttons } : {}),
      });
      added++;
    }
  }
  return out;
}

/**
 * 「完成」按钮要写什么（D-318）：create 是新记录的表单输入（"row" 指这条），set / increment 是这条记录要改的值。
 * 字段已经不在了时为 null。结果再交给 prepareRecordValues。
 */
export function reminderDoneInput(
  done: ReminderDone,
  config: WorkspaceConfig,
  collection: Collection,
  record: DataRecord,
  now: Date,
):
  | { kind: 'create'; collection: Collection; input: Record<string, unknown> }
  | { kind: 'update'; input: Record<string, unknown> }
  | null {
  const cal = calendarOf(config);
  if (done.do === 'create') {
    const target = config.collections.find((c) => c.id === done.collectionId);
    if (!target) return null;
    return {
      kind: 'create',
      collection: target,
      input: createInput(target, done.values, { now, cal, rowId: record.id }),
    };
  }
  const input = rowUpdateInput({ ...done, label: 'done' }, collection, record.values, { now, cal });
  return input ? { kind: 'update', input } : null;
}

/** 稍后提醒的通知 ID（一条记录一个，重排时保留，点了「完成」时取消）。 */
export const snoozeId = (reminderId: string, recordId: string) =>
  `snooze-${reminderId}-${recordId}`;

/**
 * 到期提醒和按记录排的提醒要读哪些表的记录（按记录排的要算好的记录：日程的 lastDone 可能是汇总，
 * unless 的筛选可能用查找来的值）。
 */
export const reminderCollections = (config: WorkspaceConfig): string[] => [
  ...new Set(
    (config.reminders ?? []).flatMap((r) => {
      if (!r.enabled || !r.collectionId) return [];
      if (r.schedule === 'dateField') return [r.collectionId];
      if (r.schedule !== 'scheduleField') return [];
      return r.unless ? [r.collectionId, r.unless.collectionId] : [r.collectionId];
    }),
  ),
];

/** 有没有开着的提醒（没有时不申请通知权限）。 */
export const hasActiveReminders = (config: WorkspaceConfig) =>
  (config.reminders ?? []).some((r) => r.enabled);
