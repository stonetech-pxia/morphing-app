import {
  PlanSchema,
  functionFirst,
  homeEntryOps,
  prepareOps,
  workflowsWithoutEntry,
  type AIProvider,
  type FunctionFirst,
  type Op,
  type Plan,
  type PlanAbout,
  type PreparedChange,
  type WorkspaceConfig,
} from '@morph/core';

import { t } from '../../i18n';
import { RevisionConflictError } from '../../storage/types';
import type { createDraft } from './draft';
import { focusPage, type Kernel } from './kernel';
import type { createRevisions } from './revisions';
import type {
  ChangeResult,
  Draft,
  DraftChatReply,
  DraftOrigin,
  DraftStep,
  WorkspaceState,
} from './types';

// AI 修改页和草稿聊天框说的一句话（D-191）：功能类直接保存成一个 AI 版本，外观类进草稿；
// 草稿聊天框带上之前说过的话（D-207）；「接着改」的预设（next）。

export const NEXT_META_KEY = 'next';

export function createAIChange(
  k: Kernel,
  {
    restoreProposal,
    rebaseDraft,
    saveDraft,
    earlierOf,
  }: Pick<ReturnType<typeof createRevisions>, 'restoreProposal'> &
    Pick<ReturnType<typeof createDraft>, 'rebaseDraft' | 'saveDraft' | 'earlierOf'>,
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
    const full = prepareOps(before, withEntry, { registry, locale, now: deps.now() });
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
      case 'functionInDraft':
        return { input, kind: 'functionInDraft', message: result.message, examples: [] };
      case 'steppedBack':
        return { input, kind: 'steppedBack', message: msg('draftSteppedBack'), examples: [] };
      default:
        return null;
    }
  }

  async function aiChange(
    input: string,
    planner: AIProvider,
    origin: DraftOrigin,
    inChat: boolean,
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
      // 草稿聊天框里接着说：之前说过的话一起带上，用户不用每次都从头说（D-207）。
      const earlier = inChat && current ? earlierOf(current) : [];
      const raw = await planner.plan(input, {
        config: base,
        registry,
        locale,
        ...(about ? { about } : {}),
        ...(earlier.length ? { earlier } : {}),
      });
      const parsed = PlanSchema.safeParse(raw);
      if (!parsed.success) {
        await failedPlan(input, raw, 'plan did not match schema');
        return { kind: 'invalid', issues: parsed.error.issues.map((i) => i.message) };
      }
      const plan = parsed.data;
      if (plan.kind === 'reject') {
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
        if (current && current.steps.length > 1) {
          set({ draft: current });
          await get().stepBack();
          return { kind: 'steppedBack' };
        }
        if (current) return { kind: 'rejected', message: msg('draftFirstStep'), examples: [] };
        if (head.parentId === null)
          return { kind: 'rejected', message: msg('noPrevious'), examples: [] };
        const result = await restoreProposal(head.parentId, input);
        if (result.kind !== 'preview') return result;
        await get().confirm();
        return { kind: 'restored' };
      }
      const ctx = { registry, locale, now: deps.now() };
      const prepared = prepareOps(base, plan.ops, ctx);
      if (!prepared.ok) {
        await failedPlan(input, plan.ops, `${prepared.stage}: ${prepared.issues.join('; ')}`);
        return { kind: 'invalid', issues: prepared.issues };
      }
      // 功能先做（D-191）：直接应用到正式的版本，不进草稿；草稿里只改外观。
      const first = functionFirst(base, plan.ops, ctx);
      if (first.kind === 'function') {
        if (inChat) {
          await repo.createChangeRequest({
            input,
            plan: plan.ops,
            status: 'rejected',
            baseRevisionId: head.id,
            error: 'function change in a draft',
          });
          return { kind: 'functionInDraft', message: msg('draftNoFunction') };
        }
        return await applyFunction(input, plan, first, {
          ...origin,
          ...(about ? { about } : {}),
        });
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
        open: true,
      };
      set({ draft, editing: null });
      await saveDraft(draft);
      if (input === get().next) await get().clearNext();
      return { kind: 'drafted', step, focusPageId: focusPage(ops, after.after) };
    } finally {
      set({ busy: false });
    }
  }

  /**
   * 功能类修改直接保存成一个 AI 版本（D-191），顶部照常「已改好 · 撤销」。这句话里剩下的外观
   * 变成「接着改」的预设：模型给的 next，没给就用那些外观操作的说明。草稿还在，打开时重新套上。
   */
  async function applyFunction(
    input: string,
    plan: Extract<Plan, { kind: 'ops' }>,
    first: Extract<FunctionFirst, { kind: 'function' }>,
    origin: DraftOrigin,
  ): Promise<ChangeResult> {
    const { config, head, draft } = get();
    const ctx = { registry, locale, now: deps.now() };
    const prepared = prepareOps(config!, first.ops, ctx);
    if (!prepared.ok) {
      await failedPlan(input, first.ops, `${prepared.stage}: ${prepared.issues.join('; ')}`);
      // 在草稿的样子上说的：要用到草稿里的东西。
      return draft
        ? { kind: 'rejected', message: msg('functionNeedsDraft'), examples: [] }
        : { kind: 'invalid', issues: prepared.issues };
    }
    const { ops, prepared: after } = withHomeEntries(
      config!,
      first.ops,
      prepared,
      plan,
      origin.about,
    );
    const deferred =
      first.deferred.length > 0 ? prepareOps(after.after, first.deferred, ctx) : null;
    const next =
      plan.next ??
      (deferred?.ok && deferred.lines.length > 0
        ? deferred.lines.join(t(locale, 'separatorSemicolon')).slice(0, 200)
        : null);
    const changeRequestId = await repo.createChangeRequest({
      input,
      plan: ops,
      status: 'previewing',
      baseRevisionId: head!.id,
    });
    const summary = input.slice(0, 200);
    try {
      const revision = await repo.commitRevision({
        baseId: head!.id,
        config: after.after,
        source: 'ai',
        summary,
      });
      k.render.pending = { changeRequestId, revisionId: revision.id, undoTo: head!.id, summary };
    } catch (e) {
      if (!(e instanceof RevisionConflictError)) throw e;
      await repo.updateChangeRequest(changeRequestId, { status: 'failed', error: e.message });
      await reload();
      return { kind: 'rejected', message: msg('conflict'), examples: [] };
    }
    set({ next, ...(draft?.open ? { draft: { ...draft, open: false }, toast: null } : {}) });
    await repo.setMeta(NEXT_META_KEY, next ?? '');
    // 被移除的工具失去文件授权；文件本身保留（§7G）。
    const remaining = new Set(after.after.tools.map((t) => t.toolId));
    for (const tool of config!.tools) {
      if (!remaining.has(tool.toolId)) await repo.revokeToolGrants(tool.toolId);
    }
    await reload();
    const applied = addedBy(config!, after.after, origin);
    return {
      kind: 'applied',
      applied: plan.notes?.length ? { ...applied, notes: plan.notes } : applied,
      focusPageId: focusPage(ops, after.after),
    };
  }

  const actions: Pick<WorkspaceState, 'change' | 'draftChange' | 'clearNext'> = {
    change: (input, planner = deps.provider, origin = {}) =>
      aiChange(input, planner, origin, false),

    async draftChange(input) {
      const result = await aiChange(input, deps.provider, {}, true);
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
  };
  return { actions };
}
