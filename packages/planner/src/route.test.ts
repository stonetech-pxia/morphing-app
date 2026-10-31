import {
  BUILTIN_TOOLS,
  EVAL_CASES,
  buildSetup,
  createDefaultWorkspace,
  createRegistry,
} from '@morph/core';
import { describe, expect, it, vi } from 'vitest';

import evalTurns from './__fixtures__/eval-turns.json';

import { createClaudePlanner, type Complete, type Completion } from './planner';
import {
  PROMPT_ROUTES,
  ROUTE_PARTS,
  RULE_GROUPS,
  buildSystemPrompt,
  type PromptRoute,
} from './prompt';
import { routeCovers, routeRequest } from './route';

// 提示词按需加载：路由只在本机按字符串挑部分；拿不准就发完整的。

const registry = createRegistry(BUILTIN_TOOLS);
const full = buildSystemPrompt(registry, 'full');

describe('prompt routes', () => {
  it('the rule groups hold every numbered rule exactly once', () => {
    const section = full.split('## Rules\n')[1]!.split('\n\n')[0]!;
    const numbers = section.split('\n').map((line) => parseInt(line, 10));
    const grouped = Object.values(RULE_GROUPS)
      .flat()
      .sort((a, b) => a - b);
    expect(grouped).toEqual(numbers);
  });

  for (const route of PROMPT_ROUTES.filter((r) => r !== 'full')) {
    it(`${route} keeps the relation rules, the output types and the rules about errands, user data and turns`, () => {
      const prompt = buildSystemPrompt(registry, route);
      expect(prompt.length).toBeLessThan(full.length);
      for (let i = 1; i <= 14; i++) expect(prompt).toMatch(new RegExp(`\\nR${i}\\. `));
      expect(prompt).toContain('## Output\n');
      expect(prompt).toContain('## Tools\n');
      for (const n of RULE_GROUPS.core) expect(prompt).toMatch(new RegExp(`\\n${n}\\. `));
      // 办事拒绝（D-113）、看不到数据：原句都在。
      expect(prompt).toContain('You change the app; you never run the user');
      expect(prompt).toContain('reason "userData"');
      expect(prompt).toContain('You only see the structure, never the entries.');
      // 省掉的部分有目录，模型能要完整的。
      expect(prompt).toContain('{"kind": "needMore"}');
    });

    it(`${route} sends exactly its rule groups, and lists every other rule in the index`, () => {
      const prompt = buildSystemPrompt(registry, route);
      const kept = new Set<number>(ROUTE_PARTS[route].rules.flatMap((g) => RULE_GROUPS[g]));
      const index = prompt.split('\n- Rules ')[1]!.split('\n')[0]!;
      for (const n of Object.values(RULE_GROUPS).flat()) {
        if (kept.has(n)) {
          expect(prompt).toMatch(new RegExp(`\\n${n}\\. `));
        } else {
          expect(prompt).not.toMatch(new RegExp(`\\n${n}\\. `));
          expect(index).toMatch(new RegExp(`(^|, )${n} \\(`));
        }
      }
    });
  }

  it('full has no index', () => {
    expect(full).not.toContain('needMore');
  });
});

