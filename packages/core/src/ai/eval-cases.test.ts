import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import type { Op } from '../ops';
import { fromV33, registry, v33Fixture, withScanKeep } from '../test-helpers';
import { EVAL_CASES, buildSetup, runEvalCase, type EvalSetup } from './eval-cases';
import { createMockAIProvider } from './mock';
import type { AIProvider, Plan, WorkKind } from './types';

// 评测的 setup 用 v34 的操作重写过（v34 第三阶段）：和 v33 代码存下来的配置迁移后一模一样。
describe('eval setups are the same as the v33 ones', () => {
  const setups: EvalSetup[] = [
    'default',
    'starter',
    'pdf',
    'pdfBelowFiles',
    'budget',
    'visa',
    'visaHomeScreen',
    'habits',
    'linked',
    'oneTap',
    'views',
    'boards',
    'scheduled',
    'envelopes',
    'todos',
  ];
  it.each(setups)('%s', (setup) => {
    const name = setup === 'default' || setup === 'starter' ? `${setup}-zh` : `setup-${setup}-zh`;
    expect(buildSetup(setup, 'zh', registry)).toStrictEqual(
      setup === 'starter' ? withScanKeep(fromV33(v33Fixture(name))) : fromV33(v33Fixture(name)),
    );
  });
});

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

