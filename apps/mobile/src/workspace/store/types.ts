import type {
  AIProvider,
  BuildStep,
  Locale,
  NavTarget,
  Op,
  Plan,
  PlanAbout,
  RejectReason,
  Registry,
  SampleApp,
  WorkSession,
  WorkspaceConfig,
  PlanProgress,
} from '@morph/core';
import type { StoreApi } from 'zustand/vanilla';

import type {
  RevisionRecord,
  RevisionSource,
  SavedPreset,
  WorkspaceRepo,
} from '../../storage/types';

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
  /** 恢复的是哪个版本（撤销、恢复历史版本）；比它新的版本里做的，清单里不再算做了（D-414）。换预设没有这一项，全都不算。 */
  restoredTo?: number;
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
  /** 手指正按在「撤销」上：这时不到时间消失，否则这一下会落空。 */
  held?: boolean;
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

/** 草稿聊天框里没变成一步的一句话（D-207）：做不到、不合格、功能类已经直接生效（D-411）、退了一步。 */
export interface DraftChatReply {
  /** 说的时候草稿有几步：聊天框把它排在这一步后面；退一步退过它时一起去掉。 */
  afterSteps: number;
  input: string;
  kind: 'rejected' | 'invalid' | 'functionApplied' | 'steppedBack' | 'needsDraft';
  message: string;
  examples: string[];
  reason?: RejectReason;
  /** needsDraft：用户点「应用草稿并继续」时接着做的这一步（D-413）。只有配置结构。 */
  waiting?: WaitingForDraft;
}

/** 这一步要用到草稿里的东西（D-413）：等用户点「应用草稿并继续」。 */
export interface WaitingForDraft {
  input: string;
  plan: Extract<Plan, { kind: 'ops' }>;
  origin: DraftOrigin;
}

export type BuildStepStatus = 'todo' | 'running' | 'done' | 'skipped' | 'failed';

export interface BuildRunStep extends BuildStep {
  status: BuildStepStatus;
  /** 前一步已经把这一步做了（模型回 noChange）：打勾，但说明不同。不算失败。 */
  already?: boolean;
  /** 卡住的原因。 */
  reason?: string;
  /** 卡住的原因是要用到草稿里的东西（D-413）：显示「应用草稿并继续」。 */
  needsDraft?: boolean;
  /** 这一步做完功能后接着做的那句（next）：重试时从这里接着。 */
  current?: string;
}

/**
 * 正在搭的大工程（D-415）。review：等用户看计划；running：在做；failed：一步失败，等用户选；
 * paused：停下了（用户点的、App 进后台或重启），等用户点继续（底线 16）；finished：都做完了。存在本机，随 App 重启保留。
 */
export interface BuildRun {
  summary: string;
  steps: BuildRunStep[];
  phase: 'review' | 'running' | 'failed' | 'paused' | 'finished';
  origin: DraftOrigin;
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
 * AI 修改页说的一句话（D-191）：功能类直接应用（applied），外观类进草稿；
 * 一个计划两样都有时功能直接应用，结果是外观进草稿的 drafted（D-419）。
 * 在草稿的聊天框里说功能类的话也直接应用，草稿接着开着（D-411）。
 */
export type ChangeResult =
  | DraftResult
  /**
   * focusPageId：改到的页面，回到 App 时显示它。lines：改了什么。
   * lookNotDone：这个计划里的外观套不上，没做（D-419）；做成了的话结果是 drafted。
   */
  | {
      kind: 'applied';
      applied: Applied;
      lines: string[];
      focusPageId: string;
      lookNotDone?: boolean;
    }
  /** 这一步要用到草稿里的东西（D-413）：什么都没改，等用户点「应用草稿并继续」。 */
  | { kind: 'needsDraft'; message: string; waiting: WaitingForDraft }
  /** 大工程（规则 53）：计划在 build 里，等用户看过点「开始」（D-415）。 */
  | { kind: 'build' };

/** 应用之后（草稿或直接应用的功能）带用户去哪里要用的信息。 */
export interface Applied {
  addedWorkflowIds: string[];
  addedCollectionIds: string[];
  /** 这次新放到手机桌面的快捷操作（D-271）：只有一个时打开它的「做好了」，说明怎么用。 */
  homeScreenWorkflowIds: string[];
  origin: DraftOrigin;
  /** AI 的说明（D-110），直接应用的功能在「做好了」页面上显示。 */
  notes?: string[];
}

/** 记录提示条。只有删除带撤销（restoreRecordId、restorePreset，底线 11，D-385）。 */
export interface RecordToast {
  message: string;
  restoreRecordId?: string;
  /** 删掉的预设（D-410）：预设是真删，撤销时把这份放回去。 */
  restorePreset?: SavedPreset;
  /** 这张表还没有页面读：提示上有「接着改」，打开 AI 页改这张表。 */
  continueTable?: string;
  /** 手指正按在提示的按钮上：这时不到时间消失。 */
  held?: boolean;
}

export type SavePresetResult =
  | { kind: 'saved'; preset: SavedPreset }
  /** 名字是空的。 */
  | { kind: 'noName' }
  /** 到上限了（MAX_SAVED_PRESETS）。 */
  | { kind: 'full' };

export interface WorkspaceState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  config: WorkspaceConfig | null;
  head: RevisionRecord | null;
  proposal: Proposal | null;
  banner: Banner | null;
  busy: boolean;
  /** AI 规划走到哪一步（D-448），AI 页在 Tink 旁边显示；不忙时是 null。 */
  planProgress: PlanProgress | null;
  /** 文件列表的刷新信号：工作流保存文件后递增。 */
  assetsVersion: number;
  /** 显示过的版本渲染出错、不回退时加 1：出错边界按它重新挂载，再试一次。 */
  renderAttempt: number;
  /** 外壳当前显示的导航项；版本变化时外壳会重新挂载，所以保存在这里。 */
  tab: NavTarget | null;
  /** 记录的刷新信号：增删改记录后递增。 */
  recordsVersion: number;
  /** 预设列表的刷新信号（D-410）。 */
  presetsVersion: number;
  /** 记录操作后的提示（例如删除后可以撤销）。与版本提示条分开：记录不属于任何版本。 */
  toast: RecordToast | null;
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
  /** AI 建议的下一步（D-355），存在本机：下一次修改给了新的就换掉，没给就去掉点过的那条；撤销时清掉。 */
  suggest: string[];

