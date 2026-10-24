import { createDefaultWorkspace, type RejectReason } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AISettingsProvider } from '../ai/context';
import { createAISettingsStore, type Need, type SecretStore } from '../ai/settings';
import { makePalette } from '../renderer/theme';
import { NeedButton } from '../shell/NeedButton';
import { createNeedSender } from '../workspace/remote-ai';

// 需求回收（D-189）：AI 做不到时，用户点了才把那一句话发给 Morph；发的内容只有这句话和几项元数据。

const secrets = (): SecretStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

const palette = makePalette(createDefaultWorkspace('zh').theme, false);

async function setup(reason: RejectReason | undefined, { ok = true, server = true } = {}) {
  const sent: Need[] = [];
  const store = createAISettingsStore({
    secrets: secrets(),
    serverAvailable: server,
    needs: server
      ? async (need) => {
          sent.push(need);
          return ok;
        }
      : null,
  });
  await store.getState().load();
  await render(
    <AISettingsProvider store={store}>
      <NeedButton text="每天早上提醒我吃药" reason={reason} palette={palette} locale="zh" />
    </AISettingsProvider>,
  );
  return { sent, store };
}

describe('NeedButton', () => {
  it('sends the sentence only when the user taps it', async () => {
    const { sent } = await setup('unknown');
    expect(sent).toEqual([]);
    expect(screen.getByText('只发送这一句话给 Morph，不含文件、记录和设置。')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('need-send'));
    expect(sent).toEqual([
      { text: '每天早上提醒我吃药', locale: 'zh', reason: 'unknown', ai: 'server' },
    ]);
    expect(await screen.findByTestId('need-sent')).toBeTruthy();
  });

  it('can try again when sending fails', async () => {
    await setup('errand', { ok: false });
    await fireEvent.press(screen.getByTestId('need-send'));
    expect(await screen.findByText('没发出去，再试一次')).toBeTruthy();
  });

  it.each(['userData', 'protected', 'deleteFiles', 'noChange', 'unavailable', undefined] as const)(
    'is not shown for %s (things Morph refuses on purpose, or an outage)',
    async (reason) => {
      await setup(reason);
      expect(screen.queryByTestId('need-send')).toBeNull();
    },
  );

  it('is not shown without a server, or when turned off in settings', async () => {
    await setup('unknown', { server: false });
    expect(screen.queryByTestId('need-send')).toBeNull();

    const { store } = await setup('unknown');
    expect(screen.getByTestId('need-send')).toBeTruthy();
    await store.getState().setNeedsButton(false);
    expect(screen.queryByTestId('need-send')).toBeNull();
  });
});

describe('createNeedSender', () => {
  it('posts only the sentence, locale, reason, AI mode, platform and version', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = createNeedSender({
      baseUrl: 'https://api.example',
      clientToken: 'token',
      deviceId: async () => 'device-1234',
      platform: 'ios',
      appVersion: '1.2.0',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{"ok":true}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await send({ text: '提醒我吃药', locale: 'zh', reason: 'unknown', ai: 'mock' })).toBe(
      true,
    );
    expect(calls[0]!.url).toBe('https://api.example/v1/needs');
    expect(calls[0]!.init.headers).toMatchObject({
      'x-morph-client': 'token',
      'x-morph-device': 'device-1234',
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      text: '提醒我吃药',
      locale: 'zh',
      reason: 'unknown',
      ai: 'mock',
      platform: 'ios',
      appVersion: '1.2.0',
    });
  });

  it('reports failure on an error status or no network', async () => {
    const failing = createNeedSender({
      baseUrl: 'https://api.example',
      fetchImpl: (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch,
    });
    expect(await failing({ text: 'x', locale: 'en', reason: 'unknown', ai: 'server' })).toBe(false);
    const offline = createNeedSender({
      baseUrl: 'https://api.example',
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(await offline({ text: 'x', locale: 'en', reason: 'unknown', ai: 'server' })).toBe(false);
  });
});
