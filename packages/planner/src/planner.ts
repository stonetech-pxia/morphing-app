import {
  t,
  FIXED_BY_A_LATER_STEP,
  PlanSchema,
  checkRequestParams,
  checkTools,
  expandPresetWorkflows,
  issueLines,
  prepareOps,
  redactForAI,
  type AIProvider,
  type Locale,
  type Plan,
  type Registry,
  type ToolIssue,
  type WorkspaceConfig,
} from '@morph/core';

import {
  buildRepairMessage,
  buildToolRepairMessage,
  buildUserMessage,
  systemPromptFor,
  type PromptRoute,
} from './prompt';
import { routeRequest } from './route';

// 规划器：服务端（SDK）和 App 内（HTTP，用户自带 key，Claude 或 OpenAI 兼容接口）共用同一份逻辑。
// 模型以 JSON 文本回复 core 的 Plan 格式；回复一律经过 PlanSchema 与 prepareOps 校验，
// 不合格时带着具体问题请求一次修正（§8：模型输出从不被直接信任）。
// 合格的计划再跑工具检查（AGENT_PLAN §3.6）：这次新增了「工具用不了」的问题，就发回去再要一次。
// 一轮最多 3 次模型调用（第一次、格式修正、工具补救）；这里只算不写，写入在 App 收到结果之后（底线 16）。

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

/** 工具检查的补救次数。 */
const MAX_TOOL_REPAIRS = 1;

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

type OpsPlan = Extract<Plan, { kind: 'ops' }>;

/**
 * 这个计划新增的严重问题：只看比改之前多出来的 blocker，加上用户说的数和词没落到参数上的。
 * 按个数比：同一个地方多了一个（又一个必填字段没人填）也算新增；原来就有的、只是换了说法的不算。
 */
function newToolIssues(
  input: string,
  locale: Locale,
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  plan: OpsPlan,
  registry: Registry,
  /** 这是搭建计划的一步，后面还有步骤：页面可能在后面（和 next 一样，规则 53）。 */
  moreSteps: boolean,
): ToolIssue[] {
  const keyOf = (i: ToolIssue) => `${i.code}|${i.target}`;
  const blockers = (config: WorkspaceConfig) =>
    checkTools(config, registry).issues.filter((i) => i.severity === 'blocker');
  const old = new Map<string, number>();
  for (const i of blockers(before)) old.set(keyOf(i), (old.get(keyOf(i)) ?? 0) + 1);

  const had = (ids: { id: string }[]) => new Set(ids.map((x) => x.id));
  const tablesBefore = had(before.data.tables);
  const pagesBefore = had(before.containers.pages);
  const newTables =
    plan.next || moreSteps ? after.data.tables.filter((t) => !tablesBefore.has(t.id)) : [];
  const later = (i: ToolIssue) => {
    if (newTables.length === 0 || !FIXED_BY_A_LATER_STEP.has(i.code)) return false;
    if (i.target.startsWith('page:')) return !pagesBefore.has(i.target.slice('page:'.length));
    return newTables.some((t) => i.target === `table:${t.id}`);
  };

  const added = blockers(after).filter((i) => {
    const left = old.get(keyOf(i)) ?? 0;
    if (left > 0) old.set(keyOf(i), left - 1);
    return left === 0 && !later(i);
  });
  return [...added, ...checkRequestParams(input, locale, before, after)];
}

/** 补救后还有问题：计划照样返回（只提醒不拒绝，底线 19），在 notes 里用用户的语言说一句。notes 最多 4 条。 */
function withToolNotes(plan: OpsPlan, issues: readonly ToolIssue[], locale: Locale): OpsPlan {
  if (issues.length === 0) return plan;
  const ours = [
    ...(issues.some((i) => i.code.startsWith('param-')) ? [t(locale, 'planCheckParams')] : []),
    ...(issues.some((i) => !i.code.startsWith('param-')) ? [t(locale, 'planCheckTools')] : []),
  ];
  return { ...plan, notes: [...(plan.notes ?? []).slice(0, 4 - ours.length), ...ours] };
}

/**
 * 发回给模型的旧回复只留文字：修正时中间的回复已经换过，思考块和上下文对不上，API 可能拒绝。
 * 模型没有写字时放一个占位：/v1/complete 和 Claude API 都不收空内容。
 */
