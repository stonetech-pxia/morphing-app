import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import { registry } from '../test-helpers';
import { EVAL_CASES, buildSetup, judgeEval } from './eval-cases';
import { createMockAIProvider } from './mock';

// mock AI 必须通过评测集中所有标记为 mock 的用例；改写用例（P*）留给真实模型。
describe('eval cases on the mock AI', () => {
  const ai = createMockAIProvider();
  const now = new Date(2026, 9, 22, 9, 0);

  it.each(EVAL_CASES.filter((c) => c.mock).map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const config = buildSetup(c.setup, c.locale, registry);
    const plan = await ai.plan(c.input, { config, registry, locale: c.locale });
    const prepared =
      plan.kind === 'ops'
        ? prepareOps(config, plan.ops, { registry, locale: c.locale, now })
        : null;
    expect(judgeEval(c, plan, prepared)).toEqual({ pass: true });
  });

  it('the mock does not pretend to understand paraphrases', async () => {
    for (const c of EVAL_CASES.filter((x) => !x.mock)) {
      const config = buildSetup(c.setup, c.locale, registry);
      const plan = await ai.plan(c.input, { config, registry, locale: c.locale });
      // 不要求通过，但不能产出不合法的修改。
      if (plan.kind === 'ops') {
        expect(prepareOps(config, plan.ops, { registry, locale: c.locale, now }).ok).toBe(true);
      }
    }
  });
});
