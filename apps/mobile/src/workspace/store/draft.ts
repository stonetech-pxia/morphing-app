import {
  applicableOps,
  applyOps,
  prepareOps,
  sampleInfo,
  sampleOps,
  type Op,
  type PlanEarlier,
} from '@morph/core';

import { t } from '../../i18n';
import type { Kernel } from './kernel';
import type { SessionStore } from './session';
import type { Draft, DraftChatReply, DraftStep, WorkspaceState } from './types';

// AI 修改的草稿（D-190）：存盘、启动或回到草稿时在最新版本上重新套用、退一步、应用（合成一个可撤销的版本）、
// 离开、删除、显示出错时退一步；样板 App 也作为草稿的一步（D-260、D-262）。

const DRAFT_META_KEY = 'draft';

/** 带给 AI 的最近几句（D-207）。 */
const EARLIER_LIMIT = 5;

/**
 * 草稿聊天框里之前说过的话，按说的顺序，最多 EARLIER_LIMIT 句；退一步不算一句。
 * 现在说过的话都在工具清单里（D-414）：这里只给旧版 App 留下的草稿接到清单上用。
 */
function earlierOf(draft: Draft): PlanEarlier[] {
  const all: PlanEarlier[] = [];
  const said = (after: number) => {
    for (const r of draft.replies) {
      if (r.afterSteps === after && r.kind !== 'steppedBack')
        all.push({ input: r.input, done: r.kind === 'functionApplied', reply: r.message });
    }
  };
  said(0);
  draft.steps.forEach((step, i) => {
    all.push({ input: step.input, done: true, reply: step.lines.join('; ') });
    said(i + 1);
  });
  return all.slice(-EARLIER_LIMIT);
}

/** 草稿只留前几步时，排在去掉的那些步后面的回复也去掉。 */
function keepSteps(draft: Draft, steps: DraftStep[]): Draft {
  return {
    ...draft,
    steps,
    replies: draft.replies.filter((r) => r.afterSteps <= steps.length),
  };
}

