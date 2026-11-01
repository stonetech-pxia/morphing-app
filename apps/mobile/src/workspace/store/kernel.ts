import {
  addedToHomeScreen,
  allComponents,
  isKnownComponent,
  prepareSnapshot,
  quickActionsOf,
  type Locale,
  type Op,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import type { StoreApi } from 'zustand/vanilla';

import { t } from '../../i18n';
import type { RevisionSource, WorkspaceRepo } from '../../storage/types';
import type { Applied, DraftOrigin, WorkspaceDeps, WorkspaceState } from './types';

// 各部分共用的东西：依赖、set / get、文案、重新读取 head、等待「渲染成功」确认的提交。

/** 等待“渲染成功”确认的提交。 */
export interface PendingCommit {
  changeRequestId: number;
  revisionId: number;
  undoTo: number;
  summary: string;
  quiet?: boolean;
}

export interface Kernel {
  deps: WorkspaceDeps;
  repo: WorkspaceRepo;
  registry: Registry;
  locale: Locale;
  set: StoreApi<WorkspaceState>['setState'];
  get: StoreApi<WorkspaceState>['getState'];
  msg: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => string;
  /** 渲染确认用的状态（每个 store 一份，不进 zustand 状态）。 */
  render: {
    /** 最近一次成功渲染的配置；渲染失败时回退到它。 */
    lastRendered: WorkspaceConfig | null;
    pending: PendingCommit | null;
    /** 连续回退次数；回退后仍无法渲染时停止，避免循环。 */
    consecutiveRollbacks: number;
  };
  reload(): Promise<void>;
  commitFallback(config: WorkspaceConfig, source: RevisionSource, summary: string): Promise<void>;
  failedPlan(input: string, plan: unknown, error: string): Promise<void>;
  addedBy(before: WorkspaceConfig, after: WorkspaceConfig, origin: DraftOrigin): Applied;
}

export function focusPage(ops: readonly Op[], config: WorkspaceConfig): string {
  for (const op of ops) {
    if ('page' in op && typeof op.page === 'string') return op.page;
    if ('page' in op && op.page && typeof op.page === 'object') return op.page.id;
    if ('tool' in op) {
      const id = typeof op.tool === 'string' ? op.tool : op.tool.id;
      const owner = config.containers.pages.find((p) =>
        allComponents(p).some(
          (c) =>
            isKnownComponent(c) &&
            c.look === 'action' &&
            c.tools.some((u) => 'tool' in u && u.tool === id),
        ),
      );
      if (owner) return owner.id;
    }
  }
  return 'home';
}

export function createKernel(deps: WorkspaceDeps, set: Kernel['set'], get: Kernel['get']): Kernel {
  const { repo, registry, locale } = deps;
  const msg = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    t(locale, key, vars);

  /** 从数据库重新读取 head（§4：持久化后重新读取再渲染）。 */
  async function reload(): Promise<void> {
    const head = await repo.getHead();
    if (!head) throw new Error('workspace has no head revision');
    const prepared = prepareSnapshot(head.config, registry);
    if (!prepared.ok)
      throw new Error(`head revision ${head.id} is invalid: ${prepared.issues.join('; ')}`);
    set({ config: prepared.after, head, status: 'ready', error: null });
  }

  /** 以当前 head 为基础，提交一份已知可用的配置（回退、修复）。 */
  async function commitFallback(config: WorkspaceConfig, source: RevisionSource, summary: string) {
    const head = await repo.getHead();
    await repo.commitRevision({ baseId: head?.id ?? null, config, source, summary });
    await reload();
  }

  async function failedPlan(input: string, plan: unknown, error: string) {
    const head = get().head!;
    await repo.createChangeRequest({
      input,
      plan,
      status: 'failed',
      baseRevisionId: head.id,
      error,
    });
  }

  function addedBy(before: WorkspaceConfig, after: WorkspaceConfig, origin: DraftOrigin): Applied {
    const workflows = new Set(quickActionsOf(before).map((w) => w.id));
    const collections = new Set(before.data.tables.map((c) => c.id));
    return {
      addedWorkflowIds: quickActionsOf(after)
        .filter((w) => !workflows.has(w.id))
        .map((w) => w.id),
      addedCollectionIds: after.data.tables.filter((c) => !collections.has(c.id)).map((c) => c.id),
      homeScreenWorkflowIds: addedToHomeScreen(before, after),
      origin,
    };
  }

  return {
    deps,
    repo,
    registry,
    locale,
    set,
    get,
    msg,
    render: { lastRendered: null, pending: null, consecutiveRollbacks: 0 },
    reload,
    commitFallback,
    failedPlan,
    addedBy,
  };
}