describe('routeRequest', () => {
  const config = createDefaultWorkspace('zh');
  const route = (input: string, extra: Partial<Parameters<typeof routeRequest>[0]> = {}) =>
    routeRequest({ input, config, ...extra });

  it('picks one kind of request from its words, in three languages', () => {
    expect(route('压缩照片到 500KB 然后分享')).toBe('files');
    expect(route('Make a quick action that turns my scans into one PDF')).toBe('files');
    expect(route('fusionner mes PDF')).toBe('files');
    expect(route('主题换成蓝色')).toBe('style');
    expect(route('make it dark mode')).toBe('style');
    expect(route('mets le thème en vert')).toBe('style');
    expect(route('给支出加一个分类字段')).toBe('records');
    expect(route('remind me every day at 9 to log expenses')).toBe('records');
    expect(route('首页加一个标题')).toBe('look');
  });

  it('sends everything when unsure or when files mix with the rest', () => {
    expect(route('撤销')).toBe('full');
    expect(route('hello')).toBe('full');
    expect(route('把扫描快捷操作放到首页')).toBe('full');
    expect(route('turn my expense records into a PDF report')).toBe('full');
  });

  it('a request from a quick action or shared files is about files', () => {
    expect(route('加一步', { about: { kind: 'shared', images: 2, pdfs: 0, others: 0 } })).toBe(
      'files',
    );
    expect(route('改成 200KB', { about: { kind: 'workflow', workflowId: 'x' } })).toBe('files');
    expect(route('首页换成蓝色', { about: { kind: 'workflow', workflowId: 'x' } })).toBe('full');
  });

  it('a follow-up keeps the first turn’s route, or sends everything', () => {
    const earlier = [{ input: '主题换成蓝色', done: true, reply: '' }];
    expect(route('再深一点', { earlier })).toBe('style');
    expect(route('换成绿色', { earlier })).toBe('style');
    expect(route('压缩照片', { earlier })).toBe('full');
    const page = [{ input: '首页加一个标题', done: true, reply: '' }];
    expect(route('换成绿色', { earlier: page })).toBe('look');
  });

  it('names in the config count: a quick action name is about files', () => {
    const withAction = {
      ...config,
      tools: [
        ...config.tools,
        { kind: 'quickAction' as const, id: 'lecture', name: 'Lecture notes', steps: [] },
      ],
    };
    expect(routeRequest({ input: 'make Lecture notes ask for the name', config: withAction })).toBe(
      'files',
    );
  });

  it('covers: look includes records and style; full includes everything', () => {
    expect(routeCovers('look', 'records')).toBe(true);
    expect(routeCovers('look', 'style')).toBe(true);
    expect(routeCovers('records', 'look')).toBe(false);
    for (const r of PROMPT_ROUTES) expect(routeCovers('full', r)).toBe(true);
  });

  it('runs without Intl (Hermes only has a few Intl parts; the router uses none)', () => {
    vi.stubGlobal('Intl', undefined);
    try {
      expect(route('fusionner mes PDF')).toBe('files');
      expect(route('主题换成蓝色')).toBe('style');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('planner with routes', () => {
  const ctx = { config: createDefaultWorkspace('en'), registry, locale: 'en' as const };
  const reply = (text: string): Completion => ({
    text,
    stopReason: 'end_turn',
    content: [{ type: 'text', text }],
    model: 'claude-test',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

  it('sends the routed prompt, and the full one after needMore', async () => {
    const systems: string[] = [];
    const answers = [{ kind: 'needMore' }, green];
    const complete: Complete = async (_messages, system) => {
      systems.push(system!);
      return reply(JSON.stringify(answers.shift()));
    };
    const routes: PromptRoute[] = [];
    const planner = createClaudePlanner({
      complete,
      registry,
      now: () => new Date(2026, 9, 22),
      route: true,
      onRoute: (r) => routes.push(r),
    });
    const plan = await planner.plan('make it green', ctx);
    expect(plan).toEqual(green);
    expect(routes).toEqual(['style', 'full']);
    expect(systems[0]).toBe(buildSystemPrompt(registry, 'style'));
    expect(systems[1]).toBe(full);
  });

  it('repairs with the full prompt', async () => {
    const systems: string[] = [];
    const answers = [{ kind: 'ops', ops: [{ op: 'nope' }] }, green];
    const complete: Complete = async (_messages, system) => {
      systems.push(system!);
      return reply(JSON.stringify(answers.shift()));
    };
    const planner = createClaudePlanner({
      complete,
      registry,
      now: () => new Date(2026, 9, 22),
      route: true,
    });
    expect(await planner.plan('make it green', ctx)).toEqual(green);
    expect(systems).toEqual([buildSystemPrompt(registry, 'style'), full]);
  });

  it('by default (route off, founder 2026-10-31) and with route: false the full prompt is sent', async () => {
    const systems: string[] = [];
    const complete: Complete = async (_messages, system) => {
      systems.push(system!);
      return reply(JSON.stringify(green));
    };
    const planner = createClaudePlanner({
      complete,
      registry,
      now: () => new Date(2026, 9, 22),
      route: false,
    });
    await planner.plan('make it green', ctx);
    const byDefault = createClaudePlanner({ complete, registry, now: () => new Date(2026, 9, 22) });
    await byDefault.plan('make it green', ctx);
    expect(systems).toEqual([full, full]);
  });
});

// 评测里每个通过的用例每一轮（scripts/eval-needs.ts 从 Haiku 的全量评测取出）：
// 路由给的部分必须包含这一轮的计划用到的部分，否则模型是在缺说明的情况下做对的。
type Part = 'data' | 'containers' | 'theme' | 'files' | 'records' | 'look' | 'style';
/** 一种路由给了哪些部分（从 ROUTE_PARTS 推出来）。 */
function routeHas(route: PromptRoute): Part[] {
  const { sections, rules } = ROUTE_PARTS[route];
  const parts: Part[] = rules.filter((g) => g !== 'core' && g !== 'files') as Part[];
  if (sections.includes('Data')) parts.push('data');
  if (sections.includes('Containers')) parts.push('containers');
  if (sections.includes('Theme')) parts.push('theme');
  if (sections.includes('Built-in tool catalog') && rules.includes('files')) parts.push('files');
  return parts;
}
const RECORD_LOOKS = [
  'list',
  'cards',
  'checklist',
  'tiles',
  'board',
  'calendar',
  'number',
  'chart',
  'form',
];

interface SlimOp {
  op: string;
  looks?: string[];
  tools?: boolean;
  nav?: string[];
  kind?: string;
  step?: boolean;
}

/** 一个操作要用到提示词的哪些部分。 */
function partsFor(op: SlimOp): Part[] {
  switch (op.op) {
    case 'setTheme':
      return ['theme', 'style'];
    case 'addData':
    case 'updateData':
    case 'removeData':
    case 'moveData':
      return ['data', 'records'];
    case 'addTool':
    case 'updateTool':
    case 'removeTool':
    case 'moveTool':
      if (op.kind === 'reminder') return ['data', 'records'];
      return op.op === 'removeTool' && !op.step ? [] : ['files'];
    case 'setPackage':
      return [];
    default: {
      if (op.nav) return op.nav.includes('phoneHomeScreen') ? ['files'] : ['containers', 'look'];
      const looks = op.looks ?? [];
      // 首页放一个快捷操作的 action 块：写法整个在规则 20 里（files）。
      if (looks.length > 0 && looks.every((l) => l === 'action')) return ['files'];
      const parts: Part[] = ['containers', 'look'];
      if (looks.some((l) => RECORD_LOOKS.includes(l)) || (op.tools && !looks.includes('action')))
        parts.push('data', 'records');
      if (looks.includes('action')) parts.push('files');
      return parts;
    }
  }
}

describe('routes over the eval cases', () => {
  const turns = evalTurns as { id: string; input: string; ops: SlimOp[] }[];
  const cases = new Map(EVAL_CASES.map((c) => [c.id, c]));

  it('has turns from the eval run', () => {
    expect(turns.length).toBeGreaterThan(300);
  });

  it('every turn gets the parts its plan uses (or the full prompt)', () => {
    const missing: string[] = [];
    for (const turn of turns) {
      const c = cases.get(turn.id);
      if (!c) continue;
      const route = routeRequest({
        input: turn.input,
        config: buildSetup(c.setup, c.locale, registry),
        about: c.about,
        earlier: (c.earlier ?? []).map((e) => ({ input: e.input, done: true, reply: '' })),
      });
      const need = new Set(turn.ops.flatMap(partsFor));
      const has = routeHas(route);
      const lacking = [...need].filter((p) => !has.includes(p));
      if (lacking.length) missing.push(`${turn.id} “${turn.input}” → ${route}, lacks ${lacking}`);
    }
    expect(missing).toEqual([]);
  });
});
