import {
  MAX_OPS_PER_CHANGE,
  PlanSchema,
  RECORD_LIMITS,
  coalesceOps,
  createDefaultWorkspace,
  describeRestore,
  homeEntryOps,
  prepareOps,
  prepareSnapshot,
  workflowsWithoutEntry,
  type AIProvider,
  type Locale,
  type NavTarget,
  type Op,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { formatWhen, t } from '../i18n';
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
  /** 第一次启动时的第一个版本。App 用预装了工具的 createStarterWorkspace（D-104）；不传时是空白工作空间。 */
  seed?: (locale: Locale, registry: Registry) => WorkspaceConfig;
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
  /** 新建、但不在任何页面上的工作流：预览显示它的步骤，应用后打开工作流列表（D-109）。 */
  focusWorkflowId?: string;
  /** AI 新建的工作流的「在首页放一个入口」选项（D-109）；on 时 after 已包含首页的运行卡片。 */
  homeEntry?: { workflowIds: string[]; on: boolean };
  /** AI 计划里的操作（不含首页入口），切换首页入口时据此重新计算。 */
  ops?: Op[];
  /** AI 写给用户的说明：做不到的部分、补上的步骤为什么要加（D-110）。 */
  notes?: string[];
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

/** 编辑模式的草稿（D-054）：操作先累积在这里，点「完成」时作为一个版本提交。 */
export interface EditDraft {
  pageId: string;
  /** 已合并相邻同类操作。 */
  ops: Op[];
  /** 应用 ops 后、已通过校验的配置；编辑模式下页面显示它。 */
  config: WorkspaceConfig;
}

export type EditResult = { ok: true } | { ok: false; issues: string[] } | { ok: false; full: true };

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
  /** 编辑模式（直接编辑，D-052–D-054）；为 null 时不在编辑模式。 */
  editing: EditDraft | null;

  boot(): Promise<void>;
  /** planner 不传时用设置里选的 AI；风格选择器填的原句用内置规则（D-095）。 */
  propose(input: string, planner?: AIProvider): Promise<ProposeResult>;
  proposeRestore(revisionId: number): Promise<ProposeResult>;
  /** 来自界面按钮（安装、卸载等）的修改，同样经过校验和版本记录。 */
  proposeOps(ops: Op[], summary: string): Promise<ProposeResult>;
  /** 预览里勾选 / 取消「在首页放一个入口」（D-109）。 */
  setHomeEntry(on: boolean): void;
  confirm(): Promise<boolean>;
  cancel(): Promise<void>;
  undo(): Promise<void>;
  markRendered(revisionId: number): Promise<void>;
  reportRenderError(error: unknown): Promise<void>;
  dismissBanner(): void;
  selectTab(target: NavTarget): void;
  startEditing(pageId: string): void;
  /** 把操作加入草稿：先校验，不通过时草稿不变。 */
  editOps(ops: Op[]): EditResult;
  /** 「完成」：草稿作为一个 source 为 user 的版本提交；没有实际变化时直接退出。 */
  finishEditing(summary: string): Promise<EditResult>;
  /** 「取消」：放弃草稿。 */
  cancelEditing(): void;
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

    /**
     * 计划里的操作加上（勾选时）首页入口，算出预览要显示的内容。
     * 首页入口加不进去（例如操作数到了上限）时当作不勾选。
     */
    function withHomeEntry(
      before: WorkspaceConfig,
      ops: Op[],
      base: { after: WorkspaceConfig; lines: string[] },
      workflowIds: string[],
      on: boolean,
    ): Pick<Proposal, 'after' | 'lines' | 'focusPageId' | 'focusWorkflowId' | 'homeEntry'> {
      if (on) {
        const full = prepareOps(before, [...ops, ...homeEntryOps(base.after, workflowIds)], {
          registry,
          locale,
          now: deps.now(),
        });
        if (full.ok)
          return {
            after: full.after,
            lines: base.lines,
            focusPageId: 'home',
            homeEntry: { workflowIds, on: true },
          };
      }
      return {
        after: base.after,
        lines: base.lines,
        focusPageId: focusPage(ops, base.after),
        focusWorkflowId: workflowIds[0],
        homeEntry: { workflowIds, on: false },
      };
    }

    async function opsProposal(
      input: string,
      ops: unknown,
      source: RevisionSource,
      summary: string,
      plan?: { homeEntry?: boolean; notes?: string[] },
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
      const parsed = ops as Op[];
      // AI 新建的工作流不在任何页面上时，由用户决定要不要放到首页（D-109）。
      const homeless = source === 'ai' ? workflowsWithoutEntry(parsed, prepared.after) : [];
      return recordPreview(input, ops, head, {
        kind: 'ops',
        before: config,
        source,
        summary,
        ops: parsed,
        ...(plan?.notes?.length ? { notes: plan.notes } : {}),
        ...(homeless.length > 0
          ? withHomeEntry(config, parsed, prepared, homeless, plan?.homeEntry !== false)
          : {
              after: prepared.after,
              lines: prepared.lines,
              focusPageId: focusPage(parsed, prepared.after),
            }),
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
        summary: msg('restoreSummary', {
          when: formatWhen(locale, new Date(target.createdAt), deps.now()),
        }),
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
      editing: null,

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
              config: (deps.seed ?? createDefaultWorkspace)(locale, registry),
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

      async propose(input, planner = deps.provider) {
        const { config, head } = get();
        if (!config || !head) throw new Error('workspace not loaded');
        set({ busy: true });
        try {
          const raw = await planner.plan(input, { config, registry, locale });
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
          return await opsProposal(input, plan.ops, 'ai', input, plan);
        } finally {
          set({ busy: false });
        }
      },

      proposeRestore: (revisionId) => restoreProposal(revisionId, `restore #${revisionId}`),

      proposeOps: (ops, summary) => opsProposal(summary, ops, 'user', summary),

      setHomeEntry(on) {
        const proposal = get().proposal;
        if (!proposal?.homeEntry || !proposal.ops || proposal.homeEntry.on === on) return;
        const base = prepareOps(proposal.before, proposal.ops, {
          registry,
          locale,
          now: deps.now(),
        });
        if (!base.ok) return;
        const { focusWorkflowId: _, ...rest } = proposal;
        set({
          proposal: {
            ...rest,
            ...withHomeEntry(
              proposal.before,
              proposal.ops,
              base,
              proposal.homeEntry.workflowIds,
              on,
            ),
          },
        });
      },

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
      selectTab: (target) => set({ tab: target, editing: null }),

      startEditing(pageId) {
        const { config, editing } = get();
        if (!config || editing?.pageId === pageId) return;
        set({ editing: { pageId, ops: [], config } });
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
      bumpRecords: () => set((s) => ({ recordsVersion: s.recordsVersion + 1 })),
      showToast: (toast) => set({ toast }),
      dismissToast: () => set({ toast: null }),

      listRevisions: (limit = 50) => repo.listRevisions(limit),

      bumpAssets: () => set({ assetsVersion: get().assetsVersion + 1 }),
    };
  });
}
