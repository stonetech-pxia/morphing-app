import {
  BUILTIN_TOOLS,
  ComponentSchema,
  FieldSchema,
  ICON_NAMES,
  OpSchema,
  PlanAboutSchema,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  presetById,
  presetWorkflow,
  templateOps,
  type PlanAbout,
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