// W10 的两种理解（D-083 补充，创始人 2026-10-27 本地会话确认）：压图片，或者拉正后做成 PDF。
describe('W10 accepts both readings', () => {
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

// 新流程（D-415、D-407）跟上评测：一句话多个工具回搭建计划也算对，点名的东西不存在就建。
describe('allowBuild', () => {
  const now = new Date(2026, 10, 3);
  const caseOf = (id: string) => EVAL_CASES.find((c) => c.id === id)!;
  const replies = (plan: Plan): AIProvider => ({ plan: async () => plan });
  const step = (id: string, kind: WorkKind) => ({ id, kind, title: id, request: `do ${id}` });
  const build = (steps: ReturnType<typeof step>[]): Plan => ({
    kind: 'build',
    summary: 'an app',
    steps,
  });
  const judge = async (id: string, plan: Plan) =>
    (await runEvalCase(caseOf(id), replies(plan), registry, now)).outcome;

  it.each(['TD17', 'TD17-en', 'FX6'])('%s：合法的搭建计划算通过', async (id) => {
    const plan = build([step('data', 'record'), step('look', 'look')]);
    expect(await judge(id, plan)).toEqual({ pass: true });
  });

  it('没标 allowBuild 的用例回 build 还是失败', async () => {
    const plan = build([step('data', 'record'), step('look', 'look')]);
    expect(await judge('RE1', plan)).toMatchObject({ pass: false });
  });

  it.each([
    ['步数不够', build([step('data', 'record')])],
    ['步骤 ID 重复', build([step('data', 'record'), step('data', 'look')])],
    ['request 是空的', build([{ ...step('data', 'record'), request: '  ' }, step('look', 'look')])],
    ['没有做数据的那一步', build([step('a', 'look'), step('b', 'look')])],
    ['外观排在数据前面', build([step('look', 'look'), step('data', 'record')])],
  ])('不合法的计划不算：%s', async (_why, plan) => {
    expect(await judge('TD17', plan)).toMatchObject({ pass: false });
  });

  it('allowBuild 的用例回 ops 时断言照旧', async () => {
    expect(await judge('FX6', { kind: 'ops', ops: [] })).toMatchObject({ pass: false });
  });

  it('拒绝还是失败', async () => {
    const plan: Plan = { kind: 'reject', reason: 'unknown', message: 'no', examples: [] };
    expect(await judge('FX6', plan)).toMatchObject({ pass: false });
  });
});

describe('RE3：拍照记到不存在的表（点名的东西不存在且用途清楚就建，D-407）', () => {
  const now = new Date(2026, 10, 3);
  const c = EVAL_CASES.find((x) => x.id === 'RE3')!;
  const judge = async (plan: Plan) =>
    (await runEvalCase(c, { plan: async () => plan }, registry, now)).outcome;
  const newTable: Op = {
    op: 'addData',
    table: {
      id: 'photos',
      name: '照片记录',
      fields: [
        { id: 'photo', name: '照片', type: 'file' },
        { id: 'note', name: '备注', type: 'text' },
      ],
    },
  } as Op;
  const quickAction = (table: string): Op =>
    ({
      op: 'addTool',
      tool: {
        kind: 'quickAction',
        id: 'snap',
        name: '拍照记录',
        icon: '📷',
        steps: [
          { id: 's1', action: 'in.photos', params: { source: 'camera', min: 1, max: 1 } },
          { id: 's2', action: 'out.addRecord', params: { collectionId: table } },
        ],
      },
    }) as Op;

  it('建了新表和记到它的快捷操作：通过', async () => {
    const outcome = await judge({ kind: 'ops', ops: [newTable, quickAction('photos')] });
    expect(outcome).toEqual({ pass: true });
  });

  it('拒绝不再算对', async () => {
    const plan: Plan = { kind: 'reject', reason: 'unknown', message: '没有', examples: [] };
    expect(await judge(plan)).toMatchObject({ pass: false });
  });

  it('只建表、没有快捷操作：不算', async () => {
    expect(await judge({ kind: 'ops', ops: [newTable] })).toMatchObject({ pass: false });
  });

  it('记到已有的账目：不算，用户说的是另一张表', async () => {
    const outcome = await judge({ kind: 'ops', ops: [newTable, quickAction('expenses')] });
    expect(outcome).toMatchObject({ pass: false });
  });

  it('内置规则不猜，照旧拒绝', async () => {
    const config = buildSetup(c.setup, c.locale, registry);
    const plan = await createMockAIProvider().plan(c.input, {
      config,
      registry,
      locale: c.locale,
    });
    expect(plan.kind).toBe('reject');
    expect(c.mock).toBe(false);
  });
});

describe('混合计划（D-419）：功能和外观都应用后再检查', () => {
  const now = new Date(2026, 10, 3);
  const c = EVAL_CASES.find((x) => x.id === 'FL1')!;
  const judge = async (plan: Plan) =>
    (await runEvalCase(c, { plan: async () => plan }, registry, now)).outcome;
  const visaAction: Op = {
    op: 'addTool',
    tool: {
      kind: 'quickAction',
      id: 'visa',
      name: '签证照片',
      steps: [
        { id: 'in', action: 'in.photos', params: { source: 'library', min: 1, max: 1 } },
        { id: 'photo', action: 'image.idPhoto', params: { spec: 'cn-visa', maxKB: 500 } },
      ],
    },
  };

  it('混合计划不算失败：两样都做对了就通过（要求 next 的用例也不用 next）', async () => {
    const green: Op = { op: 'setTheme', primaryColor: '#2F9E44' };
    expect(await judge({ kind: 'ops', ops: [visaAction, green] })).toEqual({ pass: true });
  });

  it('混合计划外观做错了还是失败', async () => {
    const red: Op = { op: 'setTheme', primaryColor: '#E03131' };
    expect(await judge({ kind: 'ops', ops: [visaAction, red] })).toMatchObject({ pass: false });
  });

  it('只有功能、没有 next：外观没做，还是失败', async () => {
    expect(await judge({ kind: 'ops', ops: [visaAction] })).toEqual({
      pass: false,
      reason: 'expected next with the look part',
    });
  });

  it('外观单独套不上：失败（用户实际得不到）', async () => {
    const clash: Op = {
      op: 'addContainer',
      page: 'nowhere',
      block: { id: 'x', look: 'header', show: { title: 'x' } },
    };
    expect(await judge({ kind: 'ops', ops: [visaAction, clash] })).toMatchObject({ pass: false });
  });
});
