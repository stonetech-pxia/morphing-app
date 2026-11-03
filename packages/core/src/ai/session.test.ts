import { describe, expect, it } from 'vitest';

import { BUILTIN_TOOLS } from '../tools';
import { createRegistry } from '../registry';
import { createDefaultWorkspace } from '../defaults';
import type { Op } from '../ops';
import { prepareOps } from '../change';
import { checkTools } from '../tool-check';
import {
  SESSION_MAX_ITEMS,
  SESSION_RECENT,
  commitDrafted,
  dropDrafted,
  emptySession,
  fixRequest,
  markSessionStart,
  markUndone,
  openItems,
  parseSession,
  planSession,
  recheckItems,
  recordTurn,
  sessionProblems,
  startBuildItems,
  toolVerdict,
  workKindOfOps,
} from './session';
import { createMockAIProvider } from './mock';

const registry = createRegistry(BUILTIN_TOOLS);
const config = createDefaultWorkspace('zh');
const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 10, 3) };

const tableOp: Op = {
  op: 'addData',
  table: { id: 'books', name: '书单', fields: [{ id: 'title', name: '书名', type: 'text' }] },
} as Op;
const pageOps: Op[] = [
  {
    op: 'addContainer',
    page: 'home',
    block: {
      id: 'books-list',
      look: 'list',
      source: { table: 'books', limit: 30 },
      show: { title: 'title' },
    },
  },
  {
    op: 'addContainer',
    page: 'home',
    block: {
      id: 'books-add',
      look: 'button',
      show: { label: '添加', variant: 'filled' },
      tools: [{ do: 'create', table: 'books', ask: 'all' }],
    },
  },
] as unknown as Op[];

function apply(ops: Op[], base = config) {
  const r = prepareOps(base, ops, ctx);
  if (!r.ok) throw new Error(r.issues.join('; '));
  return r.after;
}

describe('工具清单：存和读', () => {
  it('旧版 App 没有、存坏了都是空的（底线 12）', () => {
    expect(parseSession(null)).toEqual(emptySession());
    expect(parseSession('')).toEqual(emptySession());
    expect(parseSession('{oops')).toEqual(emptySession());
    expect(parseSession('{"items":"x"}')).toEqual(emptySession());
  });

  it('存了再读一样', () => {
    const s = recordTurn(emptySession(), {
      input: '建表',
      reply: '好',
      done: true,
      kind: 'record',
    });
    expect(parseSession(JSON.stringify(s))).toEqual(s);
  });
});

describe('工具清单：谁说了算', () => {
  it('没有相关 blocker 才算做好', () => {
    const before = config;
    const after = apply([tableOp, pageOps[1]!]);
    const bad = toolVerdict(before, after, registry);
    expect(bad.targets).toContain('table:books');
    expect(bad.blockers.length).toBeGreaterThan(0);
    const failed = recordTurn(emptySession(), {
      input: '建书单',
      reply: '',
      done: true,
      kind: 'record',
      verdict: bad,
      reason: '还没有地方能看到',
    });
    expect(failed.items[0]).toMatchObject({ status: 'failed', reason: '还没有地方能看到' });

    const good = apply([tableOp, ...pageOps]);
    const ok = toolVerdict(before, good, registry);
    expect(ok.blockers).toEqual([]);
    expect(
      recordTurn(emptySession(), { input: 'x', reply: '', done: true, kind: 'record', verdict: ok })
        .items[0],
    ).toMatchObject({ status: 'done' });
  });

  it('后面还有一步要做页面时不算 blocker；做完整体检查时要算', () => {
    const after = apply([tableOp, pageOps[1]!]);
    const later = toolVerdict(config, after, registry, { later: true });
    expect(later.blockers).toEqual([]);
    const s = recordTurn(emptySession(), {
      input: '建书单',
      reply: '',
      done: true,
      kind: 'record',
      verdict: later,
    });
    expect(s.items[0]!.status).toBe('done');
    const checked = recheckItems(s, after, registry, 'zh', { all: true });
    expect(checked.items[0]!.status).toBe('failed');
    expect(checked.items[0]!.reason).toContain('书单');
  });

  it('没做好的后来补上了就算做好，模型不用说', () => {
    const after = apply([tableOp, pageOps[1]!]);
    const s = recordTurn(emptySession(), {
      input: '建书单',
      reply: '',
      done: true,
      kind: 'record',
      verdict: toolVerdict(config, after, registry),
      reason: 'x',
    });
    expect(openItems(s)).toHaveLength(1);
    const fixed = apply([pageOps[0]!], after);
    expect(checkTools(fixed, registry).issues.filter((i) => i.severity === 'blocker')).toEqual([]);
    const again = recheckItems(s, fixed, registry, 'zh');
    expect(again.items[0]).toMatchObject({ status: 'done' });
    expect(again.items[0]!.reason).toBeUndefined();
  });

  it('没做的话不进清单，但记得说过', () => {
    const s = recordTurn(emptySession(), { input: '写封信', reply: '不替你写', done: false });
    expect(s.items).toEqual([]);
    expect(s.said).toEqual([{ input: '写封信', done: false, reply: '不替你写' }]);
  });

  it('点了清单里的一项再说一次：还是那一项，不多一项', () => {
    let s = recordTurn(emptySession(), {
      input: '建表',
      reply: '',
      done: true,
      kind: 'record',
      next: '主题换成蓝色',
    });
    expect(openItems(s).map((i) => i.text)).toEqual(['主题换成蓝色']);
    s = recordTurn(s, { input: '主题换成蓝色', reply: '', done: true, kind: 'look' });
    expect(s.items).toHaveLength(2);
    expect(openItems(s)).toEqual([]);
  });
});

