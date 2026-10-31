import { BUILTIN_TOOLS, createDefaultWorkspace, createRegistry } from '@morph/core';
import { systemPromptFor } from '@morph/planner';

import { createRemoteAIProvider, type RemoteAIOptions } from '../workspace/remote-ai';

const registry = createRegistry(BUILTIN_TOOLS);
const ctx = { config: createDefaultWorkspace('zh'), registry, locale: 'zh' as const };
const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

const respond = (status: number, body: unknown) =>
  jest.fn(
    async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response,
  );
/** 服务器转发回来的一次模型回复（D-193）。 */
const completion = (text: string) => ({
  text,
  stopReason: 'end_turn',
  content: [{ type: 'text', text }],
  model: 'claude-haiku-5-5',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
const make = (options: Omit<RemoteAIOptions, 'baseUrl'>) =>
  createRemoteAIProvider({
    baseUrl: 'http://api.test',
    registry,
    now: () => new Date(),
    ...options,
  });
const bodyOf = (fetchImpl: jest.Mock, call = 0) =>
  JSON.parse(String((fetchImpl.mock.calls[call] as unknown as [string, RequestInit])[1].body)) as {
    system: string;
    messages: { role: string; content: unknown }[];
  };

describe('remote AI provider', () => {
  it('writes the prompt on the phone and sends only the model call through the server', async () => {
    const fetchImpl = respond(200, completion(JSON.stringify(green)));
    expect(await make({ fetchImpl }).plan('主题换成绿色', ctx)).toEqual(green);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://api.test/v1/complete');
    const body = bodyOf(fetchImpl);
    expect(Object.keys(body)).toEqual(['system', 'messages']);
    // 提示词按需加载：换主题只发主题这一类的部分（route.ts）。
    expect(body.system).toBe(systemPromptFor(registry, 'style'));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: 'user' });
    expect(String(body.messages[0]!.content)).toContain('主题换成绿色');
  });

  it('asks the model to fix an unusable reply through the server too', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => completion('not json') })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => completion(JSON.stringify(green)),
      });
    expect(await make({ fetchImpl }).plan('主题换成绿色', ctx)).toEqual(green);
    const repair = bodyOf(fetchImpl, 1).messages;
    expect(repair.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(repair[1]!.content).toEqual([{ type: 'text', text: 'not json' }]);
  });

  it('sends the client token, device id, platform and version when it has them', async () => {
    const fetchImpl = respond(200, completion(JSON.stringify(green)));
    await make({
      clientToken: 'token-1',
      deviceId: async () => 'device-1234',
      platform: 'ios',
      appVersion: '1.2.0',
      fetchImpl,
    }).plan('主题换成绿色', ctx);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-morph-client': 'token-1',
      'x-morph-device': 'device-1234',
      'x-morph-platform': 'ios',
      'x-morph-version': '1.2.0',
    });
  });

  it('explains server limits instead of failing silently', async () => {
    expect(
      await make({ fetchImpl: respond(429, { error: 'rate_limited' }) }).plan('x', ctx),
    ).toMatchObject({
      kind: 'reject',
      message: '请求太频繁了，请等一分钟再试。',
    });
    expect(
      await make({ fetchImpl: respond(429, { error: 'daily_limit' }) }).plan('x', ctx),
    ).toMatchObject({
      kind: 'reject',
      message: '今天的 AI 请求次数已用完，请明天再试。',
    });
  });

  it('never changes anything when the service is unreachable, broken or the reply is unusable', async () => {
    const down = make({
      fetchImpl: jest.fn(async () => Promise.reject(new TypeError('Network request failed'))),
    });
    // 连不上不是「做不到」：用 unavailable，不显示「把这个需求告诉我们」（D-189）。
    expect(await down.plan('x', ctx)).toMatchObject({ kind: 'reject', reason: 'unavailable' });
    expect(
      await make({ fetchImpl: respond(502, { error: 'ai_unavailable' }) }).plan('x', ctx),
    ).toMatchObject({
      kind: 'reject',
      message: '暂时连不上 AI 服务，没有做任何修改，请稍后再试。',
    });
    expect(
      await make({ fetchImpl: respond(403, { error: 'blocked' }) }).plan('x', ctx),
    ).toMatchObject({
      kind: 'reject',
      reason: 'unavailable',
    });
    expect(
      await make({ fetchImpl: respond(200, completion('still not json')) }).plan('x', ctx),
    ).toMatchObject({
      kind: 'reject',
      reason: 'unavailable',
    });
  });

  it('gives up after the timeout', async () => {
    const hanging = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const provider = make({ fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 20 });
    expect(await provider.plan('x', ctx)).toMatchObject({ kind: 'reject' });
  });
});
