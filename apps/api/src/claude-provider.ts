import Anthropic from '@anthropic-ai/sdk';
import type { Registry } from '@morph/core';
import { systemPromptFor, supportsServerFallback, type Complete } from '@morph/planner';

// 服务端的模型调用传输层（官方 SDK）。规划逻辑在 @morph/planner，与 App 内的 HTTP 传输共用。
// API key 只在服务端进程中，从不离开服务器。

export interface SdkCompleterOptions {
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
  registry: Registry;
}

export function createSdkCompleter(client: Anthropic, options: SdkCompleterOptions): Complete {
  return async (messages) => {
    const response = await client.beta.messages.create({
      model: options.model,
      max_tokens: 16000,
      // 系统提示词稳定不变，标记缓存以降低重复请求的成本。
      system: [
        {
          type: 'text',
          text: systemPromptFor(options.registry),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: messages as Anthropic.Beta.BetaMessageParam[],
      ...(options.effort ? { output_config: { effort: options.effort } } : {}),
      ...(supportsServerFallback(options.model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    });
    return {
      text: response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      stopReason: response.stop_reason,
      content: response.content,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  };
}
