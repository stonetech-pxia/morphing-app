import {
  PlanSchema,
  RECORD_LIMITS,
  createDefaultWorkspace,
  describeRestore,
  prepareOps,
  prepareSnapshot,
  type AIProvider,
  type Locale,
  type NavTarget,
  type Op,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { t } from '../i18n';
import {
  RevisionConflictError,
  type RevisionRecord,
  type RevisionSource,
  type WorkspaceRepo,
} from '../storage/types';

// 修改协议的 App 端编排（§7D）：
// 用户请求 → 计划 → 校验 → 预览 → 确认 → 原子保存 → 重新读取并渲染 → 渲染成功才算成功，失败自动回退。

export interface WorkspaceDeps {
  repo: WorkspaceRepo;
  provider: AIProvider;
  registry: Registry;
  locale: Locale;
  now: () => Date;
}

export interface Proposal {
  changeRequestId: number;
  kind: 'ops' | 'restore';
  baseRevisionId: number;
  before: WorkspaceConfig;
  after: WorkspaceConfig;
  lines: string[];
  source: RevisionSource;
  summary: string;
  /** 预览时展示的页面。 */
  focusPageId: string;
}

export type ProposeResult =
  | { kind: 'preview'; proposal: Proposal }
  | { kind: 'rejected'; message: string; examples: string[] }
  | { kind: 'invalid'; issues: string[] };

export interface Banner {
  kind: 'applied' | 'rolledBack' | 'recovered' | 'conflict';
  message: string;
  /** 撤销时恢复到的版本。 */
  undoTo?: number;
}

export interface WorkspaceState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  config: WorkspaceConfig | null;
  head: RevisionRecord | null;
  proposal: Proposal | null;
  banner: Banner | null;
  busy: boolean;
  /** 文件列表的刷新信号：工作流保存文件后递增。 */
  assetsVersion: number;
  /** 外壳当前显示的导航项；版本变化时外壳会重新挂载，所以保存在这里。 */
  tab: NavTarget | null;
  /** 记录的刷新信号：增删改记录后递增。 */
  recordsVersion: number;
  /** 记录操作后的提示（例如删除后可以撤销）。与版本提示条分开：记录不属于任何版本。 */
  toast: { message: string; restoreRecordId?: string } | null;
  /** 正在「调整顺序」的页面（直接编辑，D-052）；每次修改都会重新挂载外壳，所以保存在这里。 */
  arranging: string | null;

  boot(): Promise<void>;
  propose(input: string): Promise<ProposeResult>;
  proposeRestore(revisionId: number): Promise<ProposeResult>;
  /** 来自界面按钮（安装、卸载等）的修改，同样经过校验和版本记录。 */
  proposeOps(ops: Op[], summary: string): Promise<ProposeResult>;
  confirm(): Promise<boolean>;
  cancel(): Promise<void>;
  undo(): Promise<void>;
  markRendered(revisionId: number): Promise<void>;
  reportRenderError(error: unknown): Promise<void>;
  dismissBanner(): void;
  selectTab(target: NavTarget): void;
  setArranging(pageId: string | null): void;
  bumpRecords(): void;
  showToast(toast: { message: string; restoreRecordId?: string }): void;
  dismissToast(): void;
  listRevisions(limit?: number): Promise<RevisionRecord[]>;
  bumpAssets(): void;
}

export type WorkspaceStore = StoreApi<WorkspaceState>;

function focusPage(ops: readonly Op[], config: WorkspaceConfig): string {
  for (const op of ops) {
    if ('pageId' in op) return op.pageId;
    if ('workflowId' in op) {
      const owner = config.pages.find((p) =>
        p.components.some(
          (c) => c.type === 'workflowRunner' && c.props.workflowId === op.workflowId,
        ),
      );
      if (owner) return owner.id;
    }
  }
  return 'home';
}

