import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { createDefaultWorkspace } from './defaults';
import { applyOps, type Op } from './ops';
import type { QuickAction, WorkspaceConfig } from './schema';
import { registry } from './test-helpers';
import { validateWorkspace } from './validate';

// 快捷操作的步骤参数引用配置（CHAIN_AUDIT A3，创始人 2026-10-31）：动作目录里的参数声明自己引用一张表
// （kind collection）或这张表的字段（kind fields），检查和删表、删字段时的清理对所有动作都一样。

const ctx = (locale: 'zh' | 'en' | 'fr' = 'zh') => ({
  registry,
  locale,
  now: new Date(2026, 9, 31, 9, 0),
});

const expenses = {
  id: 'expenses',
  name: '支出',
  fields: [
    { id: 'amount', name: '金额', type: 'money', currency: 'CNY' },
    { id: 'when', name: '日期', type: 'date' },
    { id: 'receipt', name: '小票', type: 'file' },
  ],
};

function config(tools: QuickAction[]): WorkspaceConfig {
  const ops: Op[] = [
    { op: 'addData', table: expenses } as Op,
    ...tools.map((tool) => ({ op: 'addTool', tool }) as Op),
    ...(tools.some((t) => t.id === 'report')
      ? [
          {
            op: 'addContainer',
            page: 'home',
            block: { id: 'run-report', look: 'action', tools: [{ tool: 'report' }] },
          } as Op,
        ]
      : []),
  ];
  const r = applyOps(createDefaultWorkspace('zh'), ops, ctx());
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

const snap: QuickAction = {
  id: 'snap',
  kind: 'quickAction',
  name: '拍小票',
  steps: [
    { id: 'pick', action: 'in.photos', params: { source: 'camera', min: 1, max: 10 } },
    { id: 'log', action: 'out.addRecord', params: { collectionId: 'expenses' } },
  ],
};
const report: QuickAction = {
  id: 'report',
  kind: 'quickAction',
  name: '月报',
  steps: [
    { id: 'read', action: 'in.records', params: { collectionId: 'expenses', period: 'thisMonth' } },
    {
      id: 'print',
      action: 'print.records',
      params: { template: 'table', title: '支出', fields: ['when', 'amount'], pageSize: 'a4' },
    },
  ],
};

const steps = (c: WorkspaceConfig, id: string) =>
  (c.tools.find((t) => t.id === id) as QuickAction | undefined)?.steps.map((s) => s.id);

describe('removing a table or field that quick-action steps use', () => {
  it('removing the table drops the step that writes it and says so in the draft', () => {
    const before = config([snap, report]);
    const r = prepareOps(before, [{ op: 'removeData', table: 'expenses' }], ctx());
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(steps(r.after, 'snap')).toEqual(['pick']);
    expect(r.lines).toContain('快捷操作「拍小票」里「记一笔」这一步也会去掉');
  });

  it('a quick action that cannot work without the table is removed with what runs it', () => {
    const r = prepareOps(config([snap, report]), [{ op: 'removeData', table: 'expenses' }], ctx());
    if (!r.ok) throw new Error(r.issues.join('; '));
    expect(steps(r.after, 'report')).toBeUndefined();
    expect(JSON.stringify(r.after.containers)).not.toContain('run-report');
    expect(r.lines).toContain('快捷操作「月报」没有这张表就用不了，也会移除');
  });

  it('removing a field takes it out of the fields a step lists', () => {
    const r = prepareOps(
      config([report]),
      [{ op: 'removeData', table: 'expenses', field: 'when' }],
      ctx(),
    );
    if (!r.ok) throw new Error(r.issues.join('; '));
    const print = (r.after.tools.find((t) => t.id === 'report') as QuickAction).steps[1]!;
    expect(print.params.fields).toEqual(['amount']);
    expect(r.lines).toContain('快捷操作「月报」里「记录生成 PDF」这一步不再列出这个字段');
  });

  it('removing the field a step stores its files in drops that step too', () => {
    const r = prepareOps(
      config([snap]),
      [{ op: 'removeData', table: 'expenses', field: 'receipt' }],
      ctx(),
    );
    if (!r.ok) throw new Error(r.issues.join('; '));
    expect(steps(r.after, 'snap')).toEqual(['pick']);
    expect(r.lines).toContain('快捷操作「拍小票」里「记一笔」这一步也会去掉');
  });

  it('the draft text is in every language', () => {
    for (const [locale, text] of [
      ['en', 'The step “Add a record” in the quick action “拍小票” is removed too'],
      [
        'fr',
        'L’étape « Ajouter un enregistrement » de l’action rapide « 拍小票 » est retirée aussi',
      ],
    ] as const) {
      const r = prepareOps(config([snap]), [{ op: 'removeData', table: 'expenses' }], ctx(locale));
      if (!r.ok) throw new Error(r.issues.join('; '));
      expect(r.lines).toContain(text);
    }
  });

  it('a step of a quick action that came with a tool is never removed with its quick action; the removal is refused', () => {
    const base = config([report]);
    const owned = {
      ...base,
      tools: base.tools.map((t) => (t.id === 'report' ? { ...t, package: 'pdf' } : t)),
      packages: [...base.packages],
    } as WorkspaceConfig;
    const r = applyOps(owned, [{ op: 'removeData', table: 'expenses' }], ctx());
    expect(r.ok).toBe(false);
  });
});

describe('one check for every action that names a table or its fields', () => {
  it('every step parameter that names a table must name one that exists, whatever the action', () => {
    const named = [...registry.actions.values()].filter((a) =>
      a.fields.some((f) => f.kind === 'collection'),
    );
    expect(named.map((a) => a.id).sort()).toEqual(['in.records', 'out.addRecord']);
    const bad = config([
      {
        ...snap,
        steps: [
          snap.steps[0]!,
          { id: 'log', action: 'out.addRecord', params: { collectionId: 'nope' } },
        ],
      },
    ]);
    const v = validateWorkspace(bad, registry);
    expect(v.ok ? [] : v.issues.map((i) => i.message)).toEqual([
      'snap/log: data table nope does not exist',
    ]);
  });
});
