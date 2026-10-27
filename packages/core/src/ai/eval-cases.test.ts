import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import { registry } from '../test-helpers';
import { EVAL_CASES, buildSetup, judgeEval, runEvalCase } from './eval-cases';
import { createMockAIProvider } from './mock';

// mock AI 必须通过评测集中所有标记为 mock 的用例；改写用例（P*）留给真实模型。
describe('eval cases on the mock AI', () => {
  const ai = createMockAIProvider();
  const now = new Date(2026, 9, 22, 9, 0);

  it.each(EVAL_CASES.filter((c) => c.mock).map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    expect((await runEvalCase(c, ai, registry, now)).outcome).toEqual({ pass: true });
  });

  it('the mock does not pretend to understand paraphrases', async () => {
    for (const c of EVAL_CASES.filter((x) => !x.mock)) {
      const config = buildSetup(c.setup, c.locale, registry);
      const plan = await ai.plan(c.input, {
        config,
        registry,
        locale: c.locale,
        ...(c.about ? { about: c.about } : {}),
      });
      // 不要求通过，但不能产出不合法的修改。
      if (plan.kind === 'ops') {
        expect(prepareOps(config, plan.ops, { registry, locale: c.locale, now }).ok).toBe(true);
      }
    }
  });
});

describe('asking first (D-256)', () => {
  const cl = (id: string) => EVAL_CASES.find((c) => c.id === id)!;
  const reply = (examples: string[]) =>
    ({ kind: 'reject', reason: 'unclear', message: '?', examples }) as const;

  it('covers vague and contradictory requests in three languages', () => {
    expect(['CL1', 'CL2', 'CL3', 'CL4'].map((id) => cl(id).locale)).toEqual([
      'zh',
      'en',
      'zh',
      'fr',
    ]);
  });

  it('passes only with 2-3 different options and no change', () => {
    expect(judgeEval(cl('CL1'), reply(['更大的字', '深色主题']), null)).toEqual({ pass: true });
    expect(judgeEval(cl('CL1'), reply([]), null).pass).toBe(false);
    expect(judgeEval(cl('CL1'), reply(['a', 'a']), null).pass).toBe(false);
    expect(judgeEval(cl('CL1'), reply(['a', 'b', 'c', 'd']), null).pass).toBe(false);
    expect(judgeEval(cl('CL3'), { ...reply(['a', 'b']), reason: 'unknown' }, null).pass).toBe(
      false,
    );
    expect(
      judgeEval(
        cl('CL3'),
        { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#E03131' }] },
        null,
      ).pass,
    ).toBe(false);
  });
});
