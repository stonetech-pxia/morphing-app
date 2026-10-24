import type { Completion } from '@morph/planner';
import { describe, expect, it } from 'vitest';

import { createApp, looksLikePlan, type NeedEntry, type Relay, type ServerOptions } from './server';

// 价格设成每百万 token 1 美元：输出 10000 token 正好 $0.01，方便算限额。
const defaults: ServerOptions = {
  relay: null,
  model: 'claude-haiku-5-5',
  price: { input: 1, output: 1, cacheRead: 0 },
  perMinuteLimit: 10,
  deviceDailyUsd: 1,
  globalDailyUsd: 10,
  offPlanLimit: 3,
};

const reply = (text: string, extra: Partial<Completion> = {}): Completion => ({
  text,
  stopReason: 'end_turn',
  content: [{ type: 'text', text }],
  model: 'claude-haiku-5-5',
  usage: { inputTokens: 0, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ...extra,
});
const PLAN = '{"kind":"ops","ops":[]}';

describe('model relay (D-193)', () => {
  const make = (
    relay: Relay | null = async () => reply(PLAN),
    options: Partial<ServerOptions> = {},
  ) => {
    const logs: Record<string, unknown>[] = [];
    const seen: Parameters<Relay>[0][] = [];
    let clock = Date.UTC(2026, 9, 24, 9);
    const app = createApp({
      ...defaults,
      relay: relay
        ? async (request) => {
            seen.push(request);
            return relay(request);
          }
        : null,
      ...options,
      now: () => clock,
      log: (e) => logs.push(e),
    });
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.request('/v1/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    return { app, post, logs, seen, tick: (ms: number) => (clock += ms) };
  };
  const first = { system: 'You plan app changes.', messages: [{ role: 'user', content: 'hi' }] };
  const a = { 'x-morph-device': 'device-aaaa' };
  const b = { 'x-morph-device': 'device-bbbb' };

  it('reports whether it can reach a model', async () => {
    expect(await (await make().app.request('/health')).json()).toEqual({
      ok: true,
      ai: 'claude',
      model: 'claude-haiku-5-5',
    });
    expect(await (await make(null).app.request('/health')).json()).toMatchObject({ ai: 'none' });
    expect((await make(null).post(first)).status).toBe(503);
  });

  it('forwards only the prompt and the conversation, and logs only metadata', async () => {
    const { post, seen, logs } = make();
    const res = await post(first, a);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(reply(PLAN));
    expect(seen).toEqual([first]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain('You plan');
    expect(logged).not.toContain('device-aaaa');
    expect(logs[0]).toMatchObject({ event: 'complete', round: 1, outputTokens: 10_000, usd: 0.01 });
  });

  it('accepts the repair round with the model’s own text and thinking blocks', async () => {
    const { post } = make();
    const repair = {
      system: 'x',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: '{}' },
          ],
        },
        { role: 'user', content: 'fix: kind is missing' },
      ],
    };
    expect((await post(repair)).status).toBe(200);
  });

  it('rejects anything that is not a planning request', async () => {
    const { post, seen } = make();
    const user = (content: unknown) => ({ system: 'x', messages: [{ role: 'user', content }] });
    const rejected = [
      'not json',
      { ...first, model: 'claude-opus-5-5' },
      { ...first, max_tokens: 100_000 },
      { ...first, tools: [] },
      { messages: first.messages },
      user([{ type: 'image', source: { type: 'url', url: 'https://x.test/a.png' } }]),
      user(''),
      user('x'.repeat(64_001)),
      {
        system: 'x',
        messages: [
          ...first.messages,
          { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        ],
      },
      {
        system: 'x',
        messages: [
          ...first.messages,
          { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'n', input: {} }] },
          { role: 'user', content: 'again' },
        ],
      },
      { system: 'x', messages: [first.messages[0], first.messages[0], first.messages[0]] },
      { system: 'x'.repeat(192_001), messages: first.messages },
    ];
    for (const body of rejected) expect((await post(body)).status).toBe(400);
    expect((await post(first, { 'x-morph-device': 'no spaces!' })).status).toBe(400);
    expect(seen).toEqual([]);
    expect((await post({ system: 'x'.repeat(330 * 1024), messages: first.messages })).status).toBe(
      413,
    );
  });

  it('requires the client token when one is configured', async () => {
    const { post } = make(undefined, { clientToken: 'secret-token' });
    expect((await post(first)).status).toBe(401);
    expect((await post(first, { 'x-morph-client': 'wrong' })).status).toBe(401);
    expect((await post(first, { 'x-morph-client': 'secret-token' })).status).toBe(200);
  });

  it('limits each device per minute', async () => {
    const { post, tick } = make(undefined, { perMinuteLimit: 2 });
    expect((await post(first, a)).status).toBe(200);
    expect((await post(first, a)).status).toBe(200);
    expect(await (await post(first, a)).json()).toEqual({ error: 'rate_limited' });
    expect((await post(first, b)).status).toBe(200);
    tick(61_000);
    expect((await post(first, a)).status).toBe(200);
  });

  it('limits what each device and all devices spend per day, by the tokens used', async () => {
    const { post, tick } = make(undefined, { deviceDailyUsd: 0.02, globalDailyUsd: 0.03 });
    expect((await post(first, a)).status).toBe(200);
    expect((await post(first, a)).status).toBe(200);
    expect(await (await post(first, a)).json()).toEqual({ error: 'daily_limit' });
    expect((await post(first, b)).status).toBe(200);
    expect(await (await post(first, b)).json()).toEqual({ error: 'daily_limit' });
    tick(24 * 3600_000);
    expect((await post(first, b)).status).toBe(200);
  });

  it('stops relaying for a device whose replies keep not being plans', async () => {
    const { post, logs } = make(async () => reply('Here is the essay you asked for…'), {
      offPlanLimit: 2,
    });
    expect((await post(first, a)).status).toBe(200);
    expect((await post(first, a)).status).toBe(200);
    expect(await (await post(first, a)).json()).toEqual({ error: 'blocked' });
    expect((await post(first, b)).status).toBe(200);
    expect(logs[0]).toMatchObject({ offPlan: true });
    // 模型拒答不算。
    const refusals = make(async () => reply('', { stopReason: 'refusal' }), { offPlanLimit: 1 });
    expect((await refusals.post(first, a)).status).toBe(200);
    expect((await refusals.post(first, a)).status).toBe(200);
  });

  it('answers 502 when the model call fails', async () => {
    const res = await make(async () => Promise.reject(new Error('boom'))).post(first);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
  });

  it('recognises plan-shaped replies without knowing the Plan version', () => {
    expect(looksLikePlan('{"kind":"reject"}')).toBe(true);
    expect(looksLikePlan('```json\n{"kind":"ops","ops":[]}\n```')).toBe(true);
    expect(looksLikePlan('{"ops":[]}')).toBe(false);
    expect(looksLikePlan('["kind"]')).toBe(false);
    expect(looksLikePlan('Sure! Here is a poem.')).toBe(false);
  });
});

describe('needs (D-189)', () => {
  const make = (withStore = true, clientToken?: string) => {
    const saved: NeedEntry[] = [];
    const logs: Record<string, unknown>[] = [];
    const app = createApp({
      ...defaults,
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
