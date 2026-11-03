import { z } from 'zod';

import { t } from '../messages';
import type { Op } from '../ops';
import type { Registry } from '../registry';
import { quickActionsOf, remindersOf, type Locale, type WorkspaceConfig } from '../schema';
import { FIXED_BY_A_LATER_STEP, checkTools, type ToolIssue } from '../tool-check';
import {
  WORK_KINDS,
  type BuildStep,
  type PlanEarlier,
  type PlanSession,
  type WorkKind,
} from './types';

// 工具清单（AGENT_PLAN §3.5、D-414）：本机一个「会话」，随 App 重启保留，取代只有草稿聊天框才有的历史。
// 内容只有用户说的话、计划里的一句话和配置结构，没有记录（底线 1、2、14）；存在 app_meta，不在配置里，AI 改不了（底线 8）。
// 「做了」由代码判定：这轮操作应用成功，且工具检查对相关的表或工具没有 blocker。模型自己说了不算。
// 这里全是纯函数：App 的 store 和实验台 lab.ts 用同一份。

export type SessionItemStatus = 'todo' | 'done' | 'skipped' | 'failed';

export interface SessionItem {
  id: string;
  kind: WorkKind;
  text: string;
  status: SessionItemStatus;
  reason?: string;
  /** 这一项碰到的工具（table:<id>、quickAction:<id>…）：只有结构，后面用来重新判断做好了没有。 */
  targets?: string[];
  /** 还在草稿里时是哪一步（changeRequestId）；生效后换成版本号 rev。撤销、退一步时据此改状态。 */
  cr?: number;
  rev?: number;
}

export interface SessionSaid extends PlanEarlier {
  cr?: number;
  rev?: number;
}

export interface WorkSession {
  goal?: string;
  items: SessionItem[];
  /** 最近说过的话，最早的在前，包括不在草稿里说的（放宽 D-207）。 */
  said: SessionSaid[];
  /** 会话开始时配置已有的问题（code|target）：starter 或旧问题不怪用户，「把这些补上」不算它们（D-418）。 */
  startIssues?: string[];
}

export const SESSION_MAX_ITEMS = 12;
/** 带给 AI 的最近几句。 */
export const SESSION_RECENT = 5;
/** <session> 块的总长上限，超了丢最旧的（prompt.ts 的 describeSession）。 */
export const SESSION_CHAR_LIMIT = 1500;
const TEXT_MAX = 300;
const REPLY_MAX = 160;

const cut = (text: string, max: number) => text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');

const SessionSchema = z.object({
  goal: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(WORK_KINDS),
      text: z.string(),
      status: z.enum(['todo', 'done', 'skipped', 'failed']),
      reason: z.string().optional(),
      targets: z.array(z.string()).optional(),
      cr: z.number().optional(),
      rev: z.number().optional(),
    }),
  ),
  said: z.array(
    z.object({
      input: z.string(),
      done: z.boolean(),
      reply: z.string(),
      cr: z.number().optional(),
      rev: z.number().optional(),
    }),
  ),
  startIssues: z.array(z.string()).optional(),
});

export const emptySession = (): WorkSession => ({ items: [], said: [] });

/** 存着的会话；旧版 App 没有、坏了都当空的（底线 12）。 */
export function parseSession(stored: string | null): WorkSession {
  if (!stored) return emptySession();
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(stored));
    return parsed.success ? (parsed.data as WorkSession) : emptySession();
  } catch {
    return emptySession();
  }
}

export const sessionIsEmpty = (s: WorkSession): boolean =>
  !s.goal && s.items.length === 0 && s.said.length === 0;

/** 还差的：没做的和没做好的。 */
export const openItems = (s: WorkSession): SessionItem[] =>
  s.items.filter((i) => i.status === 'todo' || i.status === 'failed');

/** 超过上限时先丢最旧的已结束的项，还不够再丢最旧的。 */
function trimItems(items: SessionItem[]): SessionItem[] {
  const kept = [...items];
  while (kept.length > SESSION_MAX_ITEMS) {
    const finished = kept.findIndex((i) => i.status === 'done' || i.status === 'skipped');
    kept.splice(finished >= 0 ? finished : 0, 1);
  }
  return kept;
}

function newItemId(items: readonly SessionItem[]): string {
  const used = items.map((i) => parseInt(i.id.slice(1), 10)).filter((n) => !Number.isNaN(n));
  return `i${Math.max(0, ...used) + 1}`;
}

