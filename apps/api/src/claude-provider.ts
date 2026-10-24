import Anthropic from '@anthropic-ai/sdk';
import { supportsServerFallback, type Completion } from '@morph/planner';

import type { Relay } from './server';

// 服务端的模型调用（官方 SDK）。提示词和对话由 App 给（D-193）；模型、输出上限和思考力度由服务器定。
// API key 只在服务端进程中，从不离开服务器。

export interface SdkRelayOptions {
  model: string;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
}

/** 只留 App 修正时要原样发回的内容块，字段也只留这些；/v1/complete 只接受这些。 */
function replayable(block: Anthropic.Beta.BetaContentBlock): unknown[] {
  if (block.type === 'text') return [{ type: 'text', text: block.text }];
  if (block.type === 'thinking') {
    return [{ type: 'thinking', thinking: block.thinking, signature: block.signature }];
  }
  if (block.type === 'redacted_thinking') return [{ type: 'redacted_thinking', data: block.data }];
  return [];
}

export function createSdkRelay(client: Anthropic, options: SdkRelayOptions): Relay {
  return async ({ system, messages }): Promise<Completion> => {
    const response = await client.beta.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      // 同一个 App 版本的系统提示词不变，标记缓存以降低重复请求的成本。
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
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
      content: response.content.flatMap(replayable),
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
