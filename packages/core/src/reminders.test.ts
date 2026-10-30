import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { DataRecord } from './data';
import type { Op } from './ops';
import { planNotifications } from './reminders';
import type { Collection, Reminder, WorkspaceConfig } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';

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
  kind: 'reminder',
  title: '记账',
  enabled: true,
  when: { every: 'day', at: '09:00' },
  opens: 'page:home',
};
const dueSoon: Reminder = {
  id: 'due',
  kind: 'reminder',
  title: '账单快到期了',
  enabled: true,
  when: { before: { table: 'bills', field: 'due' }, days: 3, at: '08:30' },
  opens: 'page:home',
};
const before = (days: number): Reminder =>
  ({ ...dueSoon, when: { ...dueSoon.when, days } }) as Reminder;
const now = new Date(2026, 9, 22, 12);
const ctx = { registry, locale: 'zh' as const, now };

function setup(ops: Op[]) {
  return prepareOps(
    fromV33(v33Fixture('default-zh')),
    [{ op: 'addData', table: bills }, ...ops],
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
    const added = setup([{ op: 'addTool', tool: daily }]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.after.tools).toEqual([daily]);
    expect(added.lines).toContain('新建提醒「记账」（每天 09:00）');

    const changed = prepareOps(
      added.after,
      [
        {
          op: 'updateTool',
          tool: 'log',
          changes: { when: { every: 'day', at: '21:30' }, enabled: false },
        },
      ],
      ctx,
    );
    expect(changed.ok && changed.after.tools[0]).toMatchObject({
      when: { at: '21:30' },
      enabled: false,
    });
    const removed = prepareOps(added.after, [{ op: 'removeTool', tool: 'log' }], ctx);
    expect(removed.ok && removed.after.tools).toEqual([]);
  });

  it('refuses settings that can’t work', () => {
    const withBills = fromV33(v33Fixture('default-zh'));
    withBills.data.tables.push(bills);
    const ok = (r: Partial<Reminder> | Record<string, unknown>) =>
      validateWorkspace({ ...withBills, tools: [{ ...daily, ...r }] }, registry).ok;
    expect(ok({})).toBe(true);
    expect(ok(dueSoon)).toBe(true);
    expect(ok({ when: { every: 'day', at: '9:00' } })).toBe(false);
    expect(ok({ when: { every: 'week', at: '09:00' } })).toBe(false);
    expect(ok({ when: { every: 'week', days: [1, 8], at: '09:00' } })).toBe(false);
    expect(ok({ opens: 'tool:missing' })).toBe(false);
    expect(ok({ opens: 'page:missing' })).toBe(false);
    expect(
      ok({ ...dueSoon, when: { ...dueSoon.when, before: { table: 'bills', field: 'name' } } }),
    ).toBe(false);
    expect(
      ok({ ...dueSoon, when: { before: { table: 'bills', field: 'due' }, at: '08:30' } }),
    ).toBe(false);
    // 只有 when.each 能有「完成」「稍后提醒」「除非」。
    expect(ok({ snoozeMinutes: 10 })).toBe(false);
    // 不能带任何「运行」之类的设置。
    expect(ok({ run: true })).toBe(false);
  });

  it('removing the quick action a reminder opens removes the reminder too, and says so', () => {
    const wf = {
      id: 'logit',
      kind: 'quickAction' as const,
      name: '记一笔',
      steps: [{ id: 'in', action: 'in.text', params: { text: '' } }],
    };
    const start = config([
      { op: 'addTool', tool: wf },
      { op: 'addTool', tool: { ...daily, opens: 'tool:logit' } },
    ]);
    const result = prepareOps(start, [{ op: 'removeTool', tool: 'logit' }], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.tools).toEqual([]);
    expect(result.lines.join('\n')).toContain('同时移除用到它的提醒：记账');
  });
});

describe('planNotifications', () => {
  it('daily and weekly reminders repeat; weekly ones once per weekday', () => {
    const c = config([
      { op: 'addTool', tool: daily },
      {
        op: 'addTool',
        tool: {
          ...daily,
          id: 'gym',
          title: '健身',
          when: { every: 'week', days: [5, 1, 1], at: '09:00' },
        },
      },
      { op: 'addTool', tool: { ...daily, id: 'off', enabled: false } },
    ]);
    expect(planNotifications(c, new Map(), now, 'zh').map((n) => [n.id, n.trigger])).toEqual([
      ['log', { kind: 'daily', hour: 9, minute: 0 }],
      ['gym-1', { kind: 'weekly', weekday: 1, hour: 9, minute: 0 }],
      ['gym-5', { kind: 'weekly', weekday: 5, hour: 9, minute: 0 }],
    ]);
  });

  it('date reminders fire N days before each due date, skip past ones and entries without a date', () => {
    const c = config([{ op: 'addTool', tool: dueSoon }]);
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
      body: '「账单」里有一条记录还有 3 天到期（2026-10-26）',
    });
    // 通知会出现在锁屏上：正文只写表名，不写记录的标题（P-043 ②）。
    for (const n of planned) expect(n.body).not.toMatch(/宽带|房租/);
  });

  it('one day before uses the singular in every language', () => {
    const c = config([{ op: 'addTool', tool: before(1) }]);
    const records = new Map([['bills', [bill('rent', 'Rent', '2026-11-01')]]]);
    expect(planNotifications(c, records, now, 'en')[0]!.body).toBe(
      'An entry in “账单” is due in 1 day (2026-11-01)',
    );
    expect(planNotifications(c, records, now, 'fr')[0]!.body).toBe(
      'Une entrée de « 账单 » arrive à échéance dans 1 jour (2026-11-01)',
    );
  });

  it('a reminder on the due day itself says so', () => {
    const c = config([{ op: 'addTool', tool: before(0) }]);
    const [n] = planNotifications(
      c,
      new Map([['bills', [bill('rent', 'Loyer', '2026-11-01')]]]),
      now,
      'fr',
    );
    expect(n!.body).toBe('Une entrée de « 账单 » arrive à échéance aujourd’hui');
  });
});
