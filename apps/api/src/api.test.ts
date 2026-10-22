import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type AIProvider,
} from '@morph/core';
import { describe, expect, it, vi } from 'vitest';

import { createClaudeProvider, type Complete, type Completion } from './claude-provider';
import { buildSystemPrompt } from './prompt';
import { createApp } from './server';

const registry = createRegistry(BUILTIN_TOOLS);
const config = createDefaultWorkspace('zh');
const ctx = { config, registry, locale: 'zh' as const };

const reply = (text: string, stopReason = 'end_turn'): Completion => ({
  text,
  stopReason,
  content: [{ type: 'text', text }],
  model: 'claude-test',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
const json = (value: unknown) => reply(JSON.stringify(value));

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
});

describe('Claude provider', () => {
  const now = () => new Date(2026, 9, 22);
  const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

  it('returns a valid plan from the first reply', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(json(green));
    const provider = createClaudeProvider({ complete, registry, now });
    expect(await provider.plan('主题换成绿色', ctx)).toEqual(green);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('tolerates a code fence around the JSON', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValue(reply('```json\n' + JSON.stringify(green) + '\n```'));
    expect(
      await createClaudeProvider({ complete, registry, now }).plan('主题换成绿色', ctx),
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
    const result = await createClaudeProvider({ complete, registry, now }).plan(
      '导航只要首页、工具、设置',
      ctx,
    );
    expect(result).toMatchObject({
      kind: 'ops',
      ops: [{ op: 'setNavItems', items: ['page:home', 'tools', 'settings'] }],
    });
    expect(complete).toHaveBeenCalledTimes(2);
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
      await createClaudeProvider({ complete, registry, now }).plan('主题换成绿色', ctx),
    ).toEqual(green);

    const notAPlan = vi
      .fn<Complete>()
      .mockResolvedValueOnce(json({ kind: 'ops', ops: [{ op: 'runScript' }] }))
      .mockResolvedValueOnce(json(green));
    expect(
      await createClaudeProvider({ complete: notAPlan, registry, now }).plan('主题换成绿色', ctx),
    ).toEqual(green);
  });

  it('after one repair, returns an invalid-but-well-formed plan for the app to reject', async () => {
    const bad = json({
      kind: 'ops',
      ops: [{ op: 'removeComponent', pageId: 'home', componentId: 'nope' }],
    });
    const complete = vi.fn<Complete>().mockResolvedValue(bad);
    expect(
      await createClaudeProvider({ complete, registry, now }).plan('删掉不存在的东西', ctx),
    ).toMatchObject({ kind: 'ops' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('fails loudly when the reply never becomes a plan', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(reply('no idea'));
    await expect(
      createClaudeProvider({ complete, registry, now }).plan('主题换成绿色', ctx),
    ).rejects.toThrow('unusable');
  });

  it('turns a safety refusal into a polite rejection', async () => {
    const complete = vi.fn<Complete>().mockResolvedValue(reply('', 'refusal'));
    expect(await createClaudeProvider({ complete, registry, now }).plan('……', ctx)).toMatchObject({
      kind: 'reject',
      reason: 'unknown',
    });
  });
});

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
