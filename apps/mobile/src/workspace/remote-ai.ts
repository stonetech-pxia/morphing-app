import type { AIProvider, Plan, Registry } from '@morph/core';
import {
  AIOutputError,
  RelayError,
  createClaudePlanner,
  createRelayCompleter,
} from '@morph/planner';

import type { NeedSender } from '../ai/settings';
import { t } from '../i18n';

// 「Morph 服务器」模式（D-193）：和「自带 key」一样在手机上写提示词、校验和修正，
// 只是模型调用经过 Morph 服务器转发（服务器加 key）。手机端不持有任何 API key。
// 计划仍由 store 用 PlanSchema 和 prepareOps 重新校验。

export interface RemoteAIOptions {
  baseUrl: string;
  /** 打包进 App 的客户端令牌（D-132）；登录鉴权上线前的临时防护，不是秘密。 */
  clientToken?: string | undefined;
  /** 用于服务器按设备限额。 */
  deviceId?: () => Promise<string | null>;
  platform?: 'ios' | 'android';
  appVersion?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ERROR_KEYS = {
  rate_limited: 'aiRateLimited',
  daily_limit: 'aiDailyLimit',
} as const;

export function createRemoteAIProvider(
  options: RemoteAIOptions & { registry: Registry; now: () => Date },
): AIProvider {
  const planner = createClaudePlanner({
    complete: createRelayCompleter(options),
    registry: options.registry,
    now: options.now,
  });
  return {
    async plan(input, ctx): Promise<Plan> {
      const unavailable = (
        key: 'aiUnavailable' | 'aiRateLimited' | 'aiDailyLimit' | 'aiBadOutput',
      ): Plan => ({
        kind: 'reject',
        reason: 'unavailable',
        message: t(ctx.locale, key),
        examples: [],
      });
      try {
        return await planner.plan(input, ctx);
      } catch (e) {
        if (e instanceof AIOutputError) return unavailable('aiBadOutput');
        const key =
          e instanceof RelayError ? ERROR_KEYS[e.code as keyof typeof ERROR_KEYS] : undefined;
        return unavailable(key ?? 'aiUnavailable');
      }
    },
  };
}

/**
 * 需求回收（D-189）：用户在 AI 做不到时点「把这个需求告诉我们」，把那一句话发到 /v1/needs。
 * 只发这句话、语言、拒绝原因、用的是哪种 AI、平台和版本；不发配置、文件和记录。设备 id 只用于服务器限次数，不保存。
 */
export function createNeedSender(options: RemoteAIOptions): NeedSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (need) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const device = await options.deviceId?.();
      const response = await fetchImpl(`${options.baseUrl}/v1/needs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.clientToken ? { 'x-morph-client': options.clientToken } : {}),
          ...(device ? { 'x-morph-device': device } : {}),
        },
        body: JSON.stringify({
          text: need.text,
          locale: need.locale,
          reason: need.reason,
          ai: need.ai,
          ...(options.platform ? { platform: options.platform } : {}),
          ...(options.appVersion ? { appVersion: options.appVersion } : {}),
        }),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
