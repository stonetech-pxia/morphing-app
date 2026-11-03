import {
  PlanSchema,
  deferredLookText,
  fixRequest,
  functionFirst,
  homeEntryOps,
  planSession,
  prepareOps,
  splitDraftOnlyOps,
  sessionProblems,
  toolVerdict,
  workKindOfOps,
  workflowsWithoutEntry,
  type AIProvider,
  type FunctionFirst,
  type Op,
  type Plan,
  type PlanAbout,
  type PlanSession,
  type PreparedChange,
  type WorkKind,
  type WorkspaceConfig,
} from '@morph/core';

import { RevisionConflictError } from '../../storage/types';
import type { createDraft } from './draft';
import { focusPage, type Kernel } from './kernel';
import type { createRevisions } from './revisions';
import type { SessionStore } from './session';
import type {
  BuildRun,
  ChangeResult,
  Draft,
  DraftChatReply,
  DraftOrigin,
  DraftStep,
  WaitingForDraft,
  WorkspaceState,
} from './types';

// AI 修改页和草稿聊天框说的一句话（D-191、D-411）：功能类直接保存成一个 AI 版本，外观类进草稿，
// 一个计划两样都有时各走各的（D-419）；每句都带上工具清单（D-414）；「接着改」的预设（next）；大工程先出计划（D-415，步骤的执行在 build.ts）。

export const NEXT_META_KEY = 'next';
export const SUGGEST_META_KEY = 'suggest';

/** 搭建计划的一步（D-415）。 */
export interface StepTurn {
  step: NonNullable<PlanSession['step']>;
  /** 清单里对应的项；不给时按句子找。 */
  itemId?: string;
  /** 模型回来时用户已经点了停止：不应用，当作没发生。 */
  stillWanted: () => boolean;
}

/** 模型回来时用户已经点了停止。 */
export class StepStopped extends Error {}

