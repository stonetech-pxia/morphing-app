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

function requestParams(
  options: SdkRelayOptions,
  { system, messages }: Parameters<Relay>[0],
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    // 同一个 App 版本的系统提示词不变，标记缓存以降低重复请求的成本。
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: messages as Anthropic.Beta.BetaMessageParam[],
    ...(options.effort ? { output_config: { effort: options.effort } } : {}),
  };
}

function toCompletion(response: Anthropic.Beta.BetaMessage): Completion {
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
}

export function createSdkRelay(client: Anthropic, options: SdkRelayOptions): Relay {
  return async (request): Promise<Completion> => {
    const response = await client.beta.messages.create({
      ...requestParams(options, request),
      ...(supportsServerFallback(options.model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    });
    return toCompletion(response);
  };
}

export interface BatchTiming {
  /** 多久没有新请求就把攒下的请求提交成一批。 */
  idleMs?: number;
  /** 查询批次状态的间隔。 */
  pollMs?: number;
  log?: (line: string) => void;
}

interface Pending {
  params: Anthropic.Beta.MessageCreateParamsNonStreaming;
  resolve: (completion: Completion) => void;
  reject: (error: unknown) => void;
}

/**
 * 只给评测用：把同时到达的请求攒成一批，走批处理 API（半价，但要等几分钟到几小时）。
 * 批处理 API 不接受 fallbacks，所以这里不加拒答回退。
 */
export function createBatchRelay(
  client: Anthropic,
  options: SdkRelayOptions,
  { idleMs = 1_000, pollMs = 30_000, log }: BatchTiming = {},
): Relay {
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (pending: Pending[]) => {
    try {
      let batch = await client.beta.messages.batches.create({
        requests: pending.map((p, i) => ({ custom_id: String(i), params: p.params })),
      });
      log?.(`已提交批次 ${batch.id}（${pending.length} 个请求），等待结果…`);
      while (batch.processing_status !== 'ended') {
        await new Promise((r) => setTimeout(r, pollMs));
        batch = await client.beta.messages.batches.retrieve(batch.id);
      }
      // 结果的顺序不固定，按 custom_id 对回请求。
      for await (const item of await client.beta.messages.batches.results(batch.id)) {
        const p = pending[Number(item.custom_id)];
        if (!p) continue;
        if (item.result.type === 'succeeded') p.resolve(toCompletion(item.result.message));
        else
          p.reject(
            new Error(
              item.result.type === 'errored'
                ? `批处理请求出错：${JSON.stringify(item.result.error)}`
                : `批处理请求未完成：${item.result.type}`,
            ),
          );
      }
      // 已经有结果的请求，这里的 reject 不起作用。
      for (const p of pending) p.reject(new Error('批处理结果里没有这个请求'));
    } catch (e) {
      for (const p of pending) p.reject(e);
    }
  };

  return (request) =>
    new Promise<Completion>((resolve, reject) => {
      queue.push({ params: requestParams(options, request), resolve, reject });
      clearTimeout(timer);
      timer = setTimeout(() => {
        const pending = queue;
        queue = [];
        void flush(pending);
      }, idleMs);
    });
}
