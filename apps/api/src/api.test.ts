import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type AIProvider,
} from '@morph/core';
import { describe, expect, it } from 'vitest';

import { createApp } from './server';

const registry = createRegistry(BUILTIN_TOOLS);
const config = createDefaultWorkspace('zh');

describe('plan server', () => {
  const make = (
    provider: AIProvider = createMockAIProvider(),
    limits = { perMinuteLimit: 10, dailyLimit: 100 },
  ) => {
    const logs: Record<string, unknown>[] = [];
    let clock = Date.UTC(2026, 9, 22, 9);
    const app = createApp({
      provider,
      providerName: 'mock',
      model: null,
      registry,
      ...limits,
      now: () => clock,
      log: (e) => logs.push(e),
    });
    const post = (body: unknown) =>
      app.request('/v1/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    return { app, post, logs, tick: (ms: number) => (clock += ms) };
  };

  it('reports which AI it uses', async () => {
    const res = await make().app.request('/health');
    expect(await res.json()).toEqual({ ok: true, ai: 'mock', model: null });
  });

  it('returns a plan and logs only metadata', async () => {
    const { post, logs } = make();
    const res = await post({ input: '主题换成绿色', locale: 'zh', config });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plan: { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] },
    });
    expect(JSON.stringify(logs)).not.toContain('主题');
  });

  it('rejects malformed requests and invalid configs', async () => {
    const { post } = make();
    expect((await post('not json')).status).toBe(400);
    expect((await post({ input: '', locale: 'zh', config })).status).toBe(400);
    expect((await post({ input: 'x'.repeat(501), locale: 'zh', config })).status).toBe(400);
    expect((await post({ input: 'hi', locale: 'zh', config: { schemaVersion: 1 } })).status).toBe(
      400,
    );
    expect((await post({ input: 'hi', locale: 'zh', config, extra: true })).status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const res = await make().post({
      input: 'hi',
      locale: 'zh',
      config: { padding: 'x'.repeat(70_000) },
    });
    expect(res.status).toBe(413);
  });

  it('enforces the per-minute and daily limits', async () => {
    const { post, tick } = make(undefined, { perMinuteLimit: 2, dailyLimit: 3 });
    const ok = { input: '主题换成绿色', locale: 'zh', config };
    expect((await post(ok)).status).toBe(200);
    expect((await post(ok)).status).toBe(200);
    expect((await post(ok)).status).toBe(429);
    tick(61_000);
    expect((await post(ok)).status).toBe(200);
    tick(61_000);
    expect(await (await post(ok)).json()).toEqual({ error: 'daily_limit' });
  });

  it('answers 502 when the AI fails', async () => {
    const broken: AIProvider = { plan: async () => Promise.reject(new Error('boom')) };
    const res = await make(broken).post({ input: '主题换成绿色', locale: 'zh', config });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
  });
});