/** 存着的建议（JSON 数组）；坏了或没有就是空的。 */
export function parseSuggest(stored: string | null): string[] {
  try {
    const v: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function createAIChange(
  k: Kernel,
  {
    restoreProposal,
    rebaseDraft,
    rebaseOpenDraft,
    saveDraft,
  }: Pick<ReturnType<typeof createRevisions>, 'restoreProposal'> &
    Pick<ReturnType<typeof createDraft>, 'rebaseDraft' | 'rebaseOpenDraft' | 'saveDraft'>,
  session: SessionStore,
  showBuild: (run: Pick<BuildRun, 'summary' | 'steps' | 'origin'>) => Promise<void>,
) {
  const { deps, repo, registry, locale, set, get, msg, reload, failedPlan, addedBy } = k;

  /** 新建的快捷操作默认在首页放入口；用户说了不要放、或者是给分享进来的文件做的（D-124），就不放。 */
  function withHomeEntries(
    before: WorkspaceConfig,
    ops: Op[],
    prepared: Extract<PreparedChange, { ok: true }>,
    plan: { homeEntry?: boolean },
    about: PlanAbout | undefined,
  ): { ops: Op[]; prepared: Extract<PreparedChange, { ok: true }> } {
    const wantHome =
      (about?.kind === 'shared' || about?.kind === 'chain'
        ? (plan.homeEntry ?? false)
        : plan.homeEntry) !== false;
    const homeless = wantHome ? workflowsWithoutEntry(ops, prepared.after) : [];
    if (homeless.length === 0) return { ops, prepared };
    const withEntry = [...ops, ...homeEntryOps(prepared.after, homeless)];
    const full = prepareOps(before, withEntry, { registry, locale, now: deps.now(), fromAI: true });
    return full.ok ? { ops: withEntry, prepared: full } : { ops, prepared };
  }

  /** 聊天框里没变成一步的结果记成一条回复（D-207）。 */
  function replyFor(
    input: string,
    result: ChangeResult,
  ): Omit<DraftChatReply, 'afterSteps'> | null {
    switch (result.kind) {
      case 'rejected':
        return {
          input,
          kind: 'rejected',
          message: result.message,
          examples: result.examples,
          ...(result.reason ? { reason: result.reason } : {}),
        };
      case 'invalid':
        return {
          input,
          kind: 'invalid',
          message: `${msg('invalidPlan')} ${result.issues.join('；')}`,
          examples: [],
        };
      case 'applied':
        // 这句话已经生效（D-411）：说清做了什么，剩下的外观（next）可以点一下接着说。
        return {
          input,
          kind: 'functionApplied',
          message: [
            ...result.lines,
            ...(result.applied.notes ?? []),
            ...(result.lookNotDone ? [] : [msg('draftFunctionApplied')]),
          ].join('\n'),
          examples: get().next ? [get().next!] : [],
        };
      case 'steppedBack':
        return { input, kind: 'steppedBack', message: msg('draftSteppedBack'), examples: [] };
      case 'needsDraft':
        return {
          input,
          kind: 'needsDraft',
          message: result.message,
          examples: [],
          waiting: result.waiting,
        };
      default:
        return null;
    }
  }

  async function aiChange(
    input: string,
    planner: AIProvider,
    origin: DraftOrigin,
    inChat: boolean,
    stepTurn?: StepTurn,
    /** 发给模型的句子和记下来的不一样时（「把这些补上」，D-418）。 */
    forModel?: string,
  ): Promise<ChangeResult> {
    const { config, head } = get();
    if (!config || !head) throw new Error('workspace not loaded');
    set({ busy: true });
    try {
      let current = get().draft;
      if (current && !current.open) current = rebaseDraft(current);
      const base = current?.steps.at(-1)?.config ?? config;
      // 草稿里接着说的话沿用开始时的上下文：「这个」还是那个快捷操作（D-124）。
      const about = origin.about ?? current?.origin.about;
      await session.markStart(base);
      // 工具清单一起带上（D-414）：目标、还差什么、最近说过的话，用户不用每次都从头说。
      const planned = planSession(get().session, {
        current: input,
        ...(stepTurn ? { step: stepTurn.step } : {}),
      });
      const raw = await planner.plan(forModel ?? input, {
        config: base,
        registry,
        locale,
        ...(about ? { about } : {}),
        ...(planned ? { session: planned } : {}),
      });
      if (stepTurn && !stepTurn.stillWanted()) throw new StepStopped();
      /** 这一句没做成：记进清单（上一轮的话模型下一句看得到，清单里的那一项标 failed）。 */
      const notDone = (reply: string, reason: string) =>
        session.record(
          {
            input,
            reply,
            done: false,
            reason,
            ...(stepTurn?.itemId ? { itemId: stepTurn.itemId } : {}),
          },
          base,
        );
      const parsed = PlanSchema.safeParse(raw);
      if (!parsed.success) {
        await failedPlan(input, raw, 'plan did not match schema');
        await notDone('the reply was not valid', msg('sessionInvalid'));
        return { kind: 'invalid', issues: parsed.error.issues.map((i) => i.message) };
      }
      const plan = parsed.data;
      if (plan.kind === 'build') {
        // 已经在做计划的一步了：不能再出一份（规划器已经发回去过一次，别的 AI 也可能这样）。
        if (stepTurn) {
          await failedPlan(input, plan, 'a plan inside a step');
          await notDone('a plan inside a step', msg('sessionInvalid'));
          return { kind: 'invalid', issues: [msg('buildFailedInvalid')] };
        }
        // 先给用户看，点「开始」才做（底线 16）。
        await showBuild({
          summary: plan.summary,
          steps: plan.steps.map((step) => ({ ...step, status: 'todo' })),
          origin: { ...origin, ...(about ? { about } : {}) },
        });
        return { kind: 'build' };
      }
      if (plan.kind === 'reject') {
        await notDone(plan.message, plan.message);
        await repo.createChangeRequest({
          input,
          plan,
          status: 'rejected',
          baseRevisionId: head.id,
          error: plan.reason,
        });
        return {
          kind: 'rejected',
          message: plan.message,
          examples: plan.examples,
          reason: plan.reason,
        };
      }
      if (plan.kind === 'restorePrevious') {
        // 计划的一步不能是「撤销」：撤掉的是用户没说要撤的东西。
        if (stepTurn) return { kind: 'invalid', issues: [msg('buildFailedInvalid')] };
        if (current && current.steps.length > 1) {
          set({ draft: current });
          await get().stepBack();
          return { kind: 'steppedBack' };
        }
        if (current || head.parentId === null) {
          const message = msg(current ? 'draftFirstStep' : 'noPrevious');
          await notDone(message, message);
          return { kind: 'rejected', message, examples: [] };
        }
        const result = await restoreProposal(head.parentId, input);
        if (result.kind !== 'preview') return result;
        await get().confirm();
        return { kind: 'restored' };
      }
      const ctx = { registry, locale, now: deps.now(), fromAI: true };
      const prepared = prepareOps(base, plan.ops, ctx);
      if (!prepared.ok) {
        await failedPlan(input, plan.ops, `${prepared.stage}: ${prepared.issues.join('; ')}`);
        await notDone(prepared.issues.join('; '), msg('sessionInvalid'));
        return { kind: 'invalid', issues: prepared.issues };
      }
      // 建议的下一步（D-355）：给了新的就换掉；没给就只去掉刚说的这一句（点了的那条），其余留着。
      await saveSuggest(plan.suggest ?? get().suggest.filter((x) => x !== input));
      // 功能先做（D-191）：直接应用到正式的版本，不进草稿；草稿里只改外观。
      // 草稿聊天框里说的也一样，做完草稿套到新版本上，接着开着（D-411）。
      const first = functionFirst(base, plan.ops, ctx);
      if (first.kind === 'function') {
        return await applyFunction(
          input,
          plan,
          first,
          { ...origin, ...(about ? { about } : {}) },
          inChat,
          stepTurn,
        );
      }
      // 外观：新建或接着改草稿（D-190）。
      const { ops, prepared: after } = withHomeEntries(base, plan.ops, prepared, plan, about);
      const changeRequestId = await repo.createChangeRequest({
        input,
        plan: ops,
        status: 'previewing',
        baseRevisionId: head.id,
      });
      const step: DraftStep = {
        input,
        ops,
        lines: after.lines,
        ...(plan.notes?.length ? { notes: plan.notes } : {}),
        changeRequestId,
        config: after.after,
      };
      const draft: Draft = {
        steps: [...(current?.steps ?? []), step],
        replies: current?.replies ?? [],
        origin: current?.origin ?? origin,
        // 搭建时草稿先不打开（D-415）：做完了用户点「看看外观」再看，中间不要闪来闪去。
        open: !stepTurn,
      };
      set({ draft, editing: null });
      await saveDraft(draft);
      if (input === get().next) await get().clearNext();
      await recordDone({
        input,
        lines: after.lines,
        kind: workKindOfOps(ops),
        before: base,
        after: after.after,
        later: (stepTurn?.step.remaining ?? 0) > 0,
        refs: { cr: changeRequestId },
        stepTurn,
      });
      return { kind: 'drafted', step, focusPageId: focusPage(ops, after.after) };
    } finally {
      set({ busy: false });
    }
  }

  /** 这一句做成了：代码判断相关的工具能不能用（D-414），模型说了不算。 */
  async function recordDone({
    input,
    lines,
    kind,
    before,
    after,
    later,
    refs,
    next,
    stepTurn,
  }: {
    input: string;
    lines: string[];
    kind: WorkKind;
    before: WorkspaceConfig;
    after: WorkspaceConfig;
    later: boolean;
    /** 一个计划两样都有（D-419）：功能的版本号和外观那一步都记下，撤销和退一步都找得到这一句。 */
    refs: { cr: number } | { rev: number } | { cr: number; rev: number };
    next?: string | null;
    stepTurn: StepTurn | undefined;
  }) {
    await session.record(
      {
        input,
        reply: lines.join('; '),
        done: true,
        kind,
        verdict: toolVerdict(before, after, registry, { later }),
        ...(next ? { next } : {}),
        ...(stepTurn?.itemId ? { itemId: stepTurn.itemId } : {}),
        ...refs,
      },
      after,
    );
  }

  /**
   * 外观进草稿（D-419）：先把已有的草稿套到刚生效的版本上，这批外观在上面合法就接成一步（不再问模型）；
   * 不合法返回 null，什么都不加。搭建时草稿先不打开（D-415），做完了用户点「看看外观」再看。
   */
  async function deferredIntoDraft(
    input: string,
    deferred: Op[],
    notes: string[],
    cleanup: readonly Op[],
    origin: DraftOrigin,
    stayInDraft: boolean,
    stepTurn: StepTurn | undefined,
  ): Promise<DraftStep | null> {
    const { draft, head, config } = get();
    const current = draft && rebaseDraft(draft, cleanup);
    const ctx = { registry, locale, now: deps.now(), fromAI: true };
    const prepared = prepareOps(current?.steps.at(-1)?.config ?? config!, deferred, ctx);
    if (!prepared.ok) {
      await failedPlan(input, deferred, `${prepared.stage}: ${prepared.issues.join('; ')}`);
      const kept = current && !stayInDraft && current.open ? { ...current, open: false } : current;
      set({ draft: kept, ...(kept !== current ? { toast: null } : {}) });
      await saveDraft(kept);
      return null;
    }
    const changeRequestId = await repo.createChangeRequest({
      input,
      plan: deferred,
      status: 'previewing',
      baseRevisionId: head!.id,
    });
    const step: DraftStep = {
      input,
      ops: deferred,
      lines: prepared.lines,
      ...(notes.length ? { notes } : {}),
      changeRequestId,
      config: prepared.after,
    };
    const next: Draft = {
      steps: [...(current?.steps ?? []), step],
      replies: current?.replies ?? [],
      origin: current?.origin ?? origin,
      open: !stepTurn,
    };
    set({ draft: next, editing: null });
    await saveDraft(next);
    return step;
  }

  /**
   * 功能类修改直接保存成一个 AI 版本（D-191），顶部照常「已改好 · 撤销」。这句话里剩下的外观直接进草稿
   * （D-419，不再问模型）；套不上时才变成「接着改」的预设，并告诉用户这部分没做。模型给的 next 照旧。
   * 草稿还在：从 AI 修改页说的，草稿先离开，打开时重新套上；从草稿聊天框说的（stayInDraft），马上套上，
   * 草稿接着开着（D-411）。
   */
  async function applyFunction(
    input: string,
    plan: Extract<Plan, { kind: 'ops' }>,
    first: Extract<FunctionFirst, { kind: 'function' }>,
    origin: DraftOrigin,
    stayInDraft: boolean,
    stepTurn?: StepTurn,
  ): Promise<ChangeResult> {
    const { config, head, draft } = get();
    const ctx = { registry, locale, now: deps.now(), fromAI: true };
    const before = draft?.steps.at(-1)?.config ?? config!;
    let wanted = first.ops;
    let cleanup: Op[] = [];
    let prepared = prepareOps(config!, wanted, ctx);
    // 善后的操作改的页面、块只在草稿里（D-413）：正式版本上跳过，草稿套上时再做。
    if (!prepared.ok && draft) {
      const split = splitDraftOnlyOps(config!, wanted, ctx);
      const kept = split ? prepareOps(config!, split.kept, ctx) : null;
      if (split && kept?.ok) {
        wanted = split.kept;
        cleanup = split.skipped;
        prepared = kept;
      }
    }
    if (!prepared.ok) {
      await failedPlan(input, first.ops, `${prepared.stage}: ${prepared.issues.join('; ')}`);
      // 在草稿的样子上说的：要用到草稿里的东西（D-413）。用户点了才应用草稿（底线 7、16）。
      if (draft)
        return {
          kind: 'needsDraft',
          message: msg('functionNeedsDraft'),
          waiting: { input, plan, origin },
        };
      await session.record(
        {
          input,
          reply: prepared.issues.join('; '),
          done: false,
          reason: msg('sessionInvalid'),
          ...(stepTurn?.itemId ? { itemId: stepTurn.itemId } : {}),
        },
        config!,
      );
      return { kind: 'invalid', issues: prepared.issues };
    }
    const { ops, prepared: after } = withHomeEntries(config!, wanted, prepared, plan, origin.about);
    const hasDeferred = first.deferred.length > 0;
    const changeRequestId = await repo.createChangeRequest({
      input,
      plan: ops,
      status: 'previewing',
      baseRevisionId: head!.id,
    });
    const summary = input.slice(0, 200);
    let revisionId: number;
    try {
      const revision = await repo.commitRevision({
        baseId: head!.id,
        config: after.after,
        source: 'ai',
        summary,
      });
      revisionId = revision.id;
      // 上一个还没等到渲染确认就又来一个（搭建的一步接一步、应用草稿并继续）：上一个已经在历史里了，算保存好。
      const waiting = k.render.pending;
      if (waiting)
        await repo.updateChangeRequest(waiting.changeRequestId, {
          status: 'committed',
          resultRevisionId: waiting.revisionId,
        });
      k.render.pending = {
        changeRequestId,
        revisionId: revision.id,
        undoTo: head!.id,
        summary,
        // 搭建时不是每一步都弹「已改好 · 撤销」（D-415）：做完了在计划上说。
        ...(stepTurn ? { quiet: true } : {}),
      };
    } catch (e) {
      if (!(e instanceof RevisionConflictError)) throw e;
      await repo.updateChangeRequest(changeRequestId, { status: 'failed', error: e.message });
      await reload();
      return { kind: 'rejected', message: msg('conflict'), examples: [] };
    }
    if (draft?.open && !stayInDraft && !hasDeferred)
      set({ draft: { ...draft, open: false }, toast: null });
    // 被移除的工具失去文件授权；文件本身保留（§7G）。
    const remaining = new Set(after.after.packages.map((t) => t.id));
    for (const tool of config!.packages) {
      if (!remaining.has(tool.id)) await repo.revokeToolGrants(tool.id);
    }
    await reload();
    // 用户在草稿这一步的回复里看到功能已经生效；AI 的说明也放这里（说的是整句话）。
    const lookStep = hasDeferred
      ? await deferredIntoDraft(
          input,
          first.deferred,
          [...after.lines, msg('draftFunctionApplied'), ...(plan.notes ?? [])],
          cleanup,
          origin,
          stayInDraft,
          stepTurn,
        )
      : null;
    if (!hasDeferred && (stayInDraft || cleanup.length > 0)) await rebaseOpenDraft(cleanup);
    const lookNotDone = hasDeferred && !lookStep;
    const next =
      plan.next ?? (lookNotDone ? deferredLookText(after.after, first.deferred, ctx, input) : null);
    set({ next });
    await repo.setMeta(NEXT_META_KEY, next ?? '');
    const notDoneNote = msg('deferredLookNotDone');
    // 搭建时清单和下一句（next）会接着做，不用多一条提示；聊天框里回复就说了。
    if (lookNotDone && !stepTurn && !stayInDraft) set({ draftNotice: notDoneNote });
    const shown = get().draft?.steps.at(-1)?.config ?? after.after;
    await recordDone({
      input,
      lines: [...after.lines, ...(lookStep?.lines ?? []), ...(lookNotDone ? [notDoneNote] : [])],
      kind: workKindOfOps(ops),
      before,
      after: shown,
      later: Boolean(next) || (stepTurn?.step.remaining ?? 0) > 0,
      refs: lookStep ? { rev: revisionId, cr: lookStep.changeRequestId } : { rev: revisionId },
      next,
      stepTurn,
    });
    if (lookStep)
      return {
        kind: 'drafted',
        step: lookStep,
        focusPageId: focusPage(first.deferred, lookStep.config),
      };
    const applied = addedBy(config!, after.after, origin);
    // 没做成时 AI 的说明不能留：它可能说外观已经好了。
    const notes = lookNotDone ? [notDoneNote] : plan.notes;
    return {
      kind: 'applied',
      lines: after.lines,
      applied: notes?.length ? { ...applied, notes } : applied,
      focusPageId: focusPage(ops, after.after),
      ...(lookNotDone ? { lookNotDone: true } : {}),
    };
  }

  async function saveSuggest(suggest: string[]) {
    const old = get().suggest;
    if (suggest.length === old.length && suggest.every((x, i) => x === old[i])) return;
    set({ suggest });
    await repo.setMeta(SUGGEST_META_KEY, suggest.length ? JSON.stringify(suggest) : '');
  }

  const actions: Pick<
    WorkspaceState,
    'change' | 'draftChange' | 'clearNext' | 'clearSuggest' | 'continueWithDraft' | 'fixProblems'
  > = {
    change: (input, planner = deps.provider, origin = {}) =>
      aiChange(input, planner, origin, false),

    // 用户点一次发一次（底线 16）；没问题或正在做时什么都不发，也不循环。
    async fixProblems() {
      const { session: s, draft, config, next, busy } = get();
      const shown = draft?.steps.at(-1)?.config ?? config;
      if (!shown || busy) return null;
      const left = sessionProblems(s, shown, registry, { later: Boolean(next) });
      if (left.length === 0) return null;
      return aiChange(msg('fixProblems'), deps.provider, {}, false, undefined, fixRequest(left));
    },

    async draftChange(input, about) {
      const result = await aiChange(input, deps.provider, about ? { about } : {}, true);
      const draft = get().draft;
      const reply = draft && replyFor(input, result);
      if (draft && reply) {
        const next = {
          ...draft,
          replies: [...draft.replies, { ...reply, afterSteps: draft.steps.length }],
        };
        set({ draft: next });
        await saveDraft(next);
      }
      return result;
    },

    async clearNext() {
      if (get().next === null) return;
      set({ next: null });
      await repo.setMeta(NEXT_META_KEY, '');
    },

    clearSuggest: () => saveSuggest([]),

    async continueWithDraft({ input, plan, origin }: WaitingForDraft) {
      set({ busy: true });
      try {
        const applied = await get().applyDraft();
        const { config } = get();
        if (!applied || !config) return { kind: 'invalid', issues: [msg('invalidPlan')] };
        const ctx = { registry, locale, now: deps.now(), fromAI: true };
        const first = functionFirst(config, plan.ops, ctx);
        if (first.kind !== 'function') return { kind: 'invalid', issues: [msg('invalidPlan')] };
        return await applyFunction(input, plan, first, origin, false);
      } finally {
        set({ busy: false });
      }
    },
  };
  return { actions, aiChange };
}
