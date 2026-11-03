import {
  commitDrafted,
  dropDrafted,
  emptySession,
  issueReason,
  markSessionStart,
  markUndone,
  parseSession,
  recheckItems,
  recordTurn,
  t,
  type SessionTurn,
  type ToolVerdict,
  type WorkSession,
  type WorkspaceConfig,
} from '@morph/core';

import type { Kernel } from './kernel';
import type { WorkspaceState } from './types';

// 工具清单（D-414）：本机一个会话，存在 app_meta，随 App 重启保留。不在配置里，AI 改不了（底线 8）；
// 只有用户说的话、计划里的一句话和配置结构，没有记录（底线 1、2、14）。规则都在 core 的 ai/session.ts。

const SESSION_META_KEY = 'session';

export function createSession(k: Kernel) {
  const { repo, registry, locale, set, get } = k;

  async function update(change: (s: WorkSession) => WorkSession) {
    const next = change(get().session);
    set({ session: next });
    await repo.setMeta(SESSION_META_KEY, JSON.stringify(next));
  }

  /** 记下一句，再看看之前没做好的现在好了没有。config：改完之后用户看到的样子。 */
  async function record(
    turn: Omit<SessionTurn, 'reason'> & { reason?: string; verdict?: ToolVerdict },
    config: WorkspaceConfig,
  ) {
    const first = turn.verdict?.blockers[0];
    const reason = turn.reason ?? (first ? issueReason(first, config, locale) : undefined);
    // 「把这些补上」不成一项（D-418）：还差什么按钮自己算，这句话填回输入框也不带问题清单。
    const { kind, ...rest } = turn;
    const said = turn.input === t(locale, 'fixProblems') ? rest : turn;
    await update((s) =>
      recheckItems(
        recordTurn(s, { ...said, ...(reason ? { reason } : {}) }),
        config,
        registry,
        locale,
      ),
    );
  }

  /** 旧版 App 没有会话：有草稿时把草稿聊天框里说过的话接过来（earlier），其余是空的（底线 12）。 */
  async function load(earlier: WorkSession['said']) {
    const stored = await repo.getMeta(SESSION_META_KEY);
    set({ session: stored ? parseSession(stored) : { ...emptySession(), said: earlier } });
  }

  /** 第一句之前记下起点（D-418）：这时已有的问题不算这个会话的。 */
  async function markStart(config: WorkspaceConfig) {
    const old = get().session;
    if (markSessionStart(old, config, registry) !== old)
      await update((s) => markSessionStart(s, config, registry));
  }

  const actions: Pick<WorkspaceState, 'clearSession'> = {
    clearSession: () => update(emptySession),
  };

  return {
    actions,
    update,
    record,
    load,
    markStart,
    commitDrafted: (crs: readonly number[], rev: number) =>
      update((s) => commitDrafted(s, crs, rev)),
    dropDrafted: (crs: readonly number[]) => update((s) => dropDrafted(s, crs)),
    markUndone: (undone: (rev: number) => boolean) => update((s) => markUndone(s, undone)),
  };
}

export type SessionStore = ReturnType<typeof createSession>;
