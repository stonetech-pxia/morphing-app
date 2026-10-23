import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import { createStarterWorkspace } from '../starter';
import { registry } from '../test-helpers';
import { workflowProblems } from '../workflow/check';
import { GUIDE_GOALS, goalPlan } from './goals';
import { createMockAIProvider } from './mock';

const now = new Date(2026, 9, 23, 9, 0);

describe('guide goals (D-149)', () => {
  const ai = createMockAIProvider();

  it.each(GUIDE_GOALS.flatMap((g) => (['zh', 'en'] as const).map((l) => [g.id, l, g] as const)))(
    '%s (%s) builds a working quick action with notes',
    async (_id, locale, goal) => {
      const config = createStarterWorkspace(locale, registry);
      const plan = await ai.plan(goal.text[locale], { config, registry, locale });
      expect(plan.kind).toBe('ops');
      if (plan.kind !== 'ops') return;
      expect(plan.notes).toEqual(goal.notes.map((n) => n[locale]));
      expect(plan.homeEntry).toBeUndefined();
      const prepared = prepareOps(config, plan.ops, { registry, locale, now });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      const added = prepared.after.workflows.find((w) => w.name === goal.name[locale])!;
      expect(added.steps.map((s) => s.action)).toEqual(goal.steps(locale).map((s) => s.action));
      expect(workflowProblems(added, registry)).toEqual([]);
    },
  );

  it('accepts close variants and punctuation', () => {
    const config = createStarterWorkspace('zh', registry);
    const ctx = { config, registry, locale: 'zh' as const };
    for (const text of [
      '我有很多旅游照片想分享给家人。',
      '我录了个视频，发不出去',
      '我有几份PDF，想合并成一份并加页码',
    ]) {
      expect(goalPlan(text, ctx)?.kind).toBe('ops');
    }
  });

  it('leaves preset and step sentences to the other rules', () => {
    const config = createStarterWorkspace('zh', registry);
    const ctx = { config, registry, locale: 'zh' as const };
    expect(goalPlan('添加视频太大发不出去快捷操作', ctx)).toBeNull();
    expect(goalPlan('新建一个快捷操作：选视频，压到 20MB，分享', ctx)).toBeNull();
  });

  it('gives a second copy its own id and name', async () => {
    const locale = 'zh' as const;
    let config = createStarterWorkspace(locale, registry);
    for (let i = 0; i < 2; i++) {
      const plan = await ai.plan(GUIDE_GOALS[0]!.text.zh, { config, registry, locale });
      if (plan.kind !== 'ops') throw new Error(plan.kind);
      const prepared = prepareOps(config, plan.ops, { registry, locale, now });
      if (!prepared.ok) throw new Error(prepared.issues.join());
      config = prepared.after;
    }
    const names = config.workflows.map((w) => w.name);
    expect(names).toContain('发旅行照片给朋友');
    expect(names).toContain('发旅行照片给朋友 2');
  });
});
