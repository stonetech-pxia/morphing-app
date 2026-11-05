import {
  BUILTIN_TOOLS,
  ComponentSchema,
  FieldSchema,
  ICON_NAMES,
  OpSchema,
  PlanAboutSchema,
  PlanSchema,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  presetById,
  presetWorkflow,
  templateOps,
  type PlanAbout,
  type PlanContext,
} from '@morph/core';
import { describe, expect, it, vi } from 'vitest';

import { AIHttpError, checkModelAccess, createHttpCompleter } from './http';
import { createClaudePlanner, type Complete, type Completion } from './planner';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { routeRequest } from './route';

const registry = createRegistry(BUILTIN_TOOLS);
const config = createDefaultWorkspace('zh');
const ctx = { config, registry, locale: 'zh' as const };
const now = () => new Date(2026, 9, 22);

const reply = (text: string, stopReason = 'end_turn'): Completion => ({
  text,
  stopReason,
  content: [{ type: 'text', text }],
  model: 'claude-test',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
const json = (value: unknown) => reply(JSON.stringify(value));
const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

describe('system prompt', () => {
  it('describes the output format, the protected rule and every registered action', () => {
    const prompt = buildSystemPrompt(registry);
    for (const word of [
      'updateContainer',
      'removeTool',
      'restorePrevious',
      'protected',
      'pdf.merge',
      'file.save',
      'file.rename',
      'in.photos',
      '(pdf → pdf)',
      '`page:${string}`',
    ]) {
      expect(prompt).toContain(word);
    }
  });

  it('lists every op, component type and icon the validator accepts', () => {
    const prompt = buildSystemPrompt(registry);
    for (const option of OpSchema.options) expect(prompt).toContain(`"${option.shape.op.value}"`);
    for (const option of ComponentSchema.options) {
      expect(prompt).toContain(`- ${option.shape.look.value} `);
    }
    for (const icon of ICON_NAMES) expect(prompt).toContain(icon);
    for (const type of FieldSchema.options) expect(prompt).toContain(type.shape.type.value);
    expect(prompt).toContain('"userData"');
    expect(prompt).toContain('"errand"');
    // 翻译文件做成快捷操作，翻译一句话仍是办事（D-171）。
    expect(prompt).toContain('translate.text');
    expect(prompt).toContain('Translating files is a job on files');
    expect(prompt).toContain('mailto');
  });
});

describe('user message context (D-124)', () => {
  it('accepts only workflow IDs in chain context, rejecting file data', () => {
    expect(PlanAboutSchema.safeParse({ kind: 'chain', first: 'a', second: 'b' }).success).toBe(
      true,
    );
    expect(
      PlanAboutSchema.safeParse({ kind: 'chain', first: 'a', second: 'b', files: ['private.jpg'] })
        .success,
    ).toBe(false);
  });

  it('carries both ordered workflow definitions for composition without file context', () => {
    const workspace = {
      ...config,
      tools: [
        {
          id: 'first',
          kind: 'quickAction',
          name: 'First',
          steps: [{ id: 'pick', action: 'in.photos', params: {} }],
        },
        {
          id: 'second',
          kind: 'quickAction',
          name: 'Second',
          steps: [{ id: 'pick', action: 'in.photos', params: {} }],
        },
      ],
    } as typeof config;
    const message = buildUserMessage(workspace, 'combine', 'en', {
      kind: 'chain',
      first: 'first',
      second: 'second',
    });
    expect(message).toContain('first "first", then "second"');
    expect(message).toContain('keeping the originals');
    expect(message).toContain('never pick files again');
    expect(
      buildUserMessage(config, 'combine', 'en', { kind: 'chain', first: 'gone', second: 'second' }),
    ).not.toContain('<context>');
  });

  it('names the quick action the user opened AI from', () => {
    const withWf = {
      ...config,
      tools: [{ id: 'visa', kind: 'quickAction', name: '签证照片', steps: [] }],
    } as unknown as typeof config;
    const message = buildUserMessage(withWf, '再小一点', 'zh', {
      kind: 'workflow',
      workflowId: 'visa',
    });
    expect(message).toContain('<context>quick action "visa" (“签证照片”)</context>');
    expect(buildUserMessage(config, 'hi', 'zh')).not.toContain('<context>');
  });

  it('gives only the kinds and count of shared files', () => {
    const message = buildUserMessage(config, '做成一个 PDF', 'zh', {
      kind: 'shared',
      images: 2,
      pdfs: 1,
      others: 0,
    });
    expect(message).toContain('<context>shared files: 2 photos, 1 PDF</context>');
  });

  it('lists what was said earlier in the draft, before the new request (D-207)', () => {
    const message = buildUserMessage(config, '再深一点', 'zh', undefined, [
      { input: '主题色换成蓝色', done: true, reply: '主题色改为 #1C7ED6' },
      { input: '背景用我的照片', done: false, reply: '背景不能用照片。' },
    ]);
    expect(message).toContain(
      '<earlier_requests>\n1. "主题色换成蓝色" — done: 主题色改为 #1C7ED6\n2. "背景用我的照片" — not done: 背景不能用照片。\n</earlier_requests>',
    );
    expect(message.indexOf('<earlier_requests>')).toBeLessThan(message.indexOf('<user_request>'));
    expect(buildUserMessage(config, 'hi', 'zh', undefined, [])).not.toContain('<earlier_requests>');
  });
});

describe('Claude planner', () => {
  it('returns a valid plan from the first reply', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(json(green));
    expect(
      await createClaudePlanner({ complete, registry, now }).plan('主题换成绿色', ctx),
    ).toEqual(green);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('tolerates a code fence around the JSON', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValue(reply('```json\n' + JSON.stringify(green) + '\n```'));
    expect(
      await createClaudePlanner({ complete, registry, now }).plan('主题换成绿色', ctx),
    ).toEqual(green);
  });

  it('asks once more with the validator issues when the plan is invalid', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(
        json({ kind: 'ops', ops: [{ op: 'updateContainer', nav: { bar: ['page:missing'] } }] }),
      )
      .mockResolvedValueOnce(
        json({
          kind: 'ops',
          ops: [{ op: 'updateContainer', nav: { bar: ['page:home', 'tools', 'settings'] } }],
        }),
      );
    const result = await createClaudePlanner({ complete, registry, now }).plan(
      '导航只要首页、工具、设置',
      ctx,
    );
    expect(result).toMatchObject({
      kind: 'ops',
      ops: [{ op: 'updateContainer', nav: { bar: ['page:home', 'tools', 'settings'] } }],
    });
    const secondCall = complete.mock.calls[1]![0];
    expect(secondCall.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(String(secondCall[2]!.content)).toContain('rejected by the app');
  });

  it('the repair message points inside a new page instead of saying Invalid input', async () => {
    const bad = {
      kind: 'ops',
      ops: [
        {
          op: 'addContainer',
          page: {
            id: 'p',
            title: 'P',
            blocks: [{ id: 'x', look: 'list', source: { table: 't' } }],
          },
        },
      ],
    };
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(json(bad))
      .mockResolvedValue(json(green));
    const planner = createClaudePlanner({ complete, registry, now });
    await planner.plan('加一页', ctx);
    const repair = String(complete.mock.calls[1]![0]![2]!.content);
    expect(repair).toContain('ops.0.page.blocks.0.show');
    expect(repair).not.toContain('ops.0.page: Invalid input');
  });

  it('repairs a reply that is not JSON or not a plan', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(reply('Sure! I will make it green.'))
      .mockResolvedValueOnce(json(green));
    expect(
      await createClaudePlanner({ complete, registry, now }).plan('主题换成绿色', ctx),
    ).toEqual(green);

    const notAPlan = vi
      .fn<Complete>()
      .mockResolvedValueOnce(json({ kind: 'ops', ops: [{ op: 'runScript' }] }))
      .mockResolvedValueOnce(json(green));
    expect(
      await createClaudePlanner({ complete: notAPlan, registry, now }).plan('主题换成绿色', ctx),
    ).toEqual(green);
  });

  it('after one repair, returns an invalid-but-well-formed plan for the app to reject', async () => {
    const bad = json({
      kind: 'ops',
      ops: [{ op: 'removeContainer', page: 'home', block: 'nope' }],
    });
    const complete = vi.fn<Complete>().mockResolvedValue(bad);
    expect(
      await createClaudePlanner({ complete, registry, now }).plan('删掉不存在的东西', ctx),
    ).toMatchObject({
      kind: 'ops',
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('fails loudly when the reply never becomes a plan', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(reply('no idea'));
    await expect(
      createClaudePlanner({ complete, registry, now }).plan('主题换成绿色', ctx),
    ).rejects.toThrow('unusable');
  });

  it('expands addTool {tool: {preset, params}} into the preset the user would get (D-259)', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(
      json({
        kind: 'ops',
        ops: [{ op: 'addTool', tool: { preset: 'visa-photo', params: { photo: { maxKB: 100 } } } }],
      }),
    );
    const result = await createClaudePlanner({ complete, registry, now }).plan('加一个签证照', ctx);
    const preset = presetWorkflow(presetById('visa-photo')!, 'zh', 'visa-photo');
    expect(result).toEqual({
      kind: 'ops',
      ops: [
        {
          op: 'addTool',
          tool: {
            ...preset,
            steps: preset.steps.map((s) =>
              s.id === 'photo' ? { ...s, params: { ...s.params, maxKB: 100 } } : s,
            ),
          },
        },
      ],
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('sends a wrong preset id back to the model', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(
        json({ kind: 'ops', ops: [{ op: 'addTool', tool: { preset: 'visa' } }] }),
      )
      .mockResolvedValueOnce(
        json({ kind: 'ops', ops: [{ op: 'addTool', tool: { preset: 'visa-photo' } }] }),
      );
    const result = await createClaudePlanner({ complete, registry, now }).plan('加一个签证照', ctx);
    expect(result).toMatchObject({ kind: 'ops', ops: [{ tool: { preset: 'visa-photo' } }] });
    expect(String(complete.mock.calls[1]![0][2]!.content)).toContain('unknown preset "visa"');
  });

  it('accepts the phone home screen after adding the preset in the same plan (D-271)', async () => {
    const plan = {
      kind: 'ops',
      ops: [
        { op: 'addTool', tool: { preset: 'visa-photo' } },
        { op: 'updateContainer', nav: { phoneHomeScreen: ['visa-photo'] } },
      ],
    };
    const complete = vi.fn<Complete>().mockResolvedValue(json(plan));
    const result = await createClaudePlanner({ complete, registry, now }).plan(
      '把签证照片放到桌面',
      ctx,
    );
    expect(result).toMatchObject({
      kind: 'ops',
      ops: [
        { op: 'addTool', tool: { id: 'visa-photo' } },
        { op: 'updateContainer', nav: { phoneHomeScreen: ['visa-photo'] } },
      ],
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('sends a home screen mark on a missing quick action or inside addTool back to the model', async () => {
    const fixed = {
      kind: 'ops',
      ops: [
        { op: 'addTool', tool: { preset: 'visa-photo' } },
        { op: 'updateContainer', nav: { phoneHomeScreen: ['visa-photo'] } },
      ],
    };
    const missing = vi
      .fn<Complete>()
      .mockResolvedValueOnce(
        json({
          kind: 'ops',
          ops: [{ op: 'updateContainer', nav: { phoneHomeScreen: ['visa-photo'] } }],
        }),
      )
      .mockResolvedValueOnce(json(fixed));
    await createClaudePlanner({ complete: missing, registry, now }).plan('把签证照片放到桌面', ctx);
    expect(String(missing.mock.calls[1]![0][2]!.content)).toContain('tool visa-photo not found');

    const inside = vi
      .fn<Complete>()
      .mockResolvedValueOnce(
        json({
          kind: 'ops',
          ops: [
            {
              op: 'addTool',
              tool: {
                ...presetWorkflow(presetById('visa-photo')!, 'zh', 'visa-photo'),
                homeScreen: true,
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(json(fixed));
    const result = await createClaudePlanner({ complete: inside, registry, now }).plan(
      '把签证照片放到桌面',
      ctx,
    );
    expect(inside).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      kind: 'ops',
      ops: [{}, { op: 'updateContainer', nav: { phoneHomeScreen: ['visa-photo'] } }],
    });
  });

  it('turns a safety refusal into a polite rejection', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(reply('', 'refusal'));
    expect(await createClaudePlanner({ complete, registry, now }).plan('……', ctx)).toMatchObject({
      kind: 'reject',
      reason: 'unknown',
    });
  });
});

describe('checks the tool and repairs once more (AGENT_PLAN §3.6)', () => {
  const scripted = (replies: Completion[]) => {
    const fn = vi.fn<Complete>();
    for (const r of replies) fn.mockResolvedValueOnce(r);
    return fn;
  };
  const plan = (complete: Complete, input: string, c: PlanContext = ctx) =>
    createClaudePlanner({ complete, registry, now }).plan(input, c);

  // 任务引用项目。prepareOps 会给有列表的表补添加按钮，但补不到只被引用的「项目」表，所以它记不进去：
  // 这次新增的 blocker（add-missing，S2-04 里真实发生过）。
  const projects = {
    op: 'addData',
    table: { id: 'projects', name: '项目', fields: [{ id: 'name', name: '名字', type: 'text' }] },
  };
  const tasks = {
    op: 'addData',
    table: {
      id: 'tasks',
      name: '任务',
      fields: [
        { id: 'title', name: '标题', type: 'text' },
        { id: 'project', name: '项目', type: 'link', table: 'projects' },
      ],
    },
  };
  const listBlock = {
    op: 'addContainer',
    page: 'home',
    block: { id: 'tasks-list', look: 'list', source: { table: 'tasks' }, show: { title: 'title' } },
  };
  const addProject = {
    op: 'addContainer',
    page: 'home',
    block: {
      id: 'project-add',
      look: 'button',
      show: { label: '新项目', variant: 'filled' },
      tools: [{ do: 'create', table: 'projects', ask: 'all' }],
    },
  };
  const noAdd = { kind: 'ops', ops: [projects, tasks, listBlock] };
  const usable = { kind: 'ops', ops: [projects, tasks, listBlock, addProject] };
  const compress = (maxMB: number) => ({
    op: 'addTool',
    tool: {
      kind: 'quickAction',
      id: 'small-pdf',
      name: '照片转 PDF',
      steps: [
        { id: 'in', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
        {
          id: 'pdf',
          action: 'pdf.fromImages',
          params: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB },
        },
      ],
    },
  });

  it('a new blocker sends the plan back once, with the problems and the same request', async () => {
    const complete = scripted([json(noAdd), json(usable)]);
    const result = await plan(complete, '我要一个书单');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ kind: 'ops', ops: usable.ops });
    expect((result as { notes?: string[] }).notes).toBeUndefined();
    const sent = complete.mock.calls[1]![0];
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual(complete.mock.calls[0]![0][0]);
    expect(sent[2]!.content).toContain('valid');
    expect(sent[2]!.content).toContain('nothing adds entries to projects');
    expect(sent[2]!.content).toContain('complete plan');
  });

  it('a blocker that was there before does not trigger anything', async () => {
    const broken = applyOps(config, noAdd.ops as never, { registry, locale: 'zh' });
    if (!broken.ok) throw new Error('setup');
    const complete = scripted([json(green)]);
    const result = await plan(complete, '主题换成绿色', { ...ctx, config: broken.config });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toEqual(green);
  });

  it('a size the user said that is not in the params triggers a repair', async () => {
    const complete = scripted([
      json({ kind: 'ops', ops: [compress(5)] }),
      json({ kind: 'ops', ops: [compress(2)] }),
    ]);
    const result = await plan(complete, '做一个把 PDF 压到 2MB 的快捷操作');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0][2]!.content).toContain('2 MB');
    expect(result).toMatchObject({ kind: 'ops', ops: [compress(2)] });
  });

  it('with next set, a table without its page yet is expected', async () => {
    const complete = scripted([json({ ...noAdd, next: '增加书单页面' })]);
    const result = await plan(complete, '我要一个书单');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ next: '增加书单页面' });
    expect((result as { notes?: string[] }).notes).toBeUndefined();
  });

  it('with next set, an existing table losing its way in still counts', async () => {
    const hasTable = applyOps(config, usable.ops as never, { registry, locale: 'zh' });
    if (!hasTable.ok) throw new Error('setup');
    const noButton = { op: 'removeContainer', page: 'home', block: 'project-add' };
    const complete = scripted([
      json({ kind: 'ops', ops: [noButton], next: '主题换成蓝色' }),
      json(green),
    ]);
    await plan(complete, '去掉添加按钮，主题换蓝色', { ...ctx, config: hasTable.config });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('with next set, other problems of the plan still count', async () => {
    const complete = scripted([
      json({ kind: 'ops', ops: [compress(5)], next: '主题换成蓝色' }),
      json({ kind: 'ops', ops: [compress(2)], next: '主题换成蓝色' }),
    ]);
    await plan(complete, '做一个把 PDF 压到 2MB 的快捷操作');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('a repaired plan that is not valid falls back to the last valid one', async () => {
    for (const bad of [
      reply('not json'),
      json({ kind: 'ops', ops: [{ op: 'removeData', table: 'missing' }] }),
      json({ kind: 'reject', reason: 'unknown', message: 'no', examples: [] }),
      reply('', 'refusal'),
    ]) {
      const first = noAdd;
      const complete = scripted([json(first), bad]);
      const result = await plan(complete, '我要一个书单');
      expect(complete).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject(first);
      expect((result as { notes: string[] }).notes).toEqual([expect.stringContaining('用不了')]);
    }
  });

  it('a failed repair call does not lose the plan', async () => {
    const complete = vi.fn<Complete>();
    complete.mockResolvedValueOnce(json(noAdd));
    complete.mockRejectedValueOnce(new Error('rate limited'));
    expect(await plan(complete, '我要一个书单')).toMatchObject({ kind: 'ops', ops: noAdd.ops });
  });

  it('still broken after the repair: returned as it is, the user is told in their language', async () => {
    const same = { kind: 'ops', ops: [compress(5)], notes: ['a', 'b', 'c', 'd'] };
    const zh = scripted([json(same), json(same)]);
    const result = (await plan(zh, '做一个把 PDF 压到 2MB 的快捷操作')) as { notes: string[] };
    expect(zh).toHaveBeenCalledTimes(2);
    // notes 最多 4 条，App 的 PlanSchema 不能因此拒绝。
    expect(PlanSchema.safeParse(result).success).toBe(true);
    expect(result.notes).toEqual(['a', 'b', 'c', expect.stringContaining('快捷操作')]);
    const fr = scripted([json(same), json(same)]);
    const french = (await plan(fr, 'une action rapide pour compresser un PDF sous 2 Mo', {
      ...ctx,
      locale: 'fr',
    })) as { notes: string[] };
    expect(french.notes.at(-1)).toContain('action rapide');
  });

  it('a repair that makes it worse keeps the better plan', async () => {
    const better = { kind: 'ops', ops: [...noAdd.ops, compress(2)] };
    const worse = { kind: 'ops', ops: [...noAdd.ops, compress(5)] };
    const complete = scripted([json(better), json(worse)]);
    const result = await plan(complete, '我要任务和项目，再加一个转 PDF 压到 2MB 的快捷操作');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ops: better.ops });
  });

  it('at most 3 model calls: first, format repair, tool repair', async () => {
    const complete = vi.fn<Complete>(async () => json(noAdd));
    complete.mockResolvedValueOnce(reply('not json'));
    await plan(complete, '我要一个书单');
    expect(complete).toHaveBeenCalledTimes(3);
    const always = vi.fn<Complete>(async () => json(noAdd));
    await plan(always, '我要一个书单');
    expect(always).toHaveBeenCalledTimes(2);
  });

  it('every request has 1 or 3 messages, and the replayed reply has text blocks only', async () => {
    const withThinking = (r: Completion): Completion => ({
      ...r,
      content: [
        { type: 'thinking', thinking: 'hm', signature: 'sig' },
        { type: 'redacted_thinking', data: 'xx' },
        ...r.content,
      ],
    });
    const complete = scripted([
      withThinking(reply('not json')),
      withThinking(json(noAdd)),
      withThinking(json(usable)),
    ]);
    await plan(complete, '我要一个书单');
    expect(complete).toHaveBeenCalledTimes(3);
    const calls = complete.mock.calls.map((c) => c[0]);
    expect(calls.map((m) => m.length)).toEqual([1, 3, 3]);
    expect(calls[1]![1]!.content).toEqual([{ type: 'text', text: 'not json' }]);
    expect(calls[2]![1]!.content).toEqual([{ type: 'text', text: JSON.stringify(noAdd) }]);
    // 第 3 次是最新的回复和最新的修正，第一条还是原来的用户消息。
    expect(calls[2]![0]).toEqual(calls[0]![0]);
    expect(calls[2]![2]!.content).not.toEqual(calls[1]![2]!.content);
  });

  it('a reply with thinking only still replays something the server accepts', async () => {
    const complete = scripted([
      { ...reply(''), content: [{ type: 'thinking', thinking: 'hm', signature: 'sig' }] },
      json(green),
    ]);
    await plan(complete, '主题换成绿色');
    const replayed = complete.mock.calls[1]![0][1]!.content as { type: string; text: string }[];
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/./) });
  });
});

describe('HTTP transport', () => {
  const ok = (body: unknown) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
  const fail = (status: number, error: unknown) =>
    vi.fn(async () => new Response(JSON.stringify({ type: 'error', error }), { status }));
  const message = {
    content: [{ type: 'text', text: JSON.stringify(green) }],
    stop_reason: 'end_turn',
    model: 'claude-opus-5-5',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 0,
    },
  };

  it('sends the documented request shape with the key only in the header', async () => {
    const fetchImpl = ok(message);
    const complete = createHttpCompleter({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      registry,
      fetchImpl,
    });
    const result = await complete([{ role: 'user', content: 'hi' }]);
    expect(result).toMatchObject({
      text: JSON.stringify(green),
      stopReason: 'end_turn',
      usage: { cacheReadTokens: 100 },
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(String(init.body)).not.toContain('sk-ant-test');
  });

  it('a repair over HTTP resends the reply without its thinking blocks', async () => {
    const thinkingThenText = (text: string) => ({
      ...message,
      content: [
        { type: 'thinking', thinking: 'hm', signature: 'sig' },
        { type: 'redacted_thinking', data: 'xx' },
        { type: 'text', text },
      ],
    });
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => {
      const text = fetchImpl.mock.calls.length === 1 ? 'not json' : JSON.stringify(green);
      return new Response(JSON.stringify(thinkingThenText(text)), { status: 200 });
    });
    const complete = createHttpCompleter({
      apiKey: 'sk-test',
      model: 'claude-opus-5-5',
      registry,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await createClaudePlanner({ complete, registry, now }).plan('绿色', ctx)).toEqual(green);
    const body = JSON.parse(String(fetchImpl.mock.calls[1]![1].body)) as {
      messages: { role: string; content: unknown }[];
    };
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'not json' }],
    });
  });

  it('does not request a server-side fallback for Haiku', async () => {
    const fetchImpl = ok(message);
    await createHttpCompleter({ apiKey: 'k', model: 'claude-haiku-5-5', registry, fetchImpl })([
      { role: 'user', content: 'hi' },
    ]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('anthropic-beta');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('fallbacks');
  });

  it.each([
    [401, { type: 'authentication_error', message: 'invalid x-api-key' }, 'invalid_key'],
    [403, { type: 'permission_error', message: 'no access' }, 'permission'],
    [
      400,
      {
        type: 'invalid_request_error',
        message: 'You have reached your specified API usage limits.',
      },
      'spend_limit',
    ],
    [
      429,
      {
        type: 'rate_limit_error',
        message: 'x',
        details: { error_code: 'enforced_spend_limit_reached' },
      },
      'spend_limit',
    ],
    [429, { type: 'rate_limit_error', message: 'slow down' }, 'rate_limit'],
    [529, { type: 'overloaded_error', message: 'busy' }, 'overloaded'],
    [404, { type: 'not_found_error', message: 'model' }, 'not_found'],
    [500, { type: 'api_error', message: 'oops' }, 'server'],
  ])('maps HTTP %i to %s without leaking the key', async (status, error, kind) => {
    const promise = createHttpCompleter({
      apiKey: 'sk-ant-secret',
      model: 'claude-opus-5-5',
      registry,
      fetchImpl: fail(status, error),
    })([{ role: 'user', content: 'hi' }]);
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIHttpError);
    expect(err).toMatchObject({ kind, status });
    expect(String((err as Error).message)).not.toContain('sk-ant-secret');
  });

  it('times out', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const err = await checkModelAccess('claude-opus-5-5', {
      apiKey: 'k',
      fetchImpl: hanging as unknown as typeof fetch,
      timeoutMs: 10,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout' });
  });

  it('checks model access with a GET to the Models API (no tokens spent)', async () => {
    const fetchImpl = ok({ id: 'claude-haiku-5-5' });
    await checkModelAccess('claude-haiku-5-5', { apiKey: 'k', fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models/claude-haiku-5-5');
    expect(init.method).toBe('GET');
  });
});

describe('opened from a page (D-406)', () => {
  const config = applyOps(
    createDefaultWorkspace('zh'),
    templateOps('budget', createDefaultWorkspace('zh'), 'zh'),
    { registry, locale: 'zh' },
  );
  if (!config.ok) throw new Error(config.error);
  const message = (about: PlanAbout) =>
    buildUserMessage(config.config, '这里改一下', 'zh', about, [], registry);

  it('the page and the table are named by id and title', () => {
    expect(message({ kind: 'page', pageId: 'budget' })).toContain(
      '<context>page "budget" (“记账”)</context>',
    );
    expect(message({ kind: 'table', tableId: 'expenses' })).toContain(
      '<context>table "expenses" (“账目”)</context>',
    );
    expect(message({ kind: 'screen', screen: 'tools' })).toContain(
      '<context>built-in screen: tools</context>',
    );
  });

  it('a page that is gone adds no context', () => {
    expect(message({ kind: 'page', pageId: 'gone' })).not.toContain('<context>');
  });

  it('the file desk says the kind of file and its toolbar now, for that kind only', () => {
    const text = message({ kind: 'desk', fileKind: 'pdf' });
    expect(text).toContain('<context>file desk, showing: pdf.');
    expect(text).toContain('pdf.rotate');
    expect(text).not.toContain('image.compress"}');
  });

  it('the prompt routes follow where it was opened from', () => {
    const route = (about: PlanAbout) =>
      routeRequest({ input: '改一下', config: config.config, about });
    expect(route({ kind: 'page', pageId: 'budget' })).toBe('look');
    expect(route({ kind: 'desk', fileKind: 'pdf' })).toBe('look');
    expect(route({ kind: 'table', tableId: 'expenses' })).toBe('records');
    expect(route({ kind: 'screen', screen: 'quickActions' })).toBe('files');
    expect(route({ kind: 'screen', screen: 'tools' })).toBe('full');
    expect(route({ kind: 'workflow', workflowId: 'x' })).toBe('files');
  });
});

describe('工具清单和搭建计划（D-414、D-415）', () => {
  const plan2 = {
    kind: 'build',
    summary: '一个 App',
    steps: [
      { id: 'a', kind: 'record', title: '表', request: '建一张表' },
      { id: 'b', kind: 'look', title: '颜色', request: '换颜色' },
    ],
  };
  const stepCtx = {
    ...ctx,
    session: { open: [], recent: [], step: { index: 1, total: 2, remaining: 1 } },
  };

  it('每个请求都带 <session>：目标、没做完的项、最近的话；没有就不写', () => {
    const msg = buildUserMessage(config, '换颜色', 'zh', undefined, undefined, registry, {
      goal: '记账 App',
      open: [
        { kind: 'record', text: '建表', status: 'failed', reason: '「账」还没有地方能看到。' },
      ],
      recent: [{ input: '加分类', done: true, reply: '加了字段' }],
    });
    expect(msg).toContain('<session>');
    expect(msg).toContain('记账 App');
    expect(msg).toContain('failed: 「账」还没有地方能看到。');
    expect(msg).toContain('"加分类" — done: 加了字段');
    expect(buildUserMessage(config, '换颜色', 'zh')).not.toContain('<session>');
  });

  it('session 超长时丢最旧的，总长不超过上限', () => {
    const recent = Array.from({ length: 5 }, (_, i) => ({
      input: `旧句子${i}`,
      done: true,
      reply: '长'.repeat(500),
    }));
    const open = Array.from({ length: 12 }, (_, i) => ({
      kind: 'look' as const,
      text: `项${i}` + '字'.repeat(290),
      status: 'todo' as const,
    }));
    const msg = buildUserMessage(config, 'x', 'zh', undefined, undefined, registry, {
      goal: '目标',
      open,
      recent,
    });
    const block = msg.slice(msg.indexOf('<session>'), msg.indexOf('</session>'));
    expect(block.length).toBeLessThanOrEqual(1500 + '<session>\n'.length);
    expect(block).toContain('目标');
    expect(block).not.toContain('旧句子0');
    expect(block).toContain('项11');
    expect(block).not.toContain('项0字');
  });

  it('规则 53 在提示词末尾，Output 里有 build', () => {
    const prompt = buildSystemPrompt(registry);
    expect(prompt).toContain('53. Big jobs start with a plan');
    expect(prompt).toContain('{ kind: "build"; summary: string');
    expect(prompt.indexOf('52. The file desk')).toBeLessThan(prompt.indexOf('53. Big jobs'));
  });

  it('合法的计划直接返回，不跑校验和工具检查，一次调用', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(json(plan2));
    const planner = createClaudePlanner({ complete, registry, now });
    expect(await planner.plan('做一个 App', ctx)).toMatchObject({ kind: 'build' });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('步数不对、种类不对、request 是空的：走格式修复', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(json({ ...plan2, steps: plan2.steps.slice(0, 1) }))
      .mockResolvedValueOnce(json(plan2));
    const planner = createClaudePlanner({ complete, registry, now });
    expect(await planner.plan('做一个 App', ctx)).toMatchObject({ kind: 'build' });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0]).toHaveLength(3);
  });

  it('做计划的一步时又回计划：发回去要操作', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(json(plan2))
      .mockResolvedValueOnce(json(green));
    const planner = createClaudePlanner({ complete, registry, now });
    expect(await planner.plan('换颜色', stepCtx)).toMatchObject({ kind: 'ops' });
    expect(JSON.stringify(complete.mock.calls[1]![0][2])).toContain('not another build plan');
  });

  it('做计划的一步时只建了表和添加按钮（列表在后面的步骤）：不发回去补', async () => {
    const ops = {
      kind: 'ops',
      ops: [
        {
          op: 'addData',
          table: { id: 'books', name: '书单', fields: [{ id: 't', name: '书名', type: 'text' }] },
        },
        {
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'f',
            look: 'button',
            show: { label: '添加', variant: 'filled' },
            tools: [{ do: 'create', table: 'books', ask: 'all' }],
          },
        },
      ],
    };
    const complete = vi.fn<Complete>().mockResolvedValue(json(ops));
    const planner = createClaudePlanner({ complete, registry, now });
    await planner.plan('建表', stepCtx);
    expect(complete).toHaveBeenCalledTimes(1);
    // 最后一步还缺就要补一次。
    complete.mockClear();
    await planner.plan('建表', {
      ...ctx,
      session: { open: [], recent: [], step: { index: 2, total: 2, remaining: 0 } },
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

// D-448：AI 页发送后 Tink 旁边的短文字跟着规划走到哪一步；只报阶段，不带句子和配置内容。
describe('plan progress', () => {
  it('reports the prompt route, then checking', async () => {
    const steps: string[] = [];
    const complete = vi.fn(async () => json(green));
    const planner = createClaudePlanner({ complete, registry, now, route: true });
    await planner.plan('把主题换成绿色', { ...ctx, onProgress: (p) => steps.push(p) });
    expect(steps[0]).not.toBe('checking');
    expect(steps.at(-1)).toBe('checking');
    expect(steps.every((s) => typeof s === 'string' && s.length < 12)).toBe(true);
  });

  it('reports fixing when the first reply has to be repaired', async () => {
    const steps: string[] = [];
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(json(green));
    const planner = createClaudePlanner({ complete, registry, now });
    await planner.plan('换成绿色', { ...ctx, onProgress: (p) => steps.push(p) });
    expect(steps).toEqual(['full', 'checking', 'fixing', 'checking']);
  });
});
