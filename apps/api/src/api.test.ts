import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type AIProvider,
} from '@morph/core';
import { describe, expect, it } from 'vitest';

import { createApp, type NeedEntry } from './server';

const registry = createRegistry(BUILTIN_TOOLS);
const config = createDefaultWorkspace('zh');

describe('plan server', () => {
  const make = (
    provider: AIProvider = createMockAIProvider(),
    limits: {
      perMinuteLimit: number;
      dailyLimit: number;
      globalDailyLimit: number;
      clientToken?: string;
    } = {
      perMinuteLimit: 10,
      dailyLimit: 100,
      globalDailyLimit: 1000,
    },
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
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.request('/v1/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
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
    // 上下文只能是快捷操作的 id，或分享文件的类型和个数（D-124）。
    expect(
      (await post({ input: 'hi', locale: 'zh', config, about: { kind: 'shared', names: ['a'] } }))
        .status,
    ).toBe(400);
  });

  it('passes where the user opened AI from to the planner', async () => {
    const seen: unknown[] = [];
    const { post } = make({
      plan: async (_input, ctx) => {
        seen.push(ctx.about);
        return { kind: 'restorePrevious' };
      },
    });
    const about = { kind: 'shared', images: 2, pdfs: 0, others: 0 };
    expect((await post({ input: '做成一个 PDF', locale: 'zh', config, about })).status).toBe(200);
    expect(seen).toEqual([about]);
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
    const { post, tick } = make(undefined, {
      perMinuteLimit: 2,
      dailyLimit: 3,
      globalDailyLimit: 100,
    });
    const ok = { input: '主题换成绿色', locale: 'zh', config };
    expect((await post(ok)).status).toBe(200);
    expect((await post(ok)).status).toBe(200);
    expect((await post(ok)).status).toBe(429);
    tick(61_000);
    expect((await post(ok)).status).toBe(200);
    tick(61_000);
    expect(await (await post(ok)).json()).toEqual({ error: 'daily_limit' });
  });

  it('counts each device separately, under one daily cap for all', async () => {
    const { post, tick } = make(undefined, {
      perMinuteLimit: 1,
      dailyLimit: 5,
      globalDailyLimit: 3,
    });
    const ok = { input: '主题换成绿色', locale: 'zh', config };
    const a = { 'x-morph-device': 'device-aaaa' };
    const b = { 'x-morph-device': 'device-bbbb' };
    expect((await post(ok, a)).status).toBe(200);
    expect((await post(ok, a)).status).toBe(429);
    expect((await post(ok, b)).status).toBe(200);
    tick(61_000);
    expect((await post(ok, a)).status).toBe(200);
    expect(await (await post(ok, b)).json()).toEqual({ error: 'daily_limit' });
    tick(24 * 3600_000);
    expect((await post(ok, b)).status).toBe(200);
    expect((await post(ok, { 'x-morph-device': 'no spaces!' })).status).toBe(400);
  });

  it('requires the client token when one is configured', async () => {
    const { post } = make(undefined, {
      perMinuteLimit: 10,
      dailyLimit: 10,
      globalDailyLimit: 10,
      clientToken: 'secret-token',
    });
    const ok = { input: '主题换成绿色', locale: 'zh', config };
    expect((await post(ok)).status).toBe(401);
    expect((await post(ok, { 'x-morph-client': 'wrong' })).status).toBe(401);
    expect((await post(ok, { 'x-morph-client': 'secret-token' })).status).toBe(200);
  });

  it('answers 502 when the AI fails', async () => {
    const broken: AIProvider = { plan: async () => Promise.reject(new Error('boom')) };
    const res = await make(broken).post({ input: '主题换成绿色', locale: 'zh', config });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
  });
});

describe('needs (D-189)', () => {
  const make = (withStore = true, clientToken?: string) => {
    const saved: NeedEntry[] = [];
    const logs: Record<string, unknown>[] = [];
    const app = createApp({
      provider: createMockAIProvider(),
      providerName: 'mock',
      model: null,
      registry,
      perMinuteLimit: 10,
      dailyLimit: 100,
      globalDailyLimit: 1000,
      needsPerDeviceLimit: 2,
      ...(clientToken ? { clientToken } : {}),
      now: () => Date.UTC(2026, 9, 24, 9),
      log: (e) => logs.push(e),
      ...(withStore ? { needs: { append: async (e: NeedEntry) => void saved.push(e) } } : {}),
    });
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.request('/v1/needs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-morph-device': 'device-1234',
          ...headers,
        },
        body: JSON.stringify(body),
      });
    return { post, saved, logs };
  };
  const need = {
    text: '每天早上提醒我吃药',
    locale: 'zh',
    reason: 'unknown',
    ai: 'server',
    platform: 'ios',
    appVersion: '1.0.0',
  };

  it('stores only the sentence and metadata without identity, and logs no text', async () => {
    const { post, saved, logs } = make();
    expect((await post(need)).status).toBe(200);
    expect(saved).toEqual([{ at: '2026-10-24T09:00:00.000Z', ...need }]);
    expect(JSON.stringify(saved)).not.toContain('device-1234');
    expect(logs).toEqual([{ event: 'need', reason: 'unknown', chars: 9 }]);
  });

  it('rejects bad bodies, extra fields and a missing token', async () => {
    const { post } = make(true, 'secret');
    expect((await post(need)).status).toBe(401);
    const h = { 'x-morph-client': 'secret' };
    expect((await post({ ...need, reason: 'userData' }, h)).status).toBe(400);
    expect((await post({ ...need, config: {} }, h)).status).toBe(400);
    expect((await post({ ...need, text: 'x'.repeat(501) }, h)).status).toBe(400);
    expect((await post(need, h)).status).toBe(200);
  });

  it('limits each device per day', async () => {
    const { post } = make();
    expect((await post(need)).status).toBe(200);
    expect((await post(need)).status).toBe(200);
    expect((await post(need)).status).toBe(429);
    expect((await post(need, { 'x-morph-device': 'device-5678' })).status).toBe(200);
  });

  it('says it is not collecting when no store is set up', async () => {
    expect((await make(false).post(need)).status).toBe(503);
  });
});
