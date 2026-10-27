import { prepareOps, sampleInfo, sampleOps, type PlanEarlier } from '@morph/core';

import { t } from '../../i18n';
import type { Kernel } from './kernel';
import type { Draft, DraftChatReply, DraftStep, WorkspaceState } from './types';

// AI 修改的草稿（D-190）：存盘、启动或回到草稿时在最新版本上重新套用、退一步、应用（合成一个可撤销的版本）、
// 离开、删除、显示出错时退一步；样板 App 也作为草稿的一步（D-260、D-262）。

const DRAFT_META_KEY = 'draft';

/** 带给 AI 的最近几句（D-207）。 */
const EARLIER_LIMIT = 5;

/** 草稿聊天框里之前说过的话，按说的顺序，最多 EARLIER_LIMIT 句；退一步不算一句。 */
function earlierOf(draft: Draft): PlanEarlier[] {
  const all: PlanEarlier[] = [];
  const said = (after: number) => {
    for (const r of draft.replies) {
      if (r.afterSteps === after && r.kind !== 'steppedBack')
        all.push({ input: r.input, done: false, reply: r.message });
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

export function createDraft(k: Kernel) {
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
   */
  function rebaseDraft(
    draft: Pick<Draft, 'origin' | 'open' | 'replies'> & { steps: Omit<DraftStep, 'config'>[] },
  ): Draft | null {
    const { config } = get();
    if (!config) return null;
    const steps: DraftStep[] = [];
    let base = config;
    for (const step of draft.steps) {
      const prepared = prepareOps(base, step.ops, { registry, locale, now: deps.now() });
      if (!prepared.ok) break;
      base = prepared.after;
      steps.push({ ...step, config: base });
    }
    const dropped = draft.steps.length - steps.length;
    if (dropped > 0) set({ draftNotice: msg('draftDropped', { n: dropped }) });
    for (const step of draft.steps.slice(steps.length)) {
      void repo.updateChangeRequest(step.changeRequestId, {
        status: 'failed',
        error: 'no longer applies',
      });
    }
    if (steps.length === 0) return null;
    return {
      ...draft,
      steps,
      replies: draft.replies.filter((r) => r.afterSteps <= steps.length),
    };
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
      const { draft, head, config } = get();
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
        // 被移除的工具失去文件授权；文件本身保留（§7G）。
        const remaining = new Set(after.tools.map((t) => t.toolId));
        for (const tool of config.tools) {
          if (!remaining.has(tool.toolId)) await repo.revokeToolGrants(tool.toolId);
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
    },

    dismissDraftNotice: () => set({ draftNotice: null }),
  };
  return { actions, saveDraft, rebaseDraft, loadDraft, earlierOf };
}
