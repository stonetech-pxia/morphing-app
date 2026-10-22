import {
  BUILTIN_TOOLS,
  ComponentSchema,
  ICON_NAMES,
  OpSchema,
  createDefaultWorkspace,
  createRegistry,
} from '@morph/core';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeHttpError, checkModelAccess, createHttpCompleter } from './http';
import { createClaudePlanner, type Complete, type Completion } from './planner';
import { buildSystemPrompt } from './prompt';

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
      'setNavItems',
      'removeWorkflowStep',
      'restorePrevious',
      'protected',
      'pdf.merge',
      'file.save',
      'ui.askFileName',
      '`page:${string}`',
    ]) {
      expect(prompt).toContain(word);
    }
  });

  it('lists every op, component type and icon the validator accepts', () => {
    const prompt = buildSystemPrompt(registry);
    for (const option of OpSchema.options) expect(prompt).toContain(`"${option.shape.op.value}"`);
    for (const option of ComponentSchema.options) {
      expect(prompt).toContain(`- ${option.shape.type.value} `);
    }
    for (const icon of ICON_NAMES) expect(prompt).toContain(icon);
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
        json({ kind: 'ops', ops: [{ op: 'setNavItems', items: ['page:missing'] }] }),
      )
      .mockResolvedValueOnce(
        json({
          kind: 'ops',
          ops: [{ op: 'setNavItems', items: ['page:home', 'tools', 'settings'] }],
        }),
      );
    const result = await createClaudePlanner({ complete, registry, now }).plan(
      '导航只要首页、工具、设置',
      ctx,
    );
    expect(result).toMatchObject({
      kind: 'ops',
      ops: [{ op: 'setNavItems', items: ['page:home', 'tools', 'settings'] }],
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
      ops: [{ op: 'removeComponent', pageId: 'home', componentId: 'nope' }],
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
    expect(err).toBeInstanceOf(ClaudeHttpError);
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
