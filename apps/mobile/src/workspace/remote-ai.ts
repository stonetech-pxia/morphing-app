import type { AIProvider, Plan } from '@morph/core';

import { t } from '../i18n';

// 通过 Morph API 服务调用真实模型（M3）。手机端不持有任何 API key。
// 服务返回的计划仍由 store 用 PlanSchema 和 prepareOps 重新校验。

export interface RemoteAIOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ERROR_KEYS = {
  rate_limited: 'aiRateLimited',
  daily_limit: 'aiDailyLimit',
} as const;

export function createRemoteAIProvider(options: RemoteAIOptions): AIProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 45_000;
  return {
    async plan(input, ctx): Promise<Plan> {
      const unavailable = (key: 'aiUnavailable' | 'aiRateLimited' | 'aiDailyLimit'): Plan => ({
        kind: 'reject',
        reason: 'unknown',
        message: t(ctx.locale, key),
        examples: [],
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${options.baseUrl}/v1/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, locale: ctx.locale, config: ctx.config }),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as {
          plan?: unknown;
          error?: string;
        } | null;
        if (!response.ok || !body?.plan) {
          const key = body?.error ? ERROR_KEYS[body.error as keyof typeof ERROR_KEYS] : undefined;
          return unavailable(key ?? 'aiUnavailable');
        }
        return body.plan as Plan;
      } catch {
        return unavailable('aiUnavailable');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
