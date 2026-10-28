import type {
  AIProvider,
  Locale,
  NavTarget,
  Op,
  PlanAbout,
  RejectReason,
  Registry,
  SampleApp,
  WorkspaceConfig,
} from '@morph/core';
import type { StoreApi } from 'zustand/vanilla';

import type { RevisionRecord, RevisionSource, WorkspaceRepo } from '../../storage/types';

// workspace store 对外的类型：状态、动作和它们的结果。动作的实现分在同目录的几个文件里（见 ../store.ts）。

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
  /** 新手引导第 3 步套用的样板（D-260）：应用后回到它的主页面，提示可以用 AI 接着改。 */
  sample?: { id: SampleApp; pageId: string };
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
  /** quiet：渲染后顶部不出「已改好 · 撤销」（新手引导里的修改，D-239）。 */
  confirm(options?: { quiet?: boolean }): Promise<boolean>;
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
  /**
   * 套用一个样板 App（D-260）：整套修改（表、快捷操作、页面、提醒）作为草稿的一步，不经过 AI、不发请求；
   * 用户点「应用」时合成一个版本，可以撤销。放不下时不进草稿，返回原因。
   */
  draftSample(sample: SampleApp): Promise<DraftResult>;
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

export type WorkspaceStore = StoreApi<WorkspaceState>;
