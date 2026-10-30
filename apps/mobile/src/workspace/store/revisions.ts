import {
  createDefaultWorkspace,
  describeRestore,
  homeEntryOps,
  migrateWorkspace,
  type Op,
  PlanSchema,
  prepareOps,
  prepareSnapshot,
  RECORD_LIMITS,
  workflowsWithoutEntry,
  type WorkspaceConfig,
} from '@morph/core';

import { formatWhen } from '../../i18n';
import {
  RevisionConflictError,
  type RevisionRecord,
  type RevisionSource,
} from '../../storage/types';
import { focusPage, type Kernel } from './kernel';
import type { Proposal, ProposeResult, WorkspaceState } from './types';

// 版本：预览 → 确认 → 原子保存 → 重新读取并渲染 → 渲染成功才算成功，失败自动回退（§4、§7D）；
// 撤销、恢复历史版本、启动时沿历史找最后一个能用的版本。

export function createRevisions(k: Kernel) {
  const { deps, repo, registry, locale, set, get, msg, reload, commitFallback } = k;

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
    // 这个版本用到了本机没有的下载工具（换了手机、删了下载的内容）：先下载才能恢复（D-177）。
    // 旧版本（schemaVersion < 34）先升级，再看 packages。
    const migrated = target ? migrateWorkspace(target.config) : null;
    const packages = migrated?.ok
      ? ((migrated.config as { packages?: { id: string }[] }).packages ?? [])
      : [];
    const missing = packages.map((p) => p.id).filter((id) => !registry.tools.has(id));
    if (target && missing.length > 0) {
      const names = missing.map((id) => deps.toolName?.(id) ?? id).join(msg('listSeparator'));
      return { kind: 'invalid', issues: [msg('restoreNeedsTool', { names })] };
    }
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

  /** 启动：读取当前版本，坏了就沿历史找最后一个能用的。 */
  async function bootHead() {
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
  }

  const actions: Pick<
    WorkspaceState,
    | 'propose'
    | 'proposeRestore'
    | 'proposeOps'
    | 'setHomeEntry'
    | 'confirm'
    | 'cancel'
    | 'undo'
    | 'markRendered'
    | 'reportRenderError'
    | 'listRevisions'
  > = {
    async propose(input, planner = deps.provider, about) {
      const { config, head } = get();
      if (!config || !head) throw new Error('workspace not loaded');
      set({ busy: true });
      try {
        const raw = await planner.plan(input, {
          config,
          registry,
          locale,
          ...(about ? { about } : {}),
        });
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
          return {
            kind: 'rejected',
            message: plan.message,
            examples: plan.examples,
            reason: plan.reason,
          };
        }
        if (plan.kind === 'restorePrevious') {
          if (head.parentId === null)
            return { kind: 'rejected', message: msg('noPrevious'), examples: [] };
          return await restoreProposal(head.parentId, input);
        }
        // 给分享进来的文件做的快捷操作在收件页面运行，首页入口默认不勾（D-124）。
        const shaped =
          about?.kind === 'shared' || about?.kind === 'chain'
            ? { ...plan, homeEntry: plan.homeEntry ?? false }
            : plan;
        return await opsProposal(input, plan.ops, 'ai', input, shaped);
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
          ...withHomeEntry(proposal.before, proposal.ops, base, proposal.homeEntry.workflowIds, on),
        },
      });
    },

    async confirm(options) {
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
        k.render.pending = {
          changeRequestId: proposal.changeRequestId,
          revisionId: revision.id,
          undoTo: proposal.baseRevisionId,
          summary: proposal.summary,
          ...(options?.quiet ? { quiet: true } : {}),
        };
        set({ proposal: null });
        // 被移除的工具失去文件授权；文件本身保留（§7G）。
        const remaining = new Set(proposal.after.packages.map((t) => t.id));
        for (const tool of proposal.before.packages) {
          if (!remaining.has(tool.id)) await repo.revokeToolGrants(tool.id);
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
      // 撤销了那次功能修改，剩下的那句也就接不上了。
      await get().clearNext();
      await get().clearSuggest();
      if (result.kind === 'preview') {
        set({ proposal: { ...result.proposal, summary: msg('undoSummary') } });
        await get().confirm();
      }
    },

    async markRendered(revisionId) {
      const { head, config } = get();
      if (!head || head.id !== revisionId || !config) return;
      k.render.lastRendered = config;
      k.render.consecutiveRollbacks = 0;
      if (k.render.pending && k.render.pending.revisionId === revisionId) {
        const done = k.render.pending;
        k.render.pending = null;
        await repo.updateChangeRequest(done.changeRequestId, {
          status: 'committed',
          resultRevisionId: done.revisionId,
        });
        if (done.quiet) return;
        set({
          banner: {
            kind: 'applied',
            message: msg('applied', { summary: done.summary }),
            undoTo: done.undoTo,
          },
        });
      }
    },

    async reportRenderError(error) {
      const { config } = get();
      const failed = k.render.pending;
      k.render.pending = null;
      if (++k.render.consecutiveRollbacks > 2) {
        set({ status: 'error', error: String(error) });
        return;
      }
      // 回退目标：最后一次成功渲染的配置；若它本身就是出错的配置，则退回默认工作空间。
      const sameAsFailed =
        k.render.lastRendered && JSON.stringify(k.render.lastRendered) === JSON.stringify(config);
      const fallback =
        k.render.lastRendered && !sameAsFailed
          ? k.render.lastRendered
          : createDefaultWorkspace(locale);
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

    listRevisions: (limit = 50) => repo.listRevisions(limit),
  };
  return { actions, opsProposal, restoreProposal, bootHead };
}
