import type { AIProvider, Locale, Plan, Registry } from '@morph/core';
import {
  AIOutputError,
  ClaudeHttpError,
  createClaudePlanner,
  createHttpCompleter,
  type ClaudeErrorKind,
} from '@morph/planner';

import { t, type StringKey } from '../i18n';
import type { AISettingsStore } from './settings';

// 按设置选择 AI：内置规则、Morph 服务器，或用户自带 key 直接调用 Claude。
// 任何失败都返回“没有做任何修改”的拒绝，不会静默换成另一种 AI。

const ERROR_MESSAGES: Record<ClaudeErrorKind | 'network' | 'bad_output', StringKey> = {
  invalid_key: 'byokInvalidKey',
  permission: 'byokPermission',
  spend_limit: 'byokSpendLimit',
  rate_limit: 'aiRateLimited',
  overloaded: 'byokBusy',
  server: 'byokBusy',
  not_found: 'byokModelNotFound',
  bad_request: 'byokUnavailable',
  timeout: 'byokUnavailable',
  network: 'byokUnavailable',
  bad_output: 'aiBadOutput',
};

const reject = (locale: Locale, key: StringKey): Plan => ({
  kind: 'reject',
  reason: 'unknown',
  message: t(locale, key),
  examples: [],
});

export function createAIRouter(deps: {
  settings: AISettingsStore;
  mock: AIProvider;
  remote: AIProvider | null;
  registry: Registry;
  now: () => Date;
  fetchImpl?: typeof fetch;
}): AIProvider {
  return {
    async plan(input, ctx) {
      const { mode, model } = deps.settings.getState();
      if (mode === 'mock') return deps.mock.plan(input, ctx);
      if (mode === 'server') return (deps.remote ?? deps.mock).plan(input, ctx);

      const apiKey = await deps.settings.getState().getKey();
      if (!apiKey) return reject(ctx.locale, 'byokNoKey');
      const planner = createClaudePlanner({
        complete: createHttpCompleter({
          apiKey,
          model,
          registry: deps.registry,
          timeoutMs: 60_000,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        }),
        registry: deps.registry,
        now: deps.now,
      });
      try {
        return await planner.plan(input, ctx);
      } catch (e) {
        if (e instanceof ClaudeHttpError) return reject(ctx.locale, ERROR_MESSAGES[e.kind]);
        if (e instanceof AIOutputError) return reject(ctx.locale, ERROR_MESSAGES.bad_output);
        return reject(ctx.locale, ERROR_MESSAGES.network);
      }
    },
  };
}