export function createDraft(k: Kernel, session: SessionStore) {
  const { deps, repo, registry, locale, set, get, msg, reload, failedPlan, addedBy } = k;

  async function saveDraft(draft: Draft | null) {
    const stored = draft && {
      origin: draft.origin,
      steps: draft.steps.map(({ config: _, ...step }) => step),
      replies: draft.replies,
    };
    await repo.setMeta(DRAFT_META_KEY, stored ? JSON.stringify(stored) : '');
  }

  /**
   * 把草稿的每一步重新套在最新版本上（离开草稿期间可能撤销过、添加过工具）。
   * 套不上的那一步和后面的都去掉，并提示用户。
   * cleanup：这次功能修改的善后操作里，正式版本上跳过的那些（D-413）：改的块只在草稿里，这里跟着套上，
   * 写进那一步的操作里，以后重新套用不用再算（配置自洽，底线 18）。
   */
  function rebaseDraft(
    draft: Pick<Draft, 'origin' | 'open' | 'replies'> & { steps: Omit<DraftStep, 'config'>[] },
    cleanup: readonly Op[] = [],
  ): Draft | null {
    const { config } = get();
    if (!config) return null;
    const ctx = { registry, locale, now: deps.now() };
    const steps: DraftStep[] = [];
    let base = config;
    let left = [...cleanup];
    /** 这一步本身套不上（加的块读到了刚删的字段）：连同还套得上的善后操作一起算。 */
    const withCleanup = (ops: readonly Op[]) => {
      const applied = applyOps(base, ops, ctx);
      if (!applied.ok) return null;
      const usable = applicableOps(applied.config, left, ctx);
      if (usable.length === 0) return null;
      const all = [...ops, ...usable];
      const prepared = prepareOps(base, all, ctx);
      return prepared.ok ? { all, after: prepared.after, usable } : null;
    };
    for (const step of draft.steps) {
      const prepared = prepareOps(base, step.ops, ctx);
      if (prepared.ok) {
        base = prepared.after;
        steps.push({ ...step, config: base });
        continue;
      }
      const fixed = withCleanup(step.ops);
      if (!fixed) break;
      left = left.filter((op) => !fixed.usable.includes(op));
      base = fixed.after;
      steps.push({ ...step, ops: fixed.all, config: base });
    }
    const dropped = draft.steps.length - steps.length;
    // 每一步都套得上时，剩下的善后操作放在最后一步里做（模型要清理的不一定校验得出来）。
    const last = steps.at(-1);
    if (dropped === 0 && last && left.length > 0) {
      const usable = applicableOps(last.config, left, ctx);
      const prepared = usable.length > 0 ? prepareOps(last.config, usable, ctx) : null;
      if (prepared?.ok)
        steps[steps.length - 1] = {
          ...last,
          ops: [...last.ops, ...usable],
          config: prepared.after,
        };
    }
    if (dropped > 0) set({ draftNotice: msg('draftDropped', { n: dropped }) });
    const gone = draft.steps.slice(steps.length);
    for (const step of gone) {
      void repo.updateChangeRequest(step.changeRequestId, {
        status: 'failed',
        error: 'no longer applies',
      });
    }
    if (gone.length > 0) void session.dropDrafted(gone.map((step) => step.changeRequestId));
    if (steps.length === 0) return null;
    return {
      ...draft,
      steps,
      replies: draft.replies.filter((r) => r.afterSteps <= steps.length),
    };
  }

  /**
   * 正式版本变了（功能直接生效、撤销，D-411）：开着的草稿马上套到新版本上。不套的话，应用草稿会用
   * 旧的配置盖掉这次变化。一步都套不上时草稿就没了（rebaseDraft 已经提示）。
   * 带善后操作时（D-413）离开了的草稿也马上套，这些操作不存盘，等不到下次打开。
   */
  async function rebaseOpenDraft(cleanup: readonly Op[] = []) {
    const draft = get().draft;
    if (!draft || (!draft.open && cleanup.length === 0)) return;
    const rebased = rebaseDraft(draft, cleanup);
    set({ draft: rebased });
    await saveDraft(rebased);
  }

  async function loadDraft() {
    const raw = await repo.getMeta(DRAFT_META_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as Pick<Draft, 'origin'> & {
        steps: Omit<DraftStep, 'config'>[];
        /** D-207 之前存的草稿没有。 */
        replies?: DraftChatReply[];
      };
      const draft = rebaseDraft({ ...stored, replies: stored.replies ?? [], open: false });
      set({ draft });
      if (!draft || draft.steps.length !== stored.steps.length) await saveDraft(draft);
    } catch {
      await saveDraft(null);
    }
  }

  const actions: Pick<
    WorkspaceState,
    | 'stepBack'
    | 'openDraft'
    | 'closeDraft'
    | 'draftSample'
    | 'applyDraft'
    | 'deleteDraft'
    | 'draftRenderFailed'
    | 'dismissDraftNotice'
  > = {
    async stepBack() {
      const draft = get().draft;
      if (!draft || draft.steps.length < 2) return;
      const removed = draft.steps.at(-1)!;
      const next = keepSteps(draft, draft.steps.slice(0, -1));
      set({ draft: next });
      await saveDraft(next);
      await repo.updateChangeRequest(removed.changeRequestId, { status: 'cancelled' });
      await session.dropDrafted([removed.changeRequestId]);
    },

    openDraft() {
      const draft = get().draft;
      if (!draft || draft.open) return;
      const rebased = rebaseDraft({ ...draft, open: true });
      set({ draft: rebased, editing: null });
      if (!rebased || rebased.steps.length !== draft.steps.length) void saveDraft(rebased);
    },

    closeDraft() {
      const draft = get().draft;
      // 草稿里唯一的提示是「应用之后才能用」，离开时一起收掉。
      if (draft?.open) set({ draft: { ...draft, open: false }, toast: null });
    },

    async draftSample(sample) {
      const { config, head } = get();
      if (!config || !head) throw new Error('workspace not loaded');
      let current = get().draft;
      if (current && !current.open) current = rebaseDraft(current);
      const base = current?.steps.at(-1)?.config ?? config;
      const result = sampleOps(sample, base, locale);
      if (!result.ok) return { kind: 'rejected', message: result.message, examples: [] };
      const input = msg('sampleDraftInput', { name: sampleInfo(sample, locale).name });
      const prepared = prepareOps(base, result.ops, { registry, locale, now: deps.now() });
      if (!prepared.ok) {
        await failedPlan(input, result.ops, `${prepared.stage}: ${prepared.issues.join('; ')}`);
        return { kind: 'invalid', issues: prepared.issues };
      }
      const changeRequestId = await repo.createChangeRequest({
        input,
        plan: result.ops,
        status: 'previewing',
        baseRevisionId: head.id,
      });
      const step: DraftStep = {
        input,
        ops: result.ops,
        lines: prepared.lines,
        changeRequestId,
        config: prepared.after,
      };
      const draft: Draft = {
        steps: [...(current?.steps ?? []), step],
        replies: current?.replies ?? [],
        origin: { ...current?.origin, sample: { id: sample, pageId: result.mainPageId } },
        open: true,
      };
      set({ draft, editing: null });
      await saveDraft(draft);
      return { kind: 'drafted', step, focusPageId: result.mainPageId };
    },

    async applyDraft() {
      const { head, config } = get();
      let { draft } = get();
      // 离开了的草稿先套到最新版本上，不然会盖掉这期间的变化（「应用草稿并继续」从 AI 修改页来，D-413）。
      if (draft && !draft.open) {
        draft = rebaseDraft(draft);
        set({ draft });
        if (!draft) await saveDraft(null);
      }
      if (!draft || !head || !config) return null;
      const after = draft.steps.at(-1)!.config;
      set({ busy: true });
      try {
        const summary = draft.steps
          .map((s) => s.input)
          .join(t(locale, 'separatorSemicolon'))
          .slice(0, 200);
        const revision = await repo.commitRevision({
          baseId: head.id,
          config: after,
          source: 'ai',
          summary,
        });
        const last = draft.steps.at(-1)!;
        for (const step of draft.steps.slice(0, -1)) {
          await repo.updateChangeRequest(step.changeRequestId, {
            status: 'committed',
            resultRevisionId: revision.id,
          });
        }
        k.render.pending = {
          changeRequestId: last.changeRequestId,
          revisionId: revision.id,
          undoTo: head.id,
          summary,
        };
        set({ draft: null, toast: null });
        await saveDraft(null);
        await session.commitDrafted(
          draft.steps.map((step) => step.changeRequestId),
          revision.id,
        );
        // 被移除的工具失去文件授权；文件本身保留（§7G）。
        const remaining = new Set(after.packages.map((t) => t.id));
        for (const tool of config.packages) {
          if (!remaining.has(tool.id)) await repo.revokeToolGrants(tool.id);
        }
        await reload();
        return addedBy(config, after, draft.origin);
      } finally {
        set({ busy: false });
      }
    },

    async deleteDraft() {
      const draft = get().draft;
      if (!draft) return;
      set({ draft: null });
      await saveDraft(null);
      for (const step of draft.steps) {
        await repo.updateChangeRequest(step.changeRequestId, { status: 'cancelled' });
      }
      await session.dropDrafted(draft.steps.map((step) => step.changeRequestId));
    },

    async draftRenderFailed(error) {
      const draft = get().draft;
      if (!draft) return;
      const last = draft.steps.at(-1)!;
      await repo.updateChangeRequest(last.changeRequestId, {
        status: 'rolled_back',
        error: String(error).slice(0, 300),
      });
      const next = draft.steps.length > 1 ? keepSteps(draft, draft.steps.slice(0, -1)) : null;
      set({ draft: next, draftNotice: msg('draftRenderFailed') });
      await saveDraft(next);
      await session.dropDrafted([last.changeRequestId]);
    },

    dismissDraftNotice: () => set({ draftNotice: null }),
  };
  return { actions, saveDraft, rebaseDraft, rebaseOpenDraft, loadDraft, earlierOf };
}
