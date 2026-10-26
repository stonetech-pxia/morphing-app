import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { DataRecord } from './data';
import { createDefaultWorkspace } from './defaults';
import type { Op } from './ops';
import { planNotifications } from './reminders';
import type { Collection, Reminder, WorkspaceConfig } from './schema';
import { registry } from './test-helpers';

const bills: Collection = {
  id: 'bills',
  name: '账单',
  fields: [
    { id: 'name', name: '名字', type: 'text' },
    { id: 'due', name: '到期日', type: 'date' },
  ],
};
const daily: Reminder = {
  id: 'log',
  title: '记账',
  enabled: true,
  schedule: 'daily',
  time: '09:00',
  opens: 'page:home',
};
const dueSoon: Reminder = {
  id: 'due',
  title: '账单快到期了',
  enabled: true,
  schedule: 'dateField',
  time: '08:30',
  collectionId: 'bills',
  fieldId: 'due',
  daysBefore: 3,
  opens: 'page:home',
};
const now = new Date(2026, 9, 22, 12);
const ctx = { registry, locale: 'zh' as const, now };

function setup(ops: Op[]) {
  return prepareOps(
    createDefaultWorkspace('zh'),
    [{ op: 'addCollection', collection: bills }, ...ops],
    ctx,
  );
}
function config(ops: Op[]): WorkspaceConfig {
  const r = setup(ops);
  if (!r.ok) throw new Error(r.issues.join('; '));
  return r.after;
}
const bill = (id: string, name: string, due?: string): DataRecord => ({
  id,
  collectionId: 'bills',
  values: { name, ...(due ? { due } : {}) },
  createdAt: 0,
  updatedAt: 0,
});

describe('reminder settings (D-251)', () => {
  it('can be added, changed and removed as an undoable change, and described', () => {
    const added = setup([{ op: 'addReminder', reminder: daily }]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.after.reminders).toEqual([daily]);
    expect(added.lines).toContain('新建提醒「记账」（每天 09:00）');

    const changed = prepareOps(
      added.after,
      [{ op: 'updateReminder', reminderId: 'log', changes: { time: '21:30', enabled: false } }],
      ctx,
    );
    expect(changed.ok && changed.after.reminders![0]).toMatchObject({
      time: '21:30',
      enabled: false,
    });
    const removed = prepareOps(added.after, [{ op: 'removeReminder', reminderId: 'log' }], ctx);
    expect(removed.ok && removed.after.reminders).toEqual([]);
  });

  it('refuses settings that can’t work', () => {
    const bad = (r: Partial<Reminder>) =>
      setup([{ op: 'addReminder', reminder: { ...daily, ...r } as Reminder }]).ok;
    expect(bad({ time: '9:00' })).toBe(false);
    expect(bad({ schedule: 'weekly' })).toBe(false);
    expect(bad({ schedule: 'weekly', weekdays: [1, 8] })).toBe(false);
    expect(bad({ opens: 'workflow:missing' })).toBe(false);
    expect(bad({ opens: 'page:missing' })).toBe(false);
    expect(bad({ ...dueSoon, fieldId: 'name' })).toBe(false);
    expect(bad({ ...dueSoon, daysBefore: undefined })).toBe(false);
    // 不能带任何「运行」之类的设置。
    expect(bad({ run: true } as Partial<Reminder>)).toBe(false);
  });

  it('removing the quick action a reminder opens removes the reminder too, and says so', () => {
    const wf = {
      id: 'logit',
      name: '记一笔',
      steps: [{ id: 'in', action: 'in.text', params: { text: '' } }],
    };
    const before = config([
      { op: 'addWorkflow', workflow: wf },
      { op: 'addReminder', reminder: { ...daily, opens: 'workflow:logit' } },
    ]);
    const result = prepareOps(before, [{ op: 'removeWorkflow', workflowId: 'logit' }], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.reminders).toEqual([]);
    expect(result.lines.join('\n')).toContain('同时移除用到它的提醒：记账');
  });
});

describe('planNotifications', () => {
  it('daily and weekly reminders repeat; weekly ones once per weekday', () => {
    const c = config([
      { op: 'addReminder', reminder: daily },
      {
        op: 'addReminder',
        reminder: { ...daily, id: 'gym', title: '健身', schedule: 'weekly', weekdays: [5, 1, 1] },
      },
      { op: 'addReminder', reminder: { ...daily, id: 'off', enabled: false } },
    ]);
    expect(planNotifications(c, new Map(), now, 'zh').map((n) => [n.id, n.trigger])).toEqual([
      ['log', { kind: 'daily', hour: 9, minute: 0 }],
      ['gym-1', { kind: 'weekly', weekday: 1, hour: 9, minute: 0 }],
      ['gym-5', { kind: 'weekly', weekday: 5, hour: 9, minute: 0 }],
    ]);
  });

  it('date reminders fire N days before each due date, skip past ones and entries without a date', () => {
    const c = config([{ op: 'addReminder', reminder: dueSoon }]);
    const records = new Map([
      [
        'bills',
        [
          bill('rent', '房租', '2026-11-01'),
          bill('phone', '话费', '2026-10-24'), // 提醒时间 10-21，已经过了
          bill('water', '水费', '2026-10-25'), // 提醒时间是今天 08:30，已经过了
          bill('gas', '燃气'),
          bill('net', '宽带', '2026-10-26'),
        ],
      ],
    ]);
    const planned = planNotifications(c, records, now, 'zh');
    expect(
      planned.map((n) => [n.id, new Date((n.trigger as { at: number }).at).toString()]),
    ).toEqual([
      ['due-net', new Date(2026, 9, 23, 8, 30).toString()],
      ['due-rent', new Date(2026, 9, 29, 8, 30).toString()],
    ]);
    expect(planned[0]).toMatchObject({
      title: '账单快到期了',
      body: '「宽带」还有 3 天到期（2026-10-26）',
    });
  });

  it('a reminder on the due day itself says so', () => {
    const c = config([{ op: 'addReminder', reminder: { ...dueSoon, daysBefore: 0 } }]);
    const [n] = planNotifications(
      c,
      new Map([['bills', [bill('rent', 'Loyer', '2026-11-01')]]]),
      now,
      'fr',
    );
    expect(n!.body).toBe('« Loyer » arrive à échéance aujourd’hui');
  });
});