/** 发给模型的样子。current：正在做的这一句，不用再列一遍。 */
export function planSession(
  s: WorkSession,
  options: { current?: string; step?: PlanSession['step'] } = {},
): PlanSession | undefined {
  const open = openItems(s)
    .filter((i) => i.text !== options.current)
    .map((i) => ({
      kind: i.kind,
      text: i.text,
      status: i.status as 'todo' | 'failed',
      ...(i.reason ? { reason: i.reason } : {}),
    }));
  const recent = s.said
    .slice(-SESSION_RECENT)
    .map(({ input, done, reply }) => ({ input, done, reply }));
  if (!s.goal && open.length === 0 && recent.length === 0 && !options.step) return undefined;
  return {
    ...(s.goal ? { goal: s.goal } : {}),
    open,
    recent,
    ...(options.step ? { step: options.step } : {}),
  };
}

/** 从操作看这一句是哪一种工具：文件进记录、文件、记录，其余是外观。 */
export function workKindOfOps(ops: readonly Op[]): WorkKind {
  const quickActions = ops.flatMap((op) =>
    (op.op === 'addTool' || op.op === 'updateTool') &&
    typeof op.tool !== 'string' &&
    op.tool.kind === 'quickAction'
      ? [op.tool]
      : [],
  );
  if (quickActions.some((w) => JSON.stringify(w).includes('addRecord'))) return 'fileToRecord';
  if (quickActions.length > 0 || ops.some((op) => op.op === 'setPackage')) return 'file';
  if (ops.some((op) => ['addData', 'updateData', 'removeData', 'moveData'].includes(op.op)))
    return 'record';
  if (ops.some((op) => op.op === 'addTool' || op.op === 'updateTool')) return 'record';
  return 'look';
}

// ---- 代码判定「做好了」 ----

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 这次改动碰到的工具和页面。 */
function changedTargets(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const diff = <T extends { id: string }>(prefix: string, was: readonly T[], now: readonly T[]) => {
    const old = new Map(was.map((x) => [x.id, x]));
    return now.filter((x) => !same(old.get(x.id), x)).map((x) => `${prefix}:${x.id}`);
  };
  return [
    ...diff('table', before.data.tables, after.data.tables),
    ...diff('quickAction', quickActionsOf(before), quickActionsOf(after)),
    ...diff('reminder', remindersOf(before), remindersOf(after)),
    ...diff('page', before.containers.pages, after.containers.pages),
  ];
}

/** 一个问题属不属于这些工具：块归页面，字段归表。 */
function concerns(issue: ToolIssue, targets: ReadonlySet<string>): boolean {
  if (targets.has(issue.target)) return true;
  const [prefix, rest = ''] = issue.target.split(/:(.*)/s);
  if (prefix === 'block') return targets.has(`page:${rest.split('/')[0]}`);
  if (prefix === 'field') return targets.has(`table:${rest.split('.')[0]}`);
  return false;
}

export interface ToolVerdict {
  targets: string[];
  blockers: ToolIssue[];
}

/**
 * 这轮改完，相关的工具能不能用：比改之前多出来的 blocker，加上碰到的工具上的 blocker。
 * later：后面还有一步（next、计划的下一步）会做页面，新表暂时没有入口是预期的。
 */
export function toolVerdict(
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  registry: Registry,
  options: { later?: boolean } = {},
): ToolVerdict {
  const targets = changedTargets(before, after);
  const blockers = (config: WorkspaceConfig) =>
    checkTools(config, registry).issues.filter((i) => i.severity === 'blocker');
  const keyOf = (i: ToolIssue) => `${i.code}|${i.target}`;
  const old = new Map<string, number>();
  for (const i of blockers(before)) old.set(keyOf(i), (old.get(keyOf(i)) ?? 0) + 1);
  const set = new Set(targets);
  const found = blockers(after).filter((i) => {
    const left = old.get(keyOf(i)) ?? 0;
    if (left > 0) old.set(keyOf(i), left - 1);
    if (left === 0 || concerns(i, set))
      return !(options.later && FIXED_BY_A_LATER_STEP.has(i.code));
    return false;
  });
  // 问题出在没碰到的表上时（页面加了按钮，表没变）也要记下，后面才判断得出补好了没有。
  return { targets: [...new Set([...targets, ...found.map((i) => i.target)])], blockers: found };
}

function nameOf(target: string, config: WorkspaceConfig): string {
  const [prefix, rest = ''] = target.split(/:(.*)/s);
  const id =
    prefix === 'field' ? rest.split('.')[0]! : prefix === 'block' ? rest.split('/')[0]! : rest;
  if (prefix === 'table' || prefix === 'field')
    return config.data.tables.find((x) => x.id === id)?.name ?? id;
  if (prefix === 'quickAction') return quickActionsOf(config).find((x) => x.id === id)?.name ?? id;
  if (prefix === 'reminder') return remindersOf(config).find((x) => x.id === id)?.title ?? id;
  return config.containers.pages.find((x) => x.id === id)?.title ?? id;
}

