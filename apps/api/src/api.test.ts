import { BUILTIN_TOOLS, createDefaultWorkspace, createRegistry } from '@morph/core';
import { createClaudePlanner, createRelayCompleter, type Completion } from '@morph/planner';
import { describe, expect, it } from 'vitest';

import {
  createApp,
  looksLikePlan,
  type NeedEntry,
  type Relay,
  type RequestEntry,
  type ServerOptions,
} from './server';

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

  it('takes a big config: a 128 000 character request in Chinese fits in the body limit (D7)', async () => {
    // 中文每个字 3 个字节：提示词、第一条请求、修正消息都到上限，加上模型回复。
    const { post, seen } = make();
    const big = '配'.repeat(128_000);
    const body = {
      system: '提'.repeat(192_000),
      messages: [
        { role: 'user', content: big },
        { role: 'assistant', content: [{ type: 'text', text: '回'.repeat(64_000) }] },
        { role: 'user', content: big },
      ],
    };
    expect((await post(body)).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

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

  it('a planner repairing twice stays in the shape the relay accepts (AGENT_PLAN §3.6)', async () => {
    // 不合 JSON → 合法但新增 blocker → 补好。真模型回复带思考块，Relay 原样给 App。
    const tables = [
      {
        op: 'addData',
        table: { id: 'projects', name: 'P', fields: [{ id: 'name', name: 'N', type: 'text' }] },
      },
      {
        op: 'addData',
        table: {
          id: 'tasks',
          name: 'T',
          fields: [
            { id: 'title', name: 'T', type: 'text' },
            { id: 'project', name: 'P', type: 'link', table: 'projects' },
          ],
        },
      },
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'tasks-list',
          look: 'list',
          source: { table: 'tasks' },
          show: { title: 'title' },
        },
      },
    ];
    const addProject = {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'project-add',
        look: 'button',
        show: { label: 'New', variant: 'filled' },
        tools: [{ do: 'create', table: 'projects', ask: 'all' }],
      },
    };
    const texts = [
      'not json',
      JSON.stringify({ kind: 'ops', ops: tables }),
      JSON.stringify({ kind: 'ops', ops: [...tables, addProject] }),
    ];
    let call = 0;
    const { app, seen } = make(async () => {
      const text = texts[call++]!;
      return reply(text, {
        content: [
          { type: 'thinking', thinking: 'hm', signature: 'sig' },
          { type: 'redacted_thinking', data: 'xx' },
          { type: 'text', text },
        ],
      });
    });
    const registry = createRegistry(BUILTIN_TOOLS);
    const statuses: number[] = [];
    const planner = createClaudePlanner({
      registry,
      now: () => new Date(2026, 10, 3),
      complete: createRelayCompleter({
        baseUrl: 'http://relay.test',
        registry,
        fetchImpl: async (url, init) => {
          const response = await app.request(String(url).replace('http://relay.test', ''), init);
          statuses.push(response.status);
          return response;
        },
      }),
    });
    const plan = await planner.plan('tasks and projects', {
      config: createDefaultWorkspace('en'),
      registry,
      locale: 'en',
    });
    expect(statuses).toEqual([200, 200, 200]);
    expect(plan).toMatchObject({ kind: 'ops', ops: [...tables, addProject] });
    expect(seen.map((r) => r.messages.length)).toEqual([1, 3, 3]);
    expect(seen[2]!.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: texts[1] }],
    });
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
      user('x'.repeat(128_001)),
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
    expect((await post({ system: 'x'.repeat(2100 * 1024), messages: first.messages })).status).toBe(
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

  // R03：限额要在并发请求下也成立——准入检查和登记之间不能有 await，在途的请求要先预留费用。
  describe('limits hold for concurrent requests', () => {
    /** 模型调用停住，直到 open()；这样请求都「在途」。 */
    const held = () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      return { gate, open };
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('lets only one of ten simultaneous requests from a device through when the limit is one a minute', async () => {
      const { gate, open } = held();
      let calls = 0;
      const { post } = make(
        async () => {
          calls++;
          await gate;
          return reply(PLAN);
        },
        { perMinuteLimit: 1 },
      );
      const all = Array.from({ length: 10 }, () => post(first, a));
      await settle();
      expect(calls).toBe(1);
      open();
      const statuses = (await Promise.all(all)).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
    });

    it('counts what is still in flight against the daily limits, so a burst cannot overshoot by much', async () => {
      const { gate, open } = held();
      let calls = 0;
      // 每个请求最多花 $0.01（输出 10000 token）；设备一天 $0.025：在途的三个就用完了额度。
      const { post } = make(
        async () => {
          calls++;
          await gate;
          return reply(PLAN);
        },
        { deviceDailyUsd: 0.025, globalDailyUsd: 10, perMinuteLimit: 100, maxOutputTokens: 10_000 },
      );
      const all = Array.from({ length: 10 }, () => post(first, a));
      await settle();
      expect(calls).toBe(3);
      open();
      const rejected = (await Promise.all(all)).filter((r) => r.status === 429);
      expect(rejected).toHaveLength(7);
      // 都做完了、花了 $0.03：今天这台设备用完了。
      expect(await (await post(first, a)).json()).toEqual({ error: 'daily_limit' });
    });

    it('counts in-flight requests of all devices against the global daily limit', async () => {
      const { gate, open } = held();
      let calls = 0;
      const { post } = make(
        async () => {
          calls++;
          await gate;
          return reply(PLAN);
        },
        { globalDailyUsd: 0.025, perMinuteLimit: 100, maxOutputTokens: 10_000 },
      );
      const all = Array.from({ length: 8 }, (_, i) =>
        post(first, { 'x-morph-device': `device-${i}xxxx` }),
      );
      await settle();
      expect(calls).toBe(3);
      open();
      await Promise.all(all);
    });

    it('gives the reservation back when the model call fails', async () => {
      let calls = 0;
      const { post } = make(
        async () => {
          if (calls++ === 0) throw new Error('boom');
          return reply(PLAN, {
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          });
        },
        { globalDailyUsd: 0.011, maxOutputTokens: 10_000 },
      );
      expect((await post(first, a)).status).toBe(502);
      expect((await post(first, a)).status).toBe(200);
    });

    it('settles a request that was started yesterday on yesterday, not on today', async () => {
      const first1 = held();
      const second = held();
      const relays = [first1, second];
      let n = 0;
      const { post, tick } = make(
        async () => {
          const mine = n++;
          await relays[mine]?.gate;
          // 昨天的花了 $0.01；今天的没花钱。
          return mine === 0
            ? reply(PLAN)
            : reply(PLAN, {
                usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
              });
        },
        { deviceDailyUsd: 0.005, globalDailyUsd: 10, maxOutputTokens: 10_000 },
      );
      const yesterday = post(first, a);
      await settle();
      tick(24 * 3600_000);
      const today = post(first, a);
      await settle();
      expect(n).toBe(2);
      second.open();
      await today;
      first1.open();
      await yesterday;
      // 昨天那笔费用记在昨天：今天这台设备还没花钱，照常转发。
      expect((await post(first, a)).status).toBe(200);
    });
  });

  it('answers 502 when the model call fails', async () => {
    const res = await make(async () => Promise.reject(new Error('boom'))).post(first);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
  });

  it('stores the prompt, conversation and reply when a store is set up, without the raw device id (D-240)', async () => {
    const saved: RequestEntry[] = [];
    const { post, logs } = make(undefined, {
      requests: { append: async (e) => void saved.push(e) },
    });
    const res = await post(first, { ...a, 'x-morph-platform': 'ios', 'x-morph-version': '1.0.0' });
    expect(res.status).toBe(200);
    expect(saved).toEqual([
      {
        at: '2026-10-24T09:00:00.000Z',
        device: logs[0]!.device,
        platform: 'ios',
        appVersion: '1.0.0',
        round: 1,
        system: first.system,
        messages: first.messages,
        reply: PLAN,
        stopReason: 'end_turn',
        inputTokens: 0,
        outputTokens: 10_000,
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain('device-aaaa');
    // 日志照旧不记内容。
    expect(JSON.stringify(logs)).not.toContain('You plan');
    // 平台和版本格式不对就不存，请求照常转发。
    await post(first, { ...a, 'x-morph-platform': 'windows', 'x-morph-version': 'no spaces!' });
    expect(saved[1]).not.toHaveProperty('platform');
    expect(saved[1]).not.toHaveProperty('appVersion');
  });

  it('still answers when storing the request fails', async () => {
    const { post, logs } = make(undefined, {
      requests: { append: async () => Promise.reject(new Error('disk full')) },
    });
    const res = await post(first, a);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(reply(PLAN));
    expect(logs[0]).toMatchObject({ event: 'request_store_error' });
    expect(JSON.stringify(logs)).not.toContain('You plan');
  });

  it('stores nothing without a store or when the model call fails', async () => {
    const saved: RequestEntry[] = [];
    const requests = { append: async (e: RequestEntry) => void saved.push(e) };
    expect((await make().post(first, a)).status).toBe(200);
    expect(
      (await make(async () => Promise.reject(new Error('boom')), { requests }).post(first, a))
        .status,
    ).toBe(502);
    expect(saved).toEqual([]);
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
