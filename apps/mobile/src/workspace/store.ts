import {
  MAX_OPS_PER_CHANGE,
  PlanSchema,
  RECORD_LIMITS,
  coalesceOps,
  createDefaultWorkspace,
  describeRestore,
  functionFirst,
  homeEntryOps,
  prepareOps,
  prepareSnapshot,
  workflowsWithoutEntry,
  type AIProvider,
  type FunctionFirst,
  type Locale,
  type NavTarget,
  type Op,
  type Plan,
  type PlanAbout,
  type PlanEarlier,
  type PreparedChange,
  type Registry,
  type RejectReason,
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
  /** 不在注册表里的工具叫什么（从下载的工具目录里查，D-177）；恢复历史版本缺工具时提示用。 */
  toolName?: (toolId: string) => string | undefined;
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
  | { kind: 'rejected'; message: string; examples: string[]; reason?: RejectReason }
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
  mode: 'single' | 'page';
  /** 已合并相邻同类操作。 */
  ops: Op[];
  /** 应用 ops 后、已通过校验的配置；编辑模式下页面显示它。 */
  config: WorkspaceConfig;
}

export type EditResult = { ok: true } | { ok: false; issues: string[] } | { ok: false; full: true };

/** AI 修改草稿的一步（D-190）：用户说的一句话和 AI 给的修改。 */
export interface DraftStep {
  input: string;
  /** 已包含新快捷操作的首页入口。 */
  ops: Op[];
  lines: string[];
  notes?: string[];
  changeRequestId: number;
  /** 套用到这一步为止的配置。不存盘：启动或回到草稿时在最新版本上重新算（rebaseDraft）。 */
  config: WorkspaceConfig;
}

/** 草稿从哪里开始的：应用后据此带用户回去（从快捷操作或收件页面打开）。 */
export interface DraftOrigin {
  about?: PlanAbout;
}

/**
 * AI 修改的草稿（D-190）：AI 处理完直接进入草稿模式，App 显示改完后的样子，能看不能用；
 * 「修改」接着说、「退一步」撤掉最近一步、「应用」合成一个版本保存、「离开」回到正式的 App 但草稿保留。
 * 一次只有一份，存在本机（app_meta），重启也在。
 */
export interface Draft {
  steps: DraftStep[];
  /** 聊天框里没变成一步的话和回复（D-207），跟草稿一起存盘。 */
  replies: DraftChatReply[];
  origin: DraftOrigin;
  /** 正在草稿模式里；false = 离开了，草稿还在。 */
  open: boolean;
}

/** 草稿聊天框里没变成一步的一句话（D-207）：做不到、不合格、功能类、退了一步。 */
export interface DraftChatReply {
  /** 说的时候草稿有几步：聊天框把它排在这一步后面；退一步退过它时一起去掉。 */
  afterSteps: number;
  input: string;
  kind: 'rejected' | 'invalid' | 'functionInDraft' | 'steppedBack';
  message: string;
  examples: string[];
  reason?: RejectReason;
}

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

export type DraftResult =
  /** focusPageId：这一步改到的页面，进入草稿时显示它。 */
  | { kind: 'drafted'; step: DraftStep; focusPageId: string }
  /** 草稿里说「撤销」：退了一步。没有草稿时说「撤销」：直接回到上一个版本。 */
  | { kind: 'steppedBack' }
  | { kind: 'restored' }
  | { kind: 'rejected'; message: string; examples: string[]; reason?: RejectReason }
  | { kind: 'invalid'; issues: string[] };

/**
 * AI 修改页说的一句话（D-191）：功能类直接应用（applied），外观类进草稿。
 * 在草稿的聊天框里说功能类的话会被拒绝（functionInDraft），说明要去「修改这个 App」说。
 */
export type ChangeResult =
  | DraftResult
  /** focusPageId：改到的页面，回到 App 时显示它。 */
  | { kind: 'applied'; applied: Applied; focusPageId: string }
  | { kind: 'functionInDraft'; message: string };

