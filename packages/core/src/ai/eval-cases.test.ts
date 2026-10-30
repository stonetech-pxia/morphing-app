import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import { registry } from '../test-helpers';
import { EVAL_CASES, buildSetup, runEvalCase } from './eval-cases';
import { createMockAIProvider } from './mock';

// v34 第一阶段（2026-10-30）：eval-cases.ts 的 setup 和 check 还是 v33 的写法（风险 M11），
// 第三阶段改写成 v34 后去掉这两处 skip（并跑一次全量 Haiku）。

// mock AI 必须通过评测集中所有标记为 mock 的用例；改写用例（P*）留给真实模型。
describe.skip('eval cases on the mock AI', () => {
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

// W10 的两种理解（D-083 补充，创始人 2026-10-27 本地会话确认）：压图片，或者拉正后做成 PDF。
describe.skip('W10 accepts both readings', () => {
  const w10 = EVAL_CASES.find((c) => c.id === 'W10')!;
  const check = (steps: [string, Record<string, unknown>][]) => {
    const config = buildSetup('default', 'zh', registry);
    const after = {
      ...config,
      tools: [
        ...config.tools,
        {
          id: 'scan-300',
          kind: 'quickAction' as const,
          name: 'Scan',
          steps: steps.map(([action, params], i) => ({ id: `s${i}`, action, params })),
        },
      ],
    };
    if (w10.expect.kind !== 'ops') throw new Error('W10 should expect ops');
    return w10.expect.check(after);
  };
  const scanner: [string, Record<string, unknown>] = ['in.photos', { source: 'scanner' }];

  it('compresses the scanned images to 300KB', () => {
    expect(check([scanner, ['image.compress', { maxKB: 300 }], ['file.save', {}]])).toBeNull();
  });

  it('straightens the pages and makes a PDF of at most 0.3 MB', () => {
    expect(
      check([
        scanner,
        ['scan.detect', {}],
        ['scan.enhance', {}],
        ['pdf.fromImages', { maxMB: 0.3 }],
        ['file.save', {}],
      ]),
    ).toBeNull();
    expect(
      check([scanner, ['scan.detect', {}], ['pdf.fromImages', { maxMB: 0.25 }], ['file.save', {}]]),
    ).toBeNull();
  });

  it('rejects a PDF that is too big, a missing save or a camera instead of the scanner', () => {
    expect(
      check([scanner, ['scan.detect', {}], ['pdf.fromImages', { maxMB: 0.5 }], ['file.save', {}]]),
    ).not.toBeNull();
    expect(
      check([scanner, ['scan.detect', {}], ['pdf.fromImages', {}], ['file.save', {}]]),
    ).not.toBeNull();
    expect(
      check([scanner, ['pdf.fromImages', { maxMB: 0.3 }], ['file.save', {}], ['out.share', {}]]),
    ).not.toBeNull();
    expect(
      check([
        ['in.photos', { source: 'camera' }],
        ['pdf.fromImages', { maxMB: 0.3 }],
        ['file.save', {}],
      ]),
    ).not.toBeNull();
  });
});
