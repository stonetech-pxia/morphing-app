import { MAX_OPS_PER_CHANGE, coalesceOps, prepareOps } from '@morph/core';

import type { Kernel } from './kernel';
import type { createRevisions } from './revisions';
import type { WorkspaceState } from './types';

// 直接编辑（D-052–D-054、长按编辑 D-235）：操作先累积在 editing 里，点「完成」时作为一个 user 版本提交。

export function createEditing(
  k: Kernel,
  { opsProposal }: Pick<ReturnType<typeof createRevisions>, 'opsProposal'>,
): Pick<WorkspaceState, 'startEditing' | 'editOps' | 'finishEditing' | 'cancelEditing'> {
  const { deps, registry, locale, set, get } = k;
  return {
    startEditing(pageId, mode = 'page') {
      const { config, editing } = get();
      if (!config || editing?.pageId === pageId) return;
      set({ editing: { pageId, mode, ops: [], config } });
    },

    editOps(ops) {
      const { config, editing } = get();
      if (!config || !editing) throw new Error('not editing');
      const merged = coalesceOps([...editing.ops, ...ops]);
      if (merged.length > MAX_OPS_PER_CHANGE) return { ok: false, full: true };
      const prepared = prepareOps(config, merged, { registry, locale, now: deps.now() });
      if (!prepared.ok) return { ok: false, issues: prepared.issues };
      set({ editing: { ...editing, ops: merged, config: prepared.after } });
      return { ok: true };
    },

    async finishEditing(summary) {
      const { config, editing } = get();
      if (!editing) return { ok: true };
      if (JSON.stringify(editing.config) === JSON.stringify(config)) {
        set({ editing: null });
        return { ok: true };
      }
      const result = await opsProposal(summary, editing.ops, 'user', summary);
      if (result.kind !== 'preview')
        return {
          ok: false,
          issues: result.kind === 'invalid' ? result.issues : [result.message],
        };
      set({ editing: null });
      await get().confirm();
      return { ok: true };
    },

    cancelEditing: () => set({ editing: null }),
  };
}