describe('工具清单：上限', () => {
  it('最多 12 项，先丢做完的；没做的留着', () => {
    let s = startBuildItems(
      emptySession(),
      '目标',
      Array.from({ length: 4 }, (_, i) => ({
        id: `s${i}`,
        kind: 'record' as const,
        request: `步骤${i}`,
      })),
    );
    for (let i = 0; i < 20; i++)
      s = recordTurn(s, { input: `句子${i}`, reply: '', done: true, kind: 'look' });
    expect(s.items).toHaveLength(SESSION_MAX_ITEMS);
    expect(openItems(s)).toHaveLength(4);
    expect(s.said).toHaveLength(SESSION_RECENT);
    expect(s.said.at(-1)!.input).toBe('句子19');
  });
});

describe('工具清单：撤销和草稿', () => {
  it('草稿退一步：那句话不算说过，那一项不再算做了', () => {
    let s = recordTurn(emptySession(), { input: 'a', reply: '', done: true, kind: 'look', cr: 7 });
    s = dropDrafted(s, [7]);
    expect(s.said).toEqual([]);
    expect(s.items[0]!.status).toBe('skipped');
  });

  it('草稿应用后再撤销：告诉模型这句撤销了', () => {
    let s = recordTurn(emptySession(), { input: 'a', reply: '', done: true, kind: 'look', cr: 7 });
    s = commitDrafted(s, [7], 40);
    expect(s.said[0]).toMatchObject({ rev: 40 });
    s = markUndone(s, (rev) => rev === 40);
    expect(s.said[0]).toMatchObject({ done: false, reply: 'undone by the user' });
    expect(s.items[0]!.status).toBe('skipped');
  });
});

describe('发给模型的样子', () => {
  it('空的不发', () => {
    expect(planSession(emptySession())).toBeUndefined();
  });

  it('只有没做完的项和最近的话；正在做的这一句不再列一遍', () => {
    let s = startBuildItems(emptySession(), '记账 App', [
      { id: 'a', kind: 'record', request: '建表' },
      { id: 'b', kind: 'look', request: '换颜色' },
    ]);
    s = recordTurn(s, { input: '建表', reply: '建好了', done: true, kind: 'record' });
    expect(
      planSession(s, { current: '换颜色', step: { index: 2, total: 2, remaining: 0 } }),
    ).toEqual({
      goal: '记账 App',
      open: [],
      recent: [{ input: '建表', done: true, reply: '建好了' }],
      step: { index: 2, total: 2, remaining: 0 },
    });
  });
});

describe('这一句是哪一种工具', () => {
  it('按操作判断', () => {
    expect(workKindOfOps([tableOp])).toBe('record');
    expect(workKindOfOps(pageOps)).toBe('look');
    expect(workKindOfOps([{ op: 'setPackage', package: 'image', do: 'add' } as Op])).toBe('file');
    expect(
      workKindOfOps([
        {
          op: 'addTool',
          tool: { kind: 'quickAction', id: 'a', name: 'a', steps: [] },
        } as unknown as Op,
      ]),
    ).toBe('file');
    expect(
      workKindOfOps([
        {
          op: 'addTool',
          tool: {
            kind: 'quickAction',
            id: 'a',
            name: 'a',
            steps: [{ id: 's', action: 'x', params: { out: { addRecord: {} } } }],
          },
        } as unknown as Op,
      ]),
    ).toBe('fileToRecord');
  });
});

