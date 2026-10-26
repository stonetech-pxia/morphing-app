import {
  t,
  PlanSchema,
  prepareOps,
  redactForAI,
  type AIProvider,
  type Registry,
} from '@morph/core';

import { buildRepairMessage, buildUserMessage } from './prompt';

// 规划器：服务端（SDK）和 App 内（HTTP，用户自带 key，Claude 或 OpenAI 兼容接口）共用同一份逻辑。
// 模型以 JSON 文本回复 core 的 Plan 格式；回复一律经过 PlanSchema 与 prepareOps 校验，
// 不合格时带着具体问题请求一次修正（§8：模型输出从不被直接信任）。

export interface PlannerMessage {
  role: 'user' | 'assistant';
  /** 字符串，或模型上一轮返回的原始内容块（修正重试时原样追加）。 */
  content: string | unknown[];
}

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
  /** 模型返回的完整内容块。 */
  content: unknown[];
  model: string;
  usage: Usage;
}

/** 一次模型调用。传输方式（SDK、HTTP、测试替身）由调用方提供。 */
export type Complete = (messages: PlannerMessage[]) => Promise<Completion>;

export class AIOutputError extends Error {}

export interface PlannerOptions {
  complete: Complete;
  registry: Registry;
  now: () => Date;
  /** 回复不合格时，带着问题清单再请求的次数。 */
  maxRepairs?: number;
  onCompletion?: (completion: Completion) => void;
}

const refusalMessage = (locale: 'en' | 'zh' | 'fr') =>
  t(locale, 'planner_This_request_can_t_be_handled_Try_desc_04270');

/**
 * 从回复文字中取出 JSON（容忍模型偶尔加上的代码块标记）。
 * 非 Claude 模型常在 JSON 前后加一句话，整段解析失败时再试第一个 { 到最后一个 } 之间的部分。
 */
export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; issue: string } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  for (const candidate of [
    trimmed,
    start >= 0 && end > start ? trimmed.slice(start, end + 1) : null,
  ]) {
    if (candidate === null) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // 试下一个
    }
  }
  return { ok: false, issue: 'the reply was not a single valid JSON object' };
}

export function createClaudePlanner(options: PlannerOptions): AIProvider {
  const maxRepairs = options.maxRepairs ?? 1;
  return {
    async plan(input, ctx) {
      const messages: PlannerMessage[] = [
        {
          role: 'user',
          content: buildUserMessage(
            redactForAI(ctx.config, ctx.registry),
            input,
            ctx.locale,
            ctx.about,
            ctx.earlier,
          ),
        },
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
          { role: 'assistant', content: completion.content },
          { role: 'user', content: buildRepairMessage(issues) },
        );
      }
    },
  };
}