/** 应用之后（草稿或直接应用的功能）带用户去哪里要用的信息。 */
export interface Applied {
  addedWorkflowIds: string[];
  addedCollectionIds: string[];
  origin: DraftOrigin;
  /** AI 的说明（D-110），直接应用的功能在「做好了」页面上显示。 */
  notes?: string[];
}

const DRAFT_META_KEY = 'draft';
const NEXT_META_KEY = 'next';

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
  /** AI 修改的草稿（D-190）。 */
  draft: Draft | null;
  /** 草稿的提示：重新套用时去掉了几步、草稿显示出错退了一步。 */
  draftNotice: string | null;
  /**
   * 「接着改」的预设（D-191）：上一次功能修改那句话里剩下的外观请求。只有一条，存在本机；
   * 下一次功能修改换掉它，用掉或撤销时清掉。
   */
  next: string | null;

  boot(): Promise<void>;
  /**
   * planner 不传时用设置里选的 AI；风格选择器填的原句用内置规则（D-095）。
   * about：从哪里打开的 AI 修改（一个快捷操作、分享进来的文件，D-124）。
   */
  propose(input: string, planner?: AIProvider, about?: PlanAbout): Promise<ProposeResult>;
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
  startEditing(pageId: string, mode?: EditDraft['mode']): void;
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
  /**
   * AI 修改页的一句话（D-191）：功能类直接应用，外观类进草稿（没有草稿时新建一份）；
   * planner 不传时用设置里选的 AI。
   */
  change(input: string, planner?: AIProvider, origin?: DraftOrigin): Promise<ChangeResult>;
  /** 草稿聊天框的一句话：只改外观，功能类的请求不做。 */
  draftChange(input: string): Promise<ChangeResult>;
  clearNext(): Promise<void>;
  stepBack(): Promise<void>;
  openDraft(): void;
  closeDraft(): void;
  applyDraft(): Promise<Applied | null>;
  deleteDraft(): Promise<void>;
  /** 草稿显示出错：撤掉最近一步（只有一步时删掉草稿），回到能显示的样子。 */
  draftRenderFailed(error: unknown): Promise<void>;
  dismissDraftNotice(): void;
}

/** 外壳和页面要显示的配置：在草稿模式里是草稿，否则是当前版本。 */
export function shownConfig(s: Pick<WorkspaceState, 'config' | 'draft'>): WorkspaceConfig | null {
  return s.draft?.open ? (s.draft.steps.at(-1)?.config ?? s.config) : s.config;
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
      // 这个版本用到了本机没有的下载工具（换了手机、删了下载的内容）：先下载才能恢复（D-177）。
      const missing = (
        (target?.config as { tools?: { toolId: string }[] } | undefined)?.tools ?? []
      )
        .map((tool) => tool.toolId)
        .filter((id) => !registry.tools.has(id));
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
        pending = { changeRequestId, revisionId: revision.id, undoTo: head!.id, summary };
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

    function addedBy(
      before: WorkspaceConfig,
      after: WorkspaceConfig,
      origin: DraftOrigin,
    ): Applied {
      const workflows = new Set(before.workflows.map((w) => w.id));
      const collections = new Set(before.collections.map((c) => c.id));
      return {
        addedWorkflowIds: after.workflows.filter((w) => !workflows.has(w.id)).map((w) => w.id),
        addedCollectionIds: after.collections
          .filter((c) => !collections.has(c.id))
          .map((c) => c.id),
        origin,
      };
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
      draft: null,
      draftNotice: null,
      next: null,

      async boot() {
        await bootHead();
        if (get().status !== 'ready') return;
        await loadDraft();
        set({ next: (await repo.getMeta(NEXT_META_KEY)) || null });
      },

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
        // 撤销了那次功能修改，剩下的那句也就接不上了。
        await get().clearNext();
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
              message: msg('applied', { summary: done.summary }),
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
      bumpRecords: () => set((s) => ({ recordsVersion: s.recordsVersion + 1 })),
      showToast: (toast) => set({ toast }),
      dismissToast: () => set({ toast: null }),

      listRevisions: (limit = 50) => repo.listRevisions(limit),

      bumpAssets: () => set({ assetsVersion: get().assetsVersion + 1 }),

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
          pending = {
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
  });
}