/** 给用户看的原因（工具检查的 message 是给模型的英文）。 */
export function issueReason(issue: ToolIssue, config: WorkspaceConfig, locale: Locale): string {
  const name = nameOf(issue.target, config);
  if (issue.code.startsWith('add-')) return t(locale, 'sessionWhyAdd', { name });
  if (issue.code.startsWith('view-') || issue.code === 'page-unreachable')
    return t(locale, 'sessionWhyView', { name });
  if (issue.target.startsWith('quickAction:')) return t(locale, 'sessionWhyFile', { name });
  if (issue.code.startsWith('reminder-')) return t(locale, 'sessionWhyReminder', { name });
  return t(locale, 'sessionWhyOther', { name });
}

// ---- 把这些补上（D-418）----

const blockerKey = (i: ToolIssue) => `${i.code}|${i.target}`;
const blockersOf = (config: WorkspaceConfig, registry: Registry) =>
  checkTools(config, registry).issues.filter((i) => i.severity === 'blocker');

/**
 * 记下这个会话的起点。还没开始的会话（空的）每次都重新记；旧版 App 存的会话没有起点，从现在算。
 * 没变就返回原来的对象，不用写存储。
 */
export function markSessionStart(
  s: WorkSession,
  config: WorkspaceConfig,
  registry: Registry,
): WorkSession {
  if (s.startIssues && !sessionIsEmpty(s)) return s;
  const startIssues = blockersOf(config, registry).map(blockerKey);
  return same(s.startIssues, startIssues) ? s : { ...s, startIssues };
}

/**
 * 这个会话新增的问题：起点没有的 blocker，按 code + target 的个数比。会话里没做过什么（没有条目，或者都撤销了）时没有。
 * later：下一句（next）会做页面，新表暂时没有入口是预期的。
 */
export function sessionProblems(
  s: WorkSession,
  config: WorkspaceConfig,
  registry: Registry,
  options: { later?: boolean } = {},
): ToolIssue[] {
  if (!s.startIssues || !s.items.some((i) => i.status !== 'skipped')) return [];
  const old = new Map<string, number>();
  for (const key of s.startIssues) old.set(key, (old.get(key) ?? 0) + 1);
  return blockersOf(config, registry).filter((i) => {
    const left = old.get(blockerKey(i)) ?? 0;
    if (left > 0) {
      old.set(blockerKey(i), left - 1);
      return false;
    }
    return !(options.later && FIXED_BY_A_LATER_STEP.has(i.code));
  });
}

/** 一次请求最多带几条，剩下的用户再点一次。 */
const FIX_REQUEST_MAX = 10;
export const FIX_REQUEST_PREFIX = 'Fix these so the app can be used:';

/** 发给模型的句子（英文，只有配置结构）。用户看到的是自己语言的「把这些补上」。 */
export function fixRequest(issues: readonly ToolIssue[]): string {
  const lines = issues.slice(0, FIX_REQUEST_MAX).map((i) => `- ${i.message}`);
  return [FIX_REQUEST_PREFIX, ...lines].join('\n');
}

// ---- 改会话 ----

export interface SessionTurn {
  input: string;
  /** 模型的一句回复或改了什么；只存配置结构和说明。 */
  reply: string;
  done: boolean;
  /** 这一句做了什么种类；没做时不新加项（拒绝的原因已经告诉用户）。 */
  kind?: WorkKind;
  verdict?: ToolVerdict;
  /** 这一句做的是计划的哪一项。 */
  itemId?: string;
  /** 没做好时给用户看的原因。 */
  reason?: string;
  /** 模型留的下一句（next）：进清单。 */
  next?: string | null;
  cr?: number;
  rev?: number;
}

/** 记下一句：更新对应的项（没有就新加一项，没做的不加），记进最近说过的话。 */
export function recordTurn(s: WorkSession, turn: SessionTurn): WorkSession {
  const failed = (turn.verdict?.blockers.length ?? 0) > 0 || !turn.done;
  const status: SessionItemStatus = failed ? 'failed' : 'done';
  const refs = {
    ...(turn.cr !== undefined ? { cr: turn.cr } : {}),
    ...(turn.rev !== undefined ? { rev: turn.rev } : {}),
  };
  const update = (item: SessionItem): SessionItem => {
    const { reason: _, cr: _c, rev: _r, ...rest } = item;
    return {
      ...rest,
      status,
      ...(failed && turn.reason ? { reason: cut(turn.reason, REPLY_MAX) } : {}),
      ...(turn.verdict ? { targets: turn.verdict.targets } : {}),
      ...refs,
    };
  };
  const index = s.items.findIndex((i) =>
    turn.itemId
      ? i.id === turn.itemId
      : i.text === turn.input && (i.status === 'todo' || i.status === 'failed'),
  );
  let items = s.items;
  if (index >= 0) items = items.map((i, n) => (n === index ? update(i) : i));
  else if (turn.done && turn.kind) {
    items = [
      ...items,
      update({
        id: newItemId(items),
        kind: turn.kind,
        text: cut(turn.input, TEXT_MAX),
        status,
      }),
    ];
  }
  if (turn.next && !items.some((i) => i.text === turn.next && i.status === 'todo')) {
    items = [
      ...items,
      { id: newItemId(items), kind: 'look', text: cut(turn.next, TEXT_MAX), status: 'todo' },
    ];
  }
  return {
    ...s,
    items: trimItems(items),
    said: [
      ...s.said,
      {
        input: cut(turn.input, TEXT_MAX),
        done: turn.done,
        reply: cut(turn.reply, REPLY_MAX),
        ...refs,
      },
    ].slice(-SESSION_RECENT),
  };
}