  boot(): Promise<void>;
  /**
   * planner 不传时用设置里选的 AI；风格选择器填的原句用内置规则（D-095）。
   * about：从哪里打开的 AI 修改（一个快捷操作、分享进来的文件，D-124）。
   */
  propose(input: string, planner?: AIProvider, about?: PlanAbout): Promise<ProposeResult>;
  proposeRestore(revisionId: number): Promise<ProposeResult>;
  /** 换成一个保存的预设（D-410）：和恢复历史版本一样先预览，确认才生效，能撤销。 */
  proposePreset(presetId: string): Promise<ProposeResult>;
  /** 把当前的 App 存成预设（D-410）：不带记录和文件引用，不产生新版本。 */
  savePreset(name: string): Promise<SavePresetResult>;
  /** 名字是空的时不改，返回 false。 */
  renamePreset(presetId: string, name: string): Promise<boolean>;
  /** 真删；提示条能撤销（底线 11）。 */
  deletePreset(preset: SavedPreset): Promise<void>;
  /** 提示条的撤销：把删掉的预设放回去。 */
  restorePreset(preset: SavedPreset): Promise<void>;
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
  showToast(toast: RecordToast): void;
  dismissToast(): void;
  holdBanner(held: boolean): void;
  holdToast(held: boolean): void;
  listRevisions(limit?: number): Promise<RevisionRecord[]>;
  bumpAssets(): void;
  /**
   * AI 修改页的一句话（D-191）：功能类直接应用，外观类进草稿（没有草稿时新建一份）；
   * planner 不传时用设置里选的 AI。
   */
  change(input: string, planner?: AIProvider, origin?: DraftOrigin): Promise<ChangeResult>;
  /** 草稿聊天框的一句话：外观接着改草稿，功能类直接生效（D-411）。 */
  draftChange(input: string, about?: PlanAbout): Promise<ChangeResult>;
  /**
   * 套用一个样板 App（D-260）：整套修改（表、快捷操作、页面、提醒）作为草稿的一步，不经过 AI、不发请求；
   * 用户点「应用」时合成一个版本，可以撤销。放不下时不进草稿，返回原因。
   */
  draftSample(sample: SampleApp): Promise<DraftResult>;
  clearNext(): Promise<void>;
  clearSuggest(): Promise<void>;
  /** 工具清单（D-414）。 */
  session: WorkSession;
  /** 清空清单和记得的话；App 和记录不变。 */
  clearSession(): Promise<void>;
  /** 用户点「应用草稿并继续」（D-413）：先确认草稿，再做等着的那一步，不再问模型。 */
  continueWithDraft(waiting: WaitingForDraft): Promise<ChangeResult>;
  /** 「把这些补上」（D-418）：把这个会话新增的问题发给 AI 一次。没有问题时返回 null，什么都不发。 */
  fixProblems(): Promise<ChangeResult | null>;
  /** 大工程的计划和进度（D-415）。 */
  build: BuildRun | null;
  /** 从计划里删掉一步；删光了计划就没了。 */
  removeBuildStep(stepId: string): Promise<void>;
  /** 用户点「开始」：这一次点击连续做完（底线 16，D-416）。一步失败或停下时返回。 */
  startBuild(): Promise<void>;
  /** 做完手上这一步就停（用户点的，或 App 进后台）。 */
  stopBuild(): Promise<void>;
  /** 从没做完的步骤接着做。 */
  resumeBuild(): Promise<void>;
  skipBuildStep(): Promise<void>;
  /** 卡在要用到草稿：先确认草稿，再重做这一步。 */
  applyDraftForBuild(): Promise<void>;
  /** 收起计划。做好的留着，没做的留在清单里。 */
  endBuild(): Promise<void>;
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