describe('内置规则的大工程说法（模拟器才走得到）', () => {
  it('说大工程回计划，步骤都是内置规则做得到的话；小改不出计划', async () => {
    const mock = createMockAIProvider();
    const plan = await mock.plan('搭建一个记账 App', { config, registry, locale: 'zh' });
    expect(plan.kind).toBe('build');
    if (plan.kind !== 'build') return;
    for (const step of plan.steps) {
      const r = await mock.plan(step.request, { config, registry, locale: 'zh' });
      expect(r.kind).toBe('ops');
    }
    expect((await mock.plan('主题换成绿色', { config, registry, locale: 'zh' })).kind).toBe('ops');
  });

  it('英文和法语界面也走得到，法语界面的标题是法语', async () => {
    const mock = createMockAIProvider();
    const plan = await mock.plan('Build a budget app', { config, registry, locale: 'fr' });
    expect(plan).toMatchObject({ kind: 'build', summary: 'Une app de budget prête à servir' });
    if (plan.kind !== 'build') return;
    for (const step of plan.steps) {
      const r = await mock.plan(step.request, { config, registry, locale: 'fr' });
      expect(r.kind).toBe('ops');
    }
  });

  it('带失败记号的一步第一次抛错，重试就好', async () => {
    const mock = createMockAIProvider();
    const plan = await mock.plan('搭建一个记账 App，有一步会失败', {
      config,
      registry,
      locale: 'zh',
    });
    if (plan.kind !== 'build') throw new Error('not a plan');
    const failing = plan.steps.find((s) => s.request.includes('#fail-once'))!;
    await expect(mock.plan(failing.request, { config, registry, locale: 'zh' })).rejects.toThrow();
    expect((await mock.plan(failing.request, { config, registry, locale: 'zh' })).kind).toBe('ops');
  });
});

describe('这个会话新增的问题（把这些补上）', () => {
  const addButton = pageOps[1]!;
  const listBlock = pageOps[0]!;
  // 有添加按钮、没有地方看：books 用不了。
  const broken = apply([tableOp, addButton]);
  const fixed = apply([listBlock], broken);
  const worked = (s = markSessionStart(emptySession(), config, registry)) =>
    recordTurn(s, { input: '加书单', reply: '加了', done: true, kind: 'record' });

  it('前提：有问题的配置确实有 blocker，补好的没有', () => {
    expect(checkTools(broken, registry).issues.filter((i) => i.severity === 'blocker')).not.toEqual(
      [],
    );
    expect(checkTools(fixed, registry).issues.filter((i) => i.severity === 'blocker')).toEqual([]);
  });

  it('没有问题：什么都不算', () => {
    expect(sessionProblems(worked(), config, registry)).toEqual([]);
  });

  it('这个会话弄出来的问题要算，补完就没了', () => {
    const left = sessionProblems(worked(), broken, registry);
    expect(left.map((i) => `${i.code}|${i.target}`)).toEqual(['view-missing|table:books']);
    expect(sessionProblems(worked(), fixed, registry)).toEqual([]);
  });

  it('起点已有的问题不算，起点之后新多出来的才算', () => {
    const s = worked(markSessionStart(emptySession(), broken, registry));
    expect(sessionProblems(s, broken, registry)).toEqual([]);
    const more = apply(
      [
        {
          op: 'addData',
          table: { id: 'films', name: '片单', fields: [{ id: 'title', name: '名', type: 'text' }] },
        } as Op,
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'films-add',
            look: 'button',
            show: { label: '添加', variant: 'filled' },
            tools: [{ do: 'create', table: 'films', ask: 'all' }],
          },
        } as unknown as Op,
      ],
      broken,
    );
    expect(sessionProblems(s, more, registry).map((i) => i.target)).toEqual(['table:films']);
  });

  it('会话里没有条目，或者做过的都撤销了：不算', () => {
    const start = markSessionStart(emptySession(), config, registry);
    expect(sessionProblems(start, broken, registry)).toEqual([]);
    const undone = markUndone(
      { ...worked(), items: worked().items.map((i) => ({ ...i, rev: 5 })) },
      (rev) => rev === 5,
    );
    expect(sessionProblems(undone, broken, registry)).toEqual([]);
  });

  it('later：页面在下一句，新表暂时没有入口不算', () => {
    expect(sessionProblems(worked(), broken, registry, { later: true })).toEqual([]);
  });

  it('起点只在会话开始时记一次；清空之后重新记；旧版 App 存的会话没有起点也补上', () => {
    const s = worked(markSessionStart(emptySession(), config, registry));
    expect(markSessionStart(s, broken, registry)).toBe(s);
    expect(markSessionStart(emptySession(), broken, registry).startIssues).toEqual([
      'view-missing|table:books',
    ]);
    const old = recordTurn(emptySession(), { input: '旧', reply: '', done: true, kind: 'look' });
    expect(markSessionStart(old, broken, registry).startIssues).toEqual([
      'view-missing|table:books',
    ]);
  });

  it('起点随 App 重启保留，不发给模型', () => {
    const s = worked(markSessionStart(emptySession(), broken, registry));
    expect(parseSession(JSON.stringify(s)).startIssues).toEqual(['view-missing|table:books']);
    expect(JSON.stringify(planSession(s))).not.toContain('view-missing');
  });

  it('发给模型的是英文的问题清单，一次最多 10 条', () => {
    const issue = (n: number) => ({
      severity: 'blocker' as const,
      code: 'view-missing',
      target: `table:t${n}`,
      message: `problem ${n}`,
    });
    expect(fixRequest([issue(1), issue(2)])).toBe(
      'Fix these so the app can be used:\n- problem 1\n- problem 2',
    );
    const many = fixRequest(Array.from({ length: 15 }, (_, n) => issue(n)));
    expect(many.split('\n')).toHaveLength(11);
  });
});