/** 用户点了「开始」：目标和没做的步骤进清单。 */
export function startBuildItems(
  s: WorkSession,
  summary: string,
  steps: readonly Pick<BuildStep, 'id' | 'kind' | 'request'>[],
): WorkSession {
  const ids = new Set(steps.map((step) => buildItemId(step.id)));
  return {
    ...s,
    goal: summary,
    items: trimItems([
      ...s.items.filter((i) => !ids.has(i.id)),
      ...steps.map((step) => ({
        id: buildItemId(step.id),
        kind: step.kind,
        text: cut(step.request, TEXT_MAX),
        status: 'todo' as const,
      })),
    ]),
  };
}

export const buildItemId = (stepId: string): string => `b-${stepId}`;

export function setItemStatus(
  s: WorkSession,
  id: string,
  status: SessionItemStatus,
  reason?: string,
): WorkSession {
  return {
    ...s,
    items: s.items.map((i) => {
      if (i.id !== id) return i;
      const { reason: _, ...rest } = i;
      return { ...rest, status, ...(reason ? { reason: cut(reason, REPLY_MAX) } : {}) };
    }),
  };
}

/**
 * 重新判断清单：没做好的现在没问题了就算做好（用户又说了一句补上了）。
 * all：做好的也重新看（搭建结束的整体检查，中间放过的「页面在下一步」这时要算了）。
 */
export function recheckItems(
  s: WorkSession,
  config: WorkspaceConfig,
  registry: Registry,
  locale: Locale,
  options: { all?: boolean } = {},
): WorkSession {
  const issues = checkTools(config, registry).issues.filter((i) => i.severity === 'blocker');
  return {
    ...s,
    items: s.items.map((item) => {
      if (!item.targets?.length) return item;
      if (item.status !== 'failed' && !(options.all && item.status === 'done')) return item;
      const set = new Set(item.targets);
      const left = issues.find((i) => concerns(i, set));
      const { reason: _, ...rest } = item;
      return left
        ? {
            ...rest,
            status: 'failed' as const,
            reason: cut(item.reason ?? issueReason(left, config, locale), REPLY_MAX),
          }
        : { ...rest, status: 'done' as const };
    }),
  };
}

/** 草稿应用了：这些步的话和项生效，记下版本号。 */
export function commitDrafted(s: WorkSession, crs: readonly number[], rev: number): WorkSession {
  const set = new Set(crs);
  const move = <T extends { cr?: number; rev?: number }>(x: T): T => {
    if (x.cr === undefined || !set.has(x.cr)) return x;
    const { cr: _, ...rest } = x;
    return { ...rest, rev } as T;
  };
  return { ...s, items: s.items.map(move), said: s.said.map(move) };
}

/** 草稿里的这些步没了（退一步、删除草稿、套不上）：那几句不算说过，项不再算做了。 */
export function dropDrafted(s: WorkSession, crs: readonly number[]): WorkSession {
  const set = new Set(crs);
  const gone = (x: { cr?: number }) => x.cr !== undefined && set.has(x.cr);
  return {
    ...s,
    items: s.items.map((i) => {
      if (!gone(i)) return i;
      const { cr: _, ...rest } = i;
      return { ...rest, status: 'skipped' as const };
    }),
    said: s.said.filter((x) => !gone(x)),
  };
}

/** 撤销、恢复旧版本、换预设之后：这些版本里做的不在配置里了。 */
export function markUndone(s: WorkSession, undone: (rev: number) => boolean): WorkSession {
  const hit = (x: { rev?: number }) => x.rev !== undefined && undone(x.rev);
  return {
    ...s,
    items: s.items.map((i) => {
      if (!hit(i)) return i;
      const { rev: _, ...rest } = i;
      return { ...rest, status: 'skipped' as const };
    }),
    said: s.said.map((x) => {
      if (!hit(x)) return x;
      const { rev: _, ...rest } = x;
      return { ...rest, done: false, reply: 'undone by the user' };
    }),
  };
}
