import {
  t,
  PlanSchema,
  expandPresetWorkflows,
  prepareOps,
  redactForAI,
  type AIProvider,
  type Registry,
} from '@morph/core';

import { buildRepairMessage, buildUserMessage, systemPromptFor, type PromptRoute } from './prompt';
import { routeRequest } from './route';

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

/**
 * 一次模型调用。传输方式（SDK、HTTP、测试替身）由调用方提供。system 是这次用的系统提示词
 * （按需加载时只含路由挑出的部分）；不给时传输层用完整的提示词。
 */
export type Complete = (messages: PlannerMessage[], system?: string) => Promise<Completion>;

export class AIOutputError extends Error {}

export interface PlannerOptions {
  complete: Complete;
  registry: Registry;
  now: () => Date;
  /** 回复不合格时，带着问题清单再请求的次数。 */
  maxRepairs?: number;
  onCompletion?: (completion: Completion) => void;
  /**
   * 提示词按需加载（route.ts）：默认关（创始人 2026-10-31），每次都发完整的提示词；true 时按路由只发需要的部分。
   * onRoute 报告每次请求用的路由（评测统计用）。
   */
  route?: boolean;
  onRoute?: (route: PromptRoute) => void;
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

function isNeedMore(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'needMore'
  );
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
      let route: PromptRoute =
        options.route !== true
          ? 'full'
          : routeRequest({
              input,
              config: ctx.config,
              about: ctx.about,
              earlier: ctx.earlier,
            });
      for (let attempt = 0; ; attempt++) {
        options.onRoute?.(route);
        const completion = await options.complete(
          messages,
          systemPromptFor(options.registry, route),
        );
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
        // 省掉的部分模型要用（needMore）：换成完整的提示词，同一句再问一次，不算修正次数。
        if (route !== 'full' && json.ok && isNeedMore(json.value)) {
          route = 'full';
          attempt--;
          continue;
        }
        // 预设的简写 addTool {tool: {preset, params?}} 先展开成完整的快捷操作（D-259）。
        const expanded = json.ok ? expandPresetWorkflows(json.value, ctx.config, ctx.locale) : null;
        const parsed =
          expanded && !expanded.issues.length ? PlanSchema.safeParse(expanded.value) : null;
        if (!json.ok) {
          issues = [json.issue];
        } else if (expanded!.issues.length) {
          issues = expanded!.issues;
        } else if (!parsed!.success) {
          issues = parsed!.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        } else {
          const plan = parsed!.data;
          if (plan.kind !== 'ops') return plan;
          const prepared = prepareOps(ctx.config, plan.ops, {
            registry: options.registry,
            locale: ctx.locale,
            now: options.now(),
            fromAI: true,
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
        // 修正时用完整的提示词：省掉的部分里可能正好有要改对的写法。
        route = 'full';
      }
    },
  };
}
