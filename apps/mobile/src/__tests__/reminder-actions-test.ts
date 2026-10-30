import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  snoozeId,
  type DataRecord,
  type Op,
  type Reminder,
  type WorkspaceConfig,
} from '@morph/core';

import type { ReminderAction } from '../reminders/platform';
import { handleReminderAction } from '../reminders/reminder-actions';
import { syncReminders } from '../reminders/useReminders';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeNotifications } from '../test-utils/fake-notifications';

// 提醒通知上的按钮（D-318）：「完成」只写这条记录、写完重排；「稍后提醒」再排一条；同一次点击只做一次。

const registry = createRegistry(BUILTIN_TOOLS);
const habitsTable: Op = {
  op: 'addCollection',
  collection: {
    id: 'habits',
    name: '习惯',
    fields: [
      { id: 'name', name: '名字', type: 'text' },
      { id: 'plan', name: '日程', type: 'schedule', lastDone: 'last' },
      { id: 'last', name: '上次', type: 'date' },
      { id: 'count', name: '次数', type: 'number' },
    ],
  },
};
const checkinsTable: Op = {
  op: 'addCollection',
  collection: {
    id: 'checkins',
    name: '打卡',
    fields: [
      { id: 'habit', name: '习惯', type: 'link', collectionId: 'habits' },
      { id: 'day', name: '日期', type: 'date', required: true },
    ],
  },
};
const base: Reminder = {
  id: 'habit',
  title: '该做了',
  enabled: true,
  schedule: 'scheduleField',
  time: '20:00',
  collectionId: 'habits',
  fieldId: 'plan',
  opens: 'page:home',
  snoozeMinutes: 15,
};
const now = new Date(2026, 9, 22, 20, 1);

async function setup(reminder: Partial<Reminder>) {
  const r = applyOps(
    createDefaultWorkspace('zh'),
    [habitsTable, checkinsTable, { op: 'addReminder', reminder: { ...base, ...reminder } }],
    { registry, locale: 'zh' },
  );
  if (!r.ok) throw new Error(r.error);
  const repo = new MemoryWorkspaceRepo();
  await repo.commitRevision({ baseId: null, config: r.config, source: 'user', summary: 'seed' });
  const run: DataRecord = {
    id: 'run',
    collectionId: 'habits',
    values: { name: '跑步', plan: { repeat: 'daily' }, count: 2 },
    createdAt: 0,
    updatedAt: 0,
  };
  await repo.insertRecord(run);
  const platform = new FakeNotifications();
  platform.status = 'granted';
  const deps = { repo, platform, locale: 'zh' as const, now: () => now };
  return { repo, platform, deps, config: r.config as WorkspaceConfig };
}
const press = (button: 'done' | 'snooze', key = 'n1:1:x'): ReminderAction => ({
  button,
  reminderId: 'habit',
  recordId: 'run',
  notificationId: 'habit-run-20748',
  key,
});

describe('the Done button (D-318)', () => {
  it('set writes this entry, then reminders are planned again from tomorrow', async () => {
    const { repo, platform, deps, config } = await setup({
      done: { do: 'set', fieldId: 'last', value: 'today' },
    });
    await syncReminders(
      platform,
      config,
      (id) => repo.listRecords(id),
      'zh',
      new Date(2026, 9, 22, 12),
    );
    expect(platform.scheduled![0]!.id).toBe('habit-run-20748');

    expect(await handleReminderAction(press('done'), deps)).toEqual({
      kind: 'done',
      title: '跑步',
    });
    expect((await repo.getRecord('run'))!.values.last).toBe('2026-10-22');
    expect(platform.dismissed).toEqual(['habit-run-20748']);
    expect(platform.cancelled).toContain(snoozeId('habit', 'run'));
    // 重排了：今天的已经过了，下一次是明天 20:00。
    expect(platform.scheduled![0]!.id).toBe('habit-run-20749');
  });

  it('increment adds to this entry; the same tap arriving twice counts once', async () => {
    const { repo, deps } = await setup({ done: { do: 'increment', fieldId: 'count', by: 1 } });
    await handleReminderAction(press('done'), deps);
    expect(await handleReminderAction(press('done'), deps)).toEqual({ kind: 'skipped' });
    expect((await repo.getRecord('run'))!.values.count).toBe(3);
    // 另一次点击照常算。
    await handleReminderAction(press('done', 'n2:2:x'), deps);
    expect((await repo.getRecord('run'))!.values.count).toBe(4);
  });

  it('create adds a check-in linked to this entry', async () => {
    const { repo, deps } = await setup({
      done: { do: 'create', collectionId: 'checkins', values: { habit: 'row', day: 'today' } },
    });
    await handleReminderAction(press('done'), deps);
    const checkins = await repo.listRecords('checkins');
    expect(checkins.map((c) => c.values)).toEqual([{ habit: 'run', day: '2026-10-22' }]);
  });

  it('writes nothing when the entry was deleted, or a required field would stay empty', async () => {
    const gone = await setup({ done: { do: 'set', fieldId: 'last', value: 'today' } });
    await gone.repo.deleteRecord('run', 1);
    expect(await handleReminderAction(press('done'), gone.deps)).toEqual({ kind: 'skipped' });

    const missing = await setup({
      done: { do: 'create', collectionId: 'checkins', values: { habit: 'row' } },
    });
    expect(await handleReminderAction(press('done'), missing.deps)).toEqual({ kind: 'skipped' });
    expect(await missing.repo.listRecords('checkins')).toEqual([]);
  });

  it('never touches anything but entries: no quick action, no AI, no new version', async () => {
    const { repo, deps } = await setup({ done: { do: 'set', fieldId: 'last', value: 'today' } });
    const before = await repo.listRevisions(10);
    await handleReminderAction(press('done'), deps);
    expect(await repo.listRevisions(10)).toEqual(before);
    expect(await repo.listToolRuns(10)).toEqual([]);
  });
});

describe('Remind me later (D-318)', () => {
  it('plans one more notification after snoozeMinutes, kept apart and counted against the limit', async () => {
    const { repo, platform, deps, config } = await setup({
      done: { do: 'set', fieldId: 'last', value: 'today' },
    });
    expect(await handleReminderAction(press('snooze'), deps)).toEqual({ kind: 'snoozed' });
    expect(platform.snoozes).toEqual([
      {
        id: snoozeId('habit', 'run'),
        reminderId: 'habit',
        title: '跑步',
        body: '该做了',
        trigger: { kind: 'date', at: now.getTime() + 15 * 60_000 },
        opens: 'page:home',
        recordId: 'run',
        buttons: 'doneSnooze',
      },
    ]);
    // 记录没变：snooze 不写记录。
    expect((await repo.getRecord('run'))!.values.last).toBeUndefined();
    // 再点「完成」：稍后提醒取消。
    await handleReminderAction(press('done', 'n3:3:x'), deps);
    expect(platform.snoozes).toEqual([]);
    expect(config.reminders).toHaveLength(1);
  });
});