export function createWorkspaceStore(deps: WorkspaceDeps): WorkspaceStore {
  const { repo, registry, locale } = deps;
  const msg = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    t(locale, key, vars);

  /** 最近一次成功渲染的配置；渲染失败时回退到它。 */
  let lastRendered: WorkspaceConfig | null = null;
  /** 等待“渲染成功”确认的提交。 */
  let pending: {
    changeRequestId: number;
    revisionId: number;
    undoTo: number;
    summary: string;
  } | null = null;
  /** 连续回退次数；回退后仍无法渲染时停止，避免循环。 */
  let consecutiveRollbacks = 0;

  return createStore<WorkspaceState>()((set, get) => {
    /** 从数据库重新读取 head（§4：持久化后重新读取再渲染）。 */
    async function reload(): Promise<void> {
      const head = await repo.getHead();
      if (!head) throw new Error('workspace has no head revision');
      const prepared = prepareSnapshot(head.config, registry);
      if (!prepared.ok)
        throw new Error(`head revision ${head.id} is invalid: ${prepared.issues.join('; ')}`);
      set({ config: prepared.after, head, status: 'ready', error: null });
    }

    async function recordPreview(
      input: string,
      plan: unknown,
      base: RevisionRecord,
      fields: Omit<Proposal, 'changeRequestId' | 'baseRevisionId'>,
    ): Promise<ProposeResult> {
      const changeRequestId = await repo.createChangeRequest({
        input,
        plan,
        status: 'previewing',
        baseRevisionId: base.id,
      });
      const proposal: Proposal = { ...fields, changeRequestId, baseRevisionId: base.id };
      set({ proposal });
      return { kind: 'preview', proposal };
    }

    async function opsProposal(
      input: string,
      ops: unknown,
      source: RevisionSource,
      summary: string,
    ): Promise<ProposeResult> {
      const { config, head } = get();
      if (!config || !head) throw new Error('workspace not loaded');
      const prepared = prepareOps(config, ops, { registry, locale, now: deps.now() });
      if (!prepared.ok) {
        await repo.createChangeRequest({
          input,
          plan: ops,
          status: 'failed',
          baseRevisionId: head.id,
          error: `${prepared.stage}: ${prepared.issues.join('; ')}`,
        });
        return { kind: 'invalid', issues: prepared.issues };
      }
      return recordPreview(input, ops, head, {
        kind: 'ops',
        before: config,
        after: prepared.after,
        lines: prepared.lines,
        source,
        summary,
        focusPageId: focusPage(ops as Op[], prepared.after),
      });
    }

    async function restoreProposal(revisionId: number, input: string): Promise<ProposeResult> {
      const { config, head } = get();
      if (!config || !head) throw new Error('workspace not loaded');
      const target = await repo.getRevision(revisionId);
      const prepared = target ? prepareSnapshot(target.config, registry) : null;
      if (!target || !prepared?.ok) {
        const issues =
          prepared && !prepared.ok ? prepared.issues : [`revision ${revisionId} not found`];
        await repo.createChangeRequest({
          input,
          plan: { kind: 'restore', revisionId },
          status: 'failed',
          baseRevisionId: head.id,
          error: issues.join('; '),
        });
        return { kind: 'invalid', issues };
      }
      return recordPreview(input, { kind: 'restore', revisionId }, head, {
        kind: 'restore',
        before: config,
        after: prepared.after,
        lines: describeRestore(config, prepared.after, target, { registry, locale }),
        source: 'restore',
        summary: msg('restoreSummary', { id: revisionId }),
        focusPageId: 'home',
      });
    }

    /** 以当前 head 为基础，提交一份已知可用的配置（回退、修复）。 */
    async function commitFallback(
      config: WorkspaceConfig,
      source: RevisionSource,
      summary: string,
    ) {
      const head = await repo.getHead();
      await repo.commitRevision({ baseId: head?.id ?? null, config, source, summary });
      await reload();
    }

    return {
      status: 'loading',
      error: null,
      config: null,
      head: null,
      proposal: null,
      banner: null,
      busy: false,
      assetsVersion: 0,
      tab: null,
      recordsVersion: 0,
      toast: null,
      arranging: null,

      async boot() {
        try {
          // 软删除超过保留期的记录在启动时永久清除（D-037）。
          await repo.purgeDeletedRecords(
            deps.now().getTime() - RECORD_LIMITS.deletedRetentionDays * 24 * 60 * 60 * 1000,
          );
          const head = await repo.getHead();
          if (!head) {
            await repo.commitRevision({
              baseId: null,
              config: createDefaultWorkspace(locale),
              source: 'seed',
              summary: msg('initialSummary'),
            });
            await reload();
            return;
          }
          // 启动时沿历史向前寻找最后一个有效版本，保证不白屏（§4、§7E）。
          for (
            let r: RevisionRecord | null = head;
            r;
            r = r.parentId ? await repo.getRevision(r.parentId) : null
          ) {
            const prepared = prepareSnapshot(r.config, registry);
            if (!prepared.ok) continue;
            if (r.id === head.id) {
              await reload();
            } else {
              await commitFallback(prepared.after, 'recovery', msg('recovered'));
              set({ banner: { kind: 'recovered', message: msg('recovered') } });
            }
            return;
          }
          await commitFallback(createDefaultWorkspace(locale), 'recovery', msg('recovered'));
          set({ banner: { kind: 'recovered', message: msg('recovered') } });
        } catch (e) {
          set({ status: 'error', error: String(e) });
        }
      },

      async propose(input) {
        const { config, head } = get();
        if (!config || !head) throw new Error('workspace not loaded');
        set({ busy: true });
        try {
          const raw = await deps.provider.plan(input, { config, registry, locale });
          // 模型输出一律视为不可信数据（§8）。
          const parsed = PlanSchema.safeParse(raw);
          if (!parsed.success) {
            await repo.createChangeRequest({
              input,
              plan: raw,
              status: 'failed',
              baseRevisionId: head.id,
              error: 'plan did not match schema',
            });
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
            return { kind: 'rejected', message: plan.message, examples: plan.examples };
          }
          if (plan.kind === 'restorePrevious') {
            if (head.parentId === null)
              return { kind: 'rejected', message: msg('noPrevious'), examples: [] };
            return await restoreProposal(head.parentId, input);
          }
          return await opsProposal(input, plan.ops, 'ai', input);
        } finally {
          set({ busy: false });
        }
      },

      proposeRestore: (revisionId) =>
        restoreProposal(revisionId, msg('restoreSummary', { id: revisionId })),

      proposeOps: (ops, summary) => opsProposal(summary, ops, 'user', summary),

      async confirm() {
        const proposal = get().proposal;
        if (!proposal) return false;
        set({ busy: true });
        try {
          const revision = await repo.commitRevision({
            baseId: proposal.baseRevisionId,
            config: proposal.after,
            source: proposal.source,
            summary: proposal.summary,
          });
          pending = {
            changeRequestId: proposal.changeRequestId,
            revisionId: revision.id,
            undoTo: proposal.baseRevisionId,
            summary: proposal.summary,
          };
          set({ proposal: null });
          // 被移除的工具失去文件授权；文件本身保留（§7G）。
          const remaining = new Set(proposal.after.tools.map((t) => t.toolId));
          for (const tool of proposal.before.tools) {
            if (!remaining.has(tool.toolId)) await repo.revokeToolGrants(tool.toolId);
          }
          await reload();
          return true;
        } catch (e) {
          if (!(e instanceof RevisionConflictError)) throw e;
          await repo.updateChangeRequest(proposal.changeRequestId, {
            status: 'failed',
            error: e.message,
          });
          set({ proposal: null, banner: { kind: 'conflict', message: msg('conflict') } });
          await reload();
          return false;
        } finally {
          set({ busy: false });
        }
      },

      async cancel() {
        const proposal = get().proposal;
        if (!proposal) return;
        set({ proposal: null });
        await repo.updateChangeRequest(proposal.changeRequestId, { status: 'cancelled' });
      },

      async undo() {
        const undoTo = get().banner?.undoTo;
        if (undoTo === undefined) return;
        const result = await restoreProposal(undoTo, msg('undoSummary'));
        set({ banner: null });
        if (result.kind === 'preview') {
          set({ proposal: { ...result.proposal, summary: msg('undoSummary') } });
          await get().confirm();
        }
      },

      async markRendered(revisionId) {
        const { head, config } = get();
        if (!head || head.id !== revisionId || !config) return;
        lastRendered = config;
        consecutiveRollbacks = 0;
        if (pending && pending.revisionId === revisionId) {
          const done = pending;
          pending = null;
          await repo.updateChangeRequest(done.changeRequestId, {
            status: 'committed',
            resultRevisionId: done.revisionId,
          });
          set({
            banner: {
              kind: 'applied',
              message: `${msg('applied')}：${done.summary}`,
              undoTo: done.undoTo,
            },
          });
        }
      },

      async reportRenderError(error) {
        const { config } = get();
        const failed = pending;
        pending = null;
        if (++consecutiveRollbacks > 2) {
          set({ status: 'error', error: String(error) });
          return;
        }
        // 回退目标：最后一次成功渲染的配置；若它本身就是出错的配置，则退回默认工作空间。
        const sameAsFailed =
          lastRendered && JSON.stringify(lastRendered) === JSON.stringify(config);
        const fallback =
          lastRendered && !sameAsFailed ? lastRendered : createDefaultWorkspace(locale);
        await commitFallback(
          fallback,
          'rollback',
          `${msg('rolledBack')} (${String(error)})`.slice(0, 300),
        );
        if (failed) {
          await repo.updateChangeRequest(failed.changeRequestId, {
            status: 'rolled_back',
            resultRevisionId: failed.revisionId,
            error: String(error),
          });
        }
        set({ banner: { kind: 'rolledBack', message: msg('rolledBack') } });
      },

      dismissBanner: () => set({ banner: null }),
      selectTab: (target) => set({ tab: target, arranging: null }),
      setArranging: (pageId) => set({ arranging: pageId }),
      bumpRecords: () => set((s) => ({ recordsVersion: s.recordsVersion + 1 })),
      showToast: (toast) => set({ toast }),
      dismissToast: () => set({ toast: null }),

      listRevisions: (limit = 50) => repo.listRevisions(limit),

      bumpAssets: () => set({ assetsVersion: get().assetsVersion + 1 }),
    };
  });
}
