import { BUILTIN_TOOLS, createDefaultWorkspace, createRegistry } from '@morph/core';
import { describe, expect, it, vi } from 'vitest';

import { AIHttpError } from './http';
import {
  checkBaseUrl,
  checkOpenAICompatible,
  createOpenAICompleter,
  hostOf,
  OPENAI_COMPATIBLE_PRESETS,
} from './openai';
import { createClaudePlanner, parseJson } from './planner';
import { buildSystemPrompt } from './prompt';

// OpenAI 兼容接口（D-241）：请求形状、回复解析、错误分类、地址校验，以及和 Claude 共用的校验和修正。

const registry = createRegistry(BUILTIN_TOOLS);
const ctx = { config: createDefaultWorkspace('zh'), registry, locale: 'zh' as const };
const now = () => new Date(2026, 9, 22);
const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };
const BASE = 'https://api.example.com/v1';
const KEY = 'sk-other-secret-1234';

const chat = (content: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-1',
  model: 'some-model-2026',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content }, ...extra }],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 30,
    prompt_tokens_details: { cached_tokens: 100 },
  },
});
const ok = (...bodies: unknown[]) => {
  const fn = vi.fn();
  for (const body of bodies)
    fn.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status: 200 }));
  return fn;
};
const fail = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
const completer = (fetchImpl: unknown, apiKey: string | null = KEY) =>
  createOpenAICompleter({
    baseUrl: BASE,
    apiKey,
    model: 'some-model',
    registry,
    fetchImpl: fetchImpl as typeof fetch,
  });

