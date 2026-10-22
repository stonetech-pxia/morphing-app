import Anthropic from '@anthropic-ai/sdk';
import { PlanSchema, prepareOps, type AIProvider, type Registry } from '@morph/core';

import { buildRepairMessage, buildSystemPrompt, buildUserMessage } from './prompt';

// 真实模型的 AIProvider（M3）。只在服务端运行，API key 从不离开服务器。
// 模型以 JSON 文本回复 core 的 Plan 格式；回复一律经过 PlanSchema 与 prepareOps 校验，
// 不合格时带着具体问题请求一次修正（§8：模型输出从不被直接信任）。

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Completion {
  /** 回复中的文字部分。 */
  text: string;
  stopReason: string | null;
  /** 模型返回的完整内容，修正重试时原样追加（保持对话只追加）。 */
  content: unknown;
  model: string;
  usage: Usage;
}

export type Complete = (messages: Anthropic.Beta.BetaMessageParam[]) => Promise<Completion>;

export interface SdkCompleterOptions {
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
  registry: Registry;
}

// 服务端拒答回退（refusal fallback）：Haiku 5.5 不支持，其余当前模型默认开启。
const supportsServerFallback = (model: string) => /^claude-(opus|sonnet|fable)-/.test(model);

export function createSdkCompleter(client: Anthropic, options: SdkCompleterOptions): Complete {
  const system = buildSystemPrompt(options.registry);
  return async (messages) => {
    const response = await client.beta.messages.create({
      model: options.model,
      max_tokens: 16000,
      // 系统提示词稳定不变，标记缓存以降低重复请求的成本。
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
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

export class AIOutputError extends Error {}

export interface ClaudeProviderOptions {
  complete: Complete;
  registry: Registry;
  now: () => Date;
  /** 回复不合格时，带着问题清单再请求的次数。 */
  maxRepairs?: number;
  onCompletion?: (completion: Completion) => void;
}

const refusalMessage = (locale: 'en' | 'zh') =>
  locale === 'zh'
    ? '这个请求无法处理，请换一种说法描述你想怎么修改这个 App。'
    : 'This request can’t be handled. Try describing how you want to change the app.';

/** 从回复文字中取出 JSON（容忍模型偶尔加上的代码块标记）。 */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false; issue: string } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, issue: 'the reply was not a single valid JSON object' };
  }
}

export function createClaudeProvider(options: ClaudeProviderOptions): AIProvider {
  const maxRepairs = options.maxRepairs ?? 1;
  return {
    async plan(input, ctx) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        { role: 'user', content: buildUserMessage(ctx.config, input, ctx.locale) },
      ];
      for (let attempt = 0; ; attempt++) {
        const completion = await options.complete(messages);
        options.onCompletion?.(completion);
        if (completion.stopReason === 'refusal') {
          return {
            kind: 'reject',
            reason: 'unknown',
            message: refusalMessage(ctx.locale),
            examples: [],
          };
        }

        let issues: string[];
        const json = parseJson(completion.text);
        const parsed = json.ok ? PlanSchema.safeParse(json.value) : null;
        if (!json.ok) {
          issues = [json.issue];
        } else if (!parsed!.success) {
          issues = parsed!.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        } else {
          const plan = parsed!.data;
          if (plan.kind !== 'ops') return plan;
          const prepared = prepareOps(ctx.config, plan.ops, {
            registry: options.registry,
            locale: ctx.locale,
            now: options.now(),
          });
          if (prepared.ok) return plan;
          issues = prepared.issues;
          // 修正次数用完时原样返回，由 App 端校验拦截并向用户说明。
          if (attempt >= maxRepairs) return plan;
        }
        if (attempt >= maxRepairs) {
          throw new AIOutputError(`unusable model reply: ${issues.join('; ')}`);
        }
        messages.push(
          {
            role: 'assistant',
            content: completion.content as Anthropic.Beta.BetaContentBlockParam[],
          },
          { role: 'user', content: buildRepairMessage(issues) },
        );
      }
    },
  };
}
