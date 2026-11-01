import { describe, expect, it } from 'vitest';

import { RecordToolSchema, ToolUseSchema } from './record-ops-schema';
import { QuickActionSchema, ReminderSchema, TOOL_KINDS, WorkflowStepSchema } from './schema';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';

// 关系规则 13、14（创始人 2026-10-30 同意，NEW_FORMAT §10）：结构上已经做不到的，用测试证明它做不到；
// 结构允许、但检查要拦的，用校验证明拦住了。规则 12 的测试在 record-ops.test.ts。

const reminder = {
  id: 'r',
  kind: 'reminder',
  title: 'Water the plants',
  enabled: true,
  when: { every: 'day', at: '09:00' },
  opens: 'page:home',
} as const;

/** 数据离开 App 的动作（导出、分享、存到「文件」、存到相册、打印）。 */
const LEAVES_APP = ['out.share', 'out.saveToFolder', 'out.saveToPhotos', 'out.print'];

describe('rule 13: a tool never triggers another tool', () => {
  it('a reminder has no steps and its done is a record tool, never a reference to a tool', () => {
    expect(ReminderSchema.safeParse(reminder).success).toBe(true);
    expect(
      ReminderSchema.safeParse({
        ...reminder,
        steps: [{ id: 's', action: 'out.share', params: {} }],
      }).success,
    ).toBe(false);
    expect(ReminderSchema.safeParse({ ...reminder, runs: 'pdf-merge' }).success).toBe(false);
    expect(ReminderSchema.safeParse({ ...reminder, done: { tool: 'pdf-merge' } }).success).toBe(
      false,
    );
    expect(RecordToolSchema.safeParse({ do: 'create', table: 't', tool: 'x' }).success).toBe(false);
    // 块上的就地工具也不能顺带引用一个工具。
    expect(ToolUseSchema.safeParse({ do: 'create', table: 't', tool: 'x' }).success).toBe(false);
  });

  it('a quick action step is a catalog action, never another quick action or reminder', () => {
    expect(WorkflowStepSchema.safeParse({ id: 's', action: 'pdf-merge', params: {} }).success).toBe(
      false,
    );
    // 目录里没有任何动作的参数是「选一个工具」：参数的种类里没有，参数名里也没有。
    const kinds = new Set<string>();
    for (const action of registry.actions.values())
      for (const field of action.fields) {
        kinds.add(field.kind);
        expect({ action: action.id, key: field.key }).not.toEqual({
          action: action.id,
          key: expect.stringMatching(/workflow|quickAction|reminder|^tool/i),
        });
      }
    expect([...kinds].filter((k) => /tool|workflow|action|reminder/i.test(k))).toEqual([]);
  });

  it('only quick actions run steps; a reminder only opens', () => {
    expect(TOOL_KINDS.quickAction.runs).toBe('steps');
    expect(TOOL_KINDS.reminder.runs).toBe('opens');
    expect(Object.keys(QuickActionSchema.shape)).toContain('steps');
    expect(Object.keys(ReminderSchema.shape)).not.toContain('steps');
  });

  it("a reminder's done acts on this entry: setAll and ask are rejected", () => {
    const config = fromV33(v33Fixture('default-en'));
    config.data.tables.push({
      id: 'plants',
      name: 'Plants',
      fields: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'watered', name: 'Watered', type: 'date' },
        { id: 'plan', name: 'Plan', type: 'schedule', lastDone: 'watered' },
      ],
    });
    config.data.tables.push({
      id: 'notes',
      name: 'Notes',
      fields: [{ id: 'watered', name: 'Day', type: 'date' }],
    });
    const withDone = (done: unknown) => {
      const copy = structuredClone(config);
      copy.tools.push({
        ...reminder,
        when: { each: { table: 'plants', field: 'plan' }, at: '09:00' },
        done,
      } as never);
      const r = validateWorkspace(copy, registry);
      return r.ok ? '' : r.issues.map((i) => i.message).join('\n');
    };
    expect(withDone({ do: 'set', table: 'plants', field: 'watered', value: 'today' })).toBe('');
    expect(withDone({ do: 'setAll', table: 'plants', field: 'watered', value: null })).toMatch(
      /done acts on this entry/,
    );
    expect(withDone({ do: 'create', table: 'plants', ask: 'all' })).toMatch(/can't ask/);
    // 关系规则 12：「完成」写的是这一条（when.each.table）。
    expect(withDone({ do: 'set', table: 'notes', field: 'watered', value: 'today' })).toMatch(
      /so table must be plants, not notes/,
    );
  });
});

describe('rule 14: data leaves the app only when the user taps', () => {
  it('the actions that take data out of the app are catalog actions, usable only as steps', () => {
    for (const id of LEAVES_APP) expect(registry.actions.has(id)).toBe(true);
  });

  it('only tools the user taps run steps; time-triggered tools only open', () => {
    for (const [kind, meta] of Object.entries(TOOL_KINDS)) {
      if (meta.trigger !== 'tap')
        expect({ kind, runs: meta.runs }).toEqual({ kind, runs: 'opens' });
    }
    // 提醒（时间触发）的结构里没有步骤，所以挂不上分享、导出、存到「文件」。
    for (const action of LEAVES_APP)
      expect(
        ReminderSchema.safeParse({ ...reminder, steps: [{ id: 's', action, params: {} }] }).success,
      ).toBe(false);
  });

  it('a reminder opens a quick action only to show it; it never runs it', () => {
    const config = fromV33(v33Fixture('setup-pdf-zh'));
    config.tools.push({ ...reminder, opens: 'tool:pdf-merge' } as never);
    expect(validateWorkspace(config, registry).ok).toBe(true);
    // 提醒不能打开工具包或文件（只能是页面、系统入口或 tool:<id>）。
    for (const opens of ['package:pdf', { file: null }])
      expect(ReminderSchema.safeParse({ ...reminder, opens }).success).toBe(false);
  });
});