describe('OpenAI-compatible transport', () => {
  it('sends the system prompt as a system message and the key only in the Authorization header', async () => {
    const fetchImpl = ok(chat(JSON.stringify(green)));
    const result = await completer(fetchImpl)([{ role: 'user', content: 'hi' }]);
    expect(result).toMatchObject({
      text: JSON.stringify(green),
      stopReason: 'stop',
      model: 'some-model-2026',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 0 },
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/chat/completions`);
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: 'some-model',
      messages: [
        { role: 'system', content: buildSystemPrompt(registry) },
        { role: 'user', content: 'hi' },
      ],
    });
    // Anthropic 专用的参数不发。
    expect(String(init.body)).not.toMatch(/cache_control|output_config|fallbacks|anthropic/);
    expect(String(init.body)).not.toContain(KEY);
  });

  it('sends no Authorization header when there is no key (local models)', async () => {
    const fetchImpl = ok(chat('{}'));
    await completer(fetchImpl, null)([{ role: 'user', content: 'hi' }]);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('drops <think> blocks and joins content parts', async () => {
    const thinking = await completer(
      ok(chat(`<think>先想想……{"a":1}</think>\n${JSON.stringify(green)}`)),
    )([{ role: 'user', content: 'hi' }]);
    expect(thinking.text).toBe(JSON.stringify(green));

    const parts = await completer(
      ok(
        chat([
          { type: 'text', text: '{"kind":' },
          { type: 'text', text: '"restorePrevious"}' },
        ]),
      ),
    )([{ role: 'user', content: 'hi' }]);
    expect(parts.text).toBe('{"kind":"restorePrevious"}');
  });

  it.each([
    ['content_filter finish', chat(null, { finish_reason: 'content_filter' })],
    [
      'a refusal field',
      {
        choices: [
          { finish_reason: 'stop', message: { content: null, refusal: 'I can’t help with that.' } },
        ],
      },
    ],
  ])('reports %s as a refusal', async (_name, body) => {
    const result = await completer(ok(body))([{ role: 'user', content: 'hi' }]);
    expect(result.stopReason).toBe('refusal');
  });

  it('treats a reply without a message as a bad request', async () => {
    const err = await completer(ok({ choices: [] }))([{ role: 'user', content: 'hi' }]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AIHttpError);
    expect(err).toMatchObject({ kind: 'bad_request' });
  });

  it.each([
    [
      401,
      { error: { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' } },
      'invalid_key',
    ],
    [402, { error: { message: 'Insufficient credits' } }, 'spend_limit'],
    [
      429,
      { error: { message: 'quota', type: 'insufficient_quota', code: 'insufficient_quota' } },
      'spend_limit',
    ],
    [429, { error: { message: 'slow down', type: 'rate_limit_exceeded' } }, 'rate_limit'],
    [403, { error: { message: 'no access' } }, 'permission'],
    [404, { error: { message: 'model not found', code: 'model_not_found' } }, 'not_found'],
    [400, { error: { message: 'model_not_found', code: 'model_not_found' } }, 'not_found'],
    [400, { error: 'unknown parameter' }, 'bad_request'],
    [503, { error: { message: 'overloaded' } }, 'overloaded'],
    [500, {}, 'server'],
  ])('maps HTTP %i to %s and never puts the key in the error', async (status, body, kind) => {
    const err = await completer(fail(status, body))([{ role: 'user', content: 'hi' }]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AIHttpError);
    expect(err).toMatchObject({ kind, status });
    // 有的 provider 会把 key 原样写进错误信息；我们的错误只有状态码和分类。
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });

  it('times out', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const err = await checkOpenAICompatible('m', {
      baseUrl: BASE,
      apiKey: KEY,
      fetchImpl: hanging as unknown as typeof fetch,
      timeoutMs: 10,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout' });
  });
});

describe('planner with an OpenAI-compatible model', () => {
  it('validates the reply and repairs once, sending the earlier reply back as plain text', async () => {
    const bad = JSON.stringify({ kind: 'ops', ops: [{ op: 'setTheme', primaryColor: 'green' }] });
    const fetchImpl = ok(chat(`Sure! Here is the plan:\n${bad}`), chat(JSON.stringify(green)));
    const plan = await createClaudePlanner({ complete: completer(fetchImpl), registry, now }).plan(
      '主题换成绿色',
      ctx,
    );
    expect(plan).toEqual(green);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body));
    expect(second.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    // 上一轮回复以字符串发回，不是 Anthropic 的内容块。
    expect(second.messages[2].content).toBe(`Sure! Here is the plan:\n${bad}`);
    expect(second.messages[3].content).toContain('rejected by the app');
  });

  it('turns a content filter into a polite rejection', async () => {
    const plan = await createClaudePlanner({
      complete: completer(ok(chat(null, { finish_reason: 'content_filter' }))),
      registry,
      now,
    }).plan('……', ctx);
    expect(plan).toMatchObject({ kind: 'reject', reason: 'unknown' });
  });
});

describe('JSON extraction', () => {
  it.each([
    ['plain', JSON.stringify(green)],
    ['code fence', '```json\n' + JSON.stringify(green) + '\n```'],
    ['prose around it', `Here you go:\n${JSON.stringify(green)}\nLet me know!`],
  ])('reads %s', (_name, text) => {
    expect(parseJson(text)).toEqual({ ok: true, value: green });
  });

  it('still fails on text without an object', () => {
    expect(parseJson('I cannot do that')).toMatchObject({ ok: false });
    expect(parseJson('{ broken')).toMatchObject({ ok: false });
  });
});

describe('base URL check', () => {
  it.each([
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['  https://OpenRouter.ai/api/v1/  ', 'https://openrouter.ai/api/v1'],
    ['https://my-proxy.example.com:8443', 'https://my-proxy.example.com:8443'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1'],
    ['http://[::1]:11434/v1', 'http://[::1]:11434/v1'],
  ])('accepts %s', (raw, url) => {
    expect(checkBaseUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ['http://api.openai.com/v1', 'insecure'],
    ['http://192.168.1.20:11434/v1', 'insecure'],
    ['http://my-mac.local:11434/v1', 'insecure'],
    ['http://localhost.evil.com/v1', 'insecure'],
    ['api.openai.com/v1', 'invalid'],
    ['ftp://api.openai.com', 'invalid'],
    ['https://', 'invalid'],
    ['https://user:pass@api.openai.com/v1', 'invalid'],
    ['https://api.openai.com/v1?key=abc', 'invalid'],
    ['https://api.openai.com/v1 extra', 'invalid'],
    ['', 'invalid'],
  ])('rejects %s (%s)', (raw, issue) => {
    expect(checkBaseUrl(raw)).toEqual({ ok: false, issue });
  });

  it('accepts every preset as is', () => {
    for (const p of OPENAI_COMPATIBLE_PRESETS)
      expect(checkBaseUrl(p.baseUrl)).toEqual({ ok: true, url: p.baseUrl });
  });

  it('names the host the key goes to', () => {
    expect(hostOf('https://openrouter.ai/api/v1')).toBe('openrouter.ai');
    expect(hostOf('http://localhost:11434/v1')).toBe('localhost');
  });
});

describe('connection check', () => {
  const models = (...ids: string[]) => ok({ object: 'list', data: ids.map((id) => ({ id })) });

  it('lists models with a GET (no tokens spent)', async () => {
    const fetchImpl = models('gpt-x');
    await checkOpenAICompatible('gpt-x', { baseUrl: BASE, apiKey: KEY, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/models`);
    expect(init.method).toBe('GET');
  });

  it.each([
    ['models/gemini-x', 'gemini-x'],
    ['llama3.2:latest', 'llama3.2'],
    ['openai/gpt-x', 'openai/gpt-x'],
  ])('finds %s when the user typed %s', async (id, model) => {
    await expect(
      checkOpenAICompatible(model, { baseUrl: BASE, fetchImpl: models('other', id) }),
    ).resolves.toBeUndefined();
  });

  it('reports a model that is not in the list', async () => {
    await expect(
      checkOpenAICompatible('typo-model', { baseUrl: BASE, fetchImpl: models('a', 'b') }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });
});
