import type { Registry } from '@morph/core';

import type { Complete, Completion } from './planner';
import { systemPromptFor } from './prompt';

// 「Morph 服务器」模式的传输层（D-193）：提示词、校验和修正都在 App 里，和「自带 key」一样；
// 服务器只加上 key、转发给 Claude，不认识 schema、工具和提示词，所以 App 升级时服务器不用跟着改。

export interface RelayCompleterOptions {
  baseUrl: string;
  registry: Registry;
  /** 打包进 App 的客户端令牌（D-132）；不是秘密。 */
  clientToken?: string | undefined;
  /** 用于服务器按设备限额。 */
  deviceId?: (() => Promise<string | null>) | undefined;
  /** 测试期服务器随请求保存（D-240）。 */
  platform?: 'ios' | 'android' | undefined;
  appVersion?: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** 服务器拒绝或连不上。code 是服务器返回的 error（rate_limited、daily_limit 等），或 network / timeout。 */
export class RelayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`Morph relay error ${status} (${code})`);
  }
}

export function createRelayCompleter(options: RelayCompleterOptions): Complete {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (messages, system): Promise<Completion> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
    try {
      const device = await options.deviceId?.();
      const response = await fetchImpl(`${options.baseUrl}/v1/complete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.clientToken ? { 'x-morph-client': options.clientToken } : {}),
          ...(device ? { 'x-morph-device': device } : {}),
          ...(options.platform ? { 'x-morph-platform': options.platform } : {}),
          ...(options.appVersion ? { 'x-morph-version': options.appVersion } : {}),
        },
        body: JSON.stringify({ system: system ?? systemPromptFor(options.registry), messages }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as
        (Completion & { error?: string }) | null;
      if (!response.ok || !body || typeof body.text !== 'string') {
        throw new RelayError(body?.error ?? 'unavailable', response.status);
      }
      return body;
    } catch (e) {
      if (e instanceof RelayError) throw e;
      throw new RelayError(controller.signal.aborted ? 'timeout' : 'network', 0);
    } finally {
      clearTimeout(timer);
    }
  };
}
