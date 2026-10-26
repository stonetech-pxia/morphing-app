import type { AIProvider, Locale, Plan, Registry } from '@morph/core';
import {
  AIOutputError,
  AIHttpError,
  createClaudePlanner,
  createHttpCompleter,
  createOpenAICompleter,
  type AIErrorKind,
} from '@morph/planner';

import { t, type StringKey } from '../i18n';
import type { AISettingsStore } from './settings';

// 按设置选择 AI：内置规则、Morph 服务器，或用户自带 key 直接调用 Claude / OpenAI 兼容接口（D-241）。
// 任何失败都返回“没有做任何修改”的拒绝，不会静默换成另一种 AI。

const ERROR_MESSAGES: Record<AIErrorKind | 'network' | 'bad_output', StringKey> = {
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

/** OpenAI 兼容接口：提到 Claude 的几条换成不点名的说法。 */
const OTHER_ERROR_MESSAGES: typeof ERROR_MESSAGES = {
  ...ERROR_MESSAGES,
  spend_limit: 'byokOtherSpendLimit',
  overloaded: 'byokOtherBusy',
  server: 'byokOtherBusy',
  bad_request: 'byokOtherUnavailable',
  timeout: 'byokOtherUnavailable',
  network: 'byokOtherUnavailable',
};

const reject = (locale: Locale, key: StringKey): Plan => ({
  kind: 'reject',
  reason: 'unavailable',
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

      const { provider, baseUrl, customModel } = deps.settings.getState();
      const apiKey = await deps.settings.getState().getKey();
      const fetchImpl = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};
      let complete;
      if (provider === 'openai') {
        // 本地模型可以不填 key；地址和模型名必须有。
        if (!baseUrl || !customModel) return reject(ctx.locale, 'byokNoEndpoint');
        complete = createOpenAICompleter({
          baseUrl,
          apiKey,
          model: customModel,
          registry: deps.registry,
          // 本机模型可能很慢。
          timeoutMs: 120_000,
          ...fetchImpl,
        });
      } else {
        if (!apiKey) return reject(ctx.locale, 'byokNoKey');
        complete = createHttpCompleter({
          apiKey,
          model,
          registry: deps.registry,
          timeoutMs: 60_000,
          ...fetchImpl,
        });
      }
      const planner = createClaudePlanner({ complete, registry: deps.registry, now: deps.now });
      const messages = provider === 'openai' ? OTHER_ERROR_MESSAGES : ERROR_MESSAGES;
      try {
        return await planner.plan(input, ctx);
      } catch (e) {
        if (e instanceof AIHttpError) return reject(ctx.locale, messages[e.kind]);
        if (e instanceof AIOutputError) return reject(ctx.locale, messages.bad_output);
        return reject(ctx.locale, messages.network);
      }
    },
  };
}
