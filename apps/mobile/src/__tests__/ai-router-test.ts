import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type AIProvider,
} from '@morph/core';

import { createAIRouter } from '../ai/router';
import { createAISettingsStore, type SecretStore } from '../ai/settings';

const registry = createRegistry(BUILTIN_TOOLS);
const ctx = { config: createDefaultWorkspace('zh'), registry, locale: 'zh' as const };
const KEY = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';

class MemorySecrets implements SecretStore {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async delete(k: string) {
    this.data.delete(k);
  }
}

const claudeReply = (plan: unknown) =>
  jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(plan) }],
          stop_reason: 'end_turn',
          model: 'claude-opus-5-5',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      ),
  );
const claudeError = (status: number, type: string) =>
  jest.fn(
    async () =>
      new Response(JSON.stringify({ type: 'error', error: { type, message: 'x' } }), { status }),
  );

async function setup(
  options: { serverAvailable?: boolean; fetchImpl?: typeof fetch; remote?: AIProvider } = {},
) {
  const secrets = new MemorySecrets();
  const settings = createAISettingsStore({
    secrets,
    serverAvailable: options.serverAvailable ?? false,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  await settings.getState().load();
  const router = createAIRouter({
    settings,
    mock: createMockAIProvider(),
    remote: options.remote ?? null,
    registry,
    now: () => new Date(2026, 9, 22),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return { secrets, settings, router };
}

describe('AI settings', () => {
  it('defaults to the server when one is configured, otherwise to the built-in rules', async () => {
    expect((await setup({ serverAvailable: true })).settings.getState().mode).toBe('server');
    const { settings } = await setup();
    expect(settings.getState().mode).toBe('mock');
    await settings.getState().setMode('server');
    expect(settings.getState().mode).toBe('mock');
  });

  it('only stores things that look like a Claude API key, and shows just the last four characters', async () => {
    const { settings, secrets } = await setup();
    expect(await settings.getState().saveKey('hello')).toBe(false);
    expect(await settings.getState().saveKey(`  ${KEY}  `)).toBe(true);
    expect(settings.getState().keyHint).toBe('WXYZ');
    expect(await secrets.get('morph.ai.apiKey')).toBe(KEY);
    await settings.getState().clearKey();
    expect(settings.getState().keyHint).toBeNull();
    expect(await secrets.get('morph.ai.apiKey')).toBeNull();
  });

  it('remembers the mode and model across restarts', async () => {
    const { settings, secrets } = await setup();
    await settings.getState().setMode('byok');
    await settings.getState().setModel('claude-haiku-5-5');
    const reloaded = createAISettingsStore({ secrets, serverAvailable: false });
    await reloaded.getState().load();
    expect(reloaded.getState()).toMatchObject({ mode: 'byok', model: 'claude-haiku-5-5' });
  });

  it('tests the connection without spending tokens and explains failures', async () => {
    const ok = jest.fn(
      async () => new Response(JSON.stringify({ id: 'claude-opus-5-5' }), { status: 200 }),
    );
    const a = await setup({ fetchImpl: ok });
    expect(await a.settings.getState().testConnection()).toEqual({ ok: false, kind: 'no_key' });
    await a.settings.getState().saveKey(KEY);
    expect(await a.settings.getState().testConnection()).toEqual({ ok: true });
    expect((ok.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.anthropic.com/v1/models/claude-opus-5-5',
    );

    const b = await setup({ fetchImpl: claudeError(401, 'authentication_error') });
    await b.settings.getState().saveKey(KEY);
    expect(await b.settings.getState().testConnection()).toEqual({
      ok: false,
      kind: 'invalid_key',
    });
  });
});

describe('AI router', () => {
  const green = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };

  it('uses the built-in rules in mock mode and the server in server mode', async () => {
    const { router } = await setup();
    expect(await router.plan('主题换成绿色', ctx)).toEqual(green);

    const remote: AIProvider = {
      plan: jest.fn(async () => ({ kind: 'restorePrevious' as const })),
    };
    const withServer = await setup({ serverAvailable: true, remote });
    expect(await withServer.router.plan('随便', ctx)).toEqual({ kind: 'restorePrevious' });
  });

  it('asks for a key before calling Claude directly', async () => {
    const { settings, router } = await setup();
    await settings.getState().setMode('byok');
    expect(await router.plan('主题换成绿色', ctx)).toMatchObject({
      kind: 'reject',
      message: '请先在「设置 → AI」里填写你的 Claude API key。',
    });
  });

  it('calls Claude with the user’s key and returns the validated plan', async () => {
    const fetchImpl = claudeReply(green);
    const { settings, router } = await setup({ fetchImpl });
    await settings.getState().setMode('byok');
    await settings.getState().setModel('claude-haiku-5-5');
    await settings.getState().saveKey(KEY);
    expect(await router.plan('我想要绿色', ctx)).toEqual(green);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(String(init.body)).model).toBe('claude-haiku-5-5');
  });

  it.each([
    [401, 'authentication_error', 'API key 无效或已被删除，请在「设置 → AI」里检查。'],
    [529, 'overloaded_error', 'Claude 服务暂时繁忙，没有做任何修改，请稍后再试。'],
  ])('turns HTTP %i into a clear “nothing changed” message', async (status, type, message) => {
    const { settings, router } = await setup({ fetchImpl: claudeError(status, type) });
    await settings.getState().setMode('byok');
    await settings.getState().saveKey(KEY);
    expect(await router.plan('我想要绿色', ctx)).toMatchObject({ kind: 'reject', message });
  });

  it('handles a network failure', async () => {
    const down = jest.fn(async () => Promise.reject(new TypeError('Network request failed')));
    const { settings, router } = await setup({ fetchImpl: down as unknown as typeof fetch });
    await settings.getState().setMode('byok');
    await settings.getState().saveKey(KEY);
    expect(await router.plan('我想要绿色', ctx)).toMatchObject({
      kind: 'reject',
      message: '连不上 Claude API，没有做任何修改，请检查网络后再试。',
    });
  });
});
