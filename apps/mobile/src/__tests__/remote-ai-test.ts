import { BUILTIN_TOOLS, createDefaultWorkspace, createRegistry } from '@morph/core';

import { createRemoteAIProvider } from '../workspace/remote-ai';

const registry = createRegistry(BUILTIN_TOOLS);
const ctx = { config: createDefaultWorkspace('zh'), registry, locale: 'zh' as const };
const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

const respond = (status: number, body: unknown) =>
  jest.fn(
    async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response,
  );

describe('remote AI provider', () => {
  it('posts the request and returns the server plan', async () => {
    const fetchImpl = respond(200, { plan: green });
    const provider = createRemoteAIProvider({ baseUrl: 'http://api.test', fetchImpl });
    expect(await provider.plan('主题换成绿色', ctx)).toEqual(green);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/plan');
    expect(JSON.parse(String(init.body))).toEqual({
      input: '主题换成绿色',
      locale: 'zh',
      config: ctx.config,
    });
  });

  it('sends the client token and device id when it has them', async () => {
    const fetchImpl = respond(200, { plan: green });
    const provider = createRemoteAIProvider({
      baseUrl: 'http://api.test',
      clientToken: 'token-1',
      deviceId: async () => 'device-1234',
      fetchImpl,
    });
    await provider.plan('主题换成绿色', ctx);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-morph-client': 'token-1',
      'x-morph-device': 'device-1234',
    });
  });

  it('explains server limits instead of failing silently', async () => {
    const limited = createRemoteAIProvider({
      baseUrl: 'http://api.test',
      fetchImpl: respond(429, { error: 'rate_limited' }),
    });
    expect(await limited.plan('x', ctx)).toMatchObject({
      kind: 'reject',
      message: '请求太频繁了，请等一分钟再试。',
    });
    const daily = createRemoteAIProvider({
      baseUrl: 'http://api.test',
      fetchImpl: respond(429, { error: 'daily_limit' }),
    });
    expect(await daily.plan('x', ctx)).toMatchObject({
      kind: 'reject',
      message: '今天的 AI 请求次数已用完，请明天再试。',
    });
  });

  it('never changes anything when the service is unreachable or broken', async () => {
    const down = createRemoteAIProvider({
      baseUrl: 'http://api.test',
      fetchImpl: jest.fn(async () => Promise.reject(new TypeError('Network request failed'))),
    });
    expect(await down.plan('x', ctx)).toMatchObject({ kind: 'reject', reason: 'unknown' });
    const broken = createRemoteAIProvider({
      baseUrl: 'http://api.test',
      fetchImpl: respond(502, { error: 'ai_unavailable' }),
    });
    expect(await broken.plan('x', ctx)).toMatchObject({
      kind: 'reject',
      message: '暂时连不上 AI 服务，没有做任何修改，请稍后再试。',
    });
  });

  it('gives up after the timeout', async () => {
    const hanging = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const provider = createRemoteAIProvider({
      baseUrl: 'http://api.test',
      fetchImpl: hanging as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(await provider.plan('x', ctx)).toMatchObject({ kind: 'reject' });
  });
});