function replayableReply(completion: Completion): unknown[] {
  const texts = completion.content.flatMap((block) => {
    const { type, text } = block as { type?: unknown; text?: unknown };
    return type === 'text' && typeof text === 'string' && text.length > 0
      ? [{ type: 'text', text }]
      : [];
  });
  return texts.length > 0 ? texts : [{ type: 'text', text: '(no text in the reply)' }];
}

export function createClaudePlanner(options: PlannerOptions): AIProvider {
  const maxRepairs = options.maxRepairs ?? 1;
  return {
    async plan(input, ctx) {
      const first: PlannerMessage = {
        role: 'user',
        content: buildUserMessage(
          redactForAI(ctx.config, ctx.registry),
          input,
          ctx.locale,
          ctx.about,
          ctx.earlier,
          ctx.registry,
          ctx.session,
        ),
      };
      // 永远是 1 条或 3 条（用户、最新回复、最新修正）：服务器 /v1/complete 只收这两种。
      let messages: PlannerMessage[] = [first];
      let route: PromptRoute =
        options.route !== true
          ? 'full'
          : routeRequest({
              input,
              config: ctx.config,
              about: ctx.about,
              earlier: ctx.earlier ?? ctx.session?.recent,
            });
      let repairs = 0;
      let toolRepairs = 0;
      /** 目前最好的合法计划：补救失败（不合法、拒绝、出错）时退回它，不把能用的结果变成失败。 */
      let best: { plan: OpsPlan; issues: ToolIssue[] } | null = null;
      const settle = (b: NonNullable<typeof best>) => withToolNotes(b.plan, b.issues, ctx.locale);
      for (;;) {
        options.onRoute?.(route);
        ctx.onProgress?.(repairs + toolRepairs > 0 ? 'fixing' : route);
        let completion: Completion;
        try {
          completion = await options.complete(messages, systemPromptFor(options.registry, route));
        } catch (e) {
          if (best) return settle(best);
          throw e;
        }
        options.onCompletion?.(completion);
        ctx.onProgress?.('checking');
        if (completion.stopReason === 'refusal') {
          if (best) return settle(best);
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
          issues = issueLines(parsed!.error);
        } else {
          const plan = parsed!.data;
          if (plan.kind === 'build' && ctx.session?.step) {
            // 已经在做计划的一步了，不能再出一份计划（规则 53）。
            if (best) return settle(best);
            if (repairs >= maxRepairs)
              throw new AIOutputError('unusable model reply: a plan inside a step');
            repairs++;
            messages = [
              first,
              { role: 'assistant', content: replayableReply(completion) },
              {
                role: 'user',
                content: buildRepairMessage([
                  'this is one step of a plan the user already started: reply with ops for this step, not another build plan',
                ]),
              },
            ];
            route = 'full';
            continue;
          }
          if (plan.kind !== 'ops') return best ? settle(best) : plan;
          const prepared = prepareOps(ctx.config, plan.ops, {
            registry: options.registry,
            locale: ctx.locale,
            now: options.now(),
            fromAI: true,
          });
          if (prepared.ok) {
            const found = newToolIssues(
              input,
              ctx.locale,
              ctx.config,
              prepared.after,
              plan,
              options.registry,
              (ctx.session?.step?.remaining ?? 0) > 0,
            );
            // 补救后问题没变少就留着之前那个；一样多用新的（模型看过问题了）。
            if (!best || found.length <= best.issues.length) best = { plan, issues: found };
            if (best.issues.length === 0) return best.plan;
            if (toolRepairs >= MAX_TOOL_REPAIRS) return settle(best);
            toolRepairs++;
            messages = [
              first,
              { role: 'assistant', content: replayableReply(completion) },
              {
                role: 'user',
                content: buildToolRepairMessage(found.map((i) => i.message)),
              },
            ];
            route = 'full';
            continue;
          }
          issues = prepared.issues;
          // 修正次数用完时原样返回，由 App 端校验拦截并向用户说明。
          if (!best && repairs >= maxRepairs) return plan;
        }
        if (best) return settle(best);
        if (repairs >= maxRepairs) {
          throw new AIOutputError(`unusable model reply: ${issues.join('; ')}`);
        }
        repairs++;
        messages = [
          first,
          { role: 'assistant', content: replayableReply(completion) },
          { role: 'user', content: buildRepairMessage(issues) },
        ];
        // 修正时用完整的提示词：省掉的部分里可能正好有要改对的写法。
        route = 'full';
      }
    },
  };
}
