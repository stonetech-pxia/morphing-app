import { z } from 'zod';

import type { DeskKind } from '../desk/model';
import { OpListSchema, type Op } from '../ops';
import type { Registry } from '../registry';
import type { Locale, WorkspaceConfig } from '../schema';

// AIProvider（§5.4、§14.2）：输入用户的一句话和当前配置，输出结构化计划。
// mock 与真实模型实现同一个接口；计划在使用前一律经过 PlanSchema 和 validateWorkspace。

/**
 * userData：请求涉及用户记录的内容（读、写、删、统计）。AI 只修改界面，从不接触记录。
 * errand：要 AI 替用户办事、而不是改 App（写邮件、回答问题、总结文件内容……，D-113、D-128）；
 * 说明里告诉用户可以做成什么快捷操作。
 * unavailable：AI 没能回答（连不上、出错、限额），由 App 自己生成，模型不会用它（D-189：这种拒绝不能当成需求发回来）。
 */
export type RejectReason =
  | 'unknown'
  | 'protected'
  | 'deleteFiles'
  | 'userData'
  | 'notInstalled'
  | 'noChange'
  | 'errand'
  | 'unavailable';

export const REJECT_REASONS = [
  'unknown',
  'protected',
  'deleteFiles',
  'userData',
  'notInstalled',
  'noChange',
  'errand',
  'unavailable',
] as const satisfies readonly RejectReason[];

export type Plan =
  | {
      kind: 'ops';
      ops: Op[];
      /**
       * 新建的快捷操作要不要在首页放入口（D-109）：false = 用户说了不要放；省略 = 由用户在预览里勾选，
       * 默认勾上。用户要放到首页时，AI 直接加 look "action" 的块，不用这个字段。
       */
      homeEntry?: boolean;
      /**
       * 预览里「需要你知道」的几句话（界面语言，D-110）：做不到的部分（例如没有定时运行，
       * 每月要自己点一次），以及 AI 按用途补上的步骤为什么要加。
       */
      notes?: string[];
      /**
       * 一句话里功能和外观都有时（D-191），ops 只做功能，剩下的外观请求写在这里（界面语言的一句话），
       * 做完后变成一条「接着改」的预设，点一下进草稿。
       */
      next?: string;
      /**
       * AI 建议的下一步（D-355）：这个 App 接下来常加的一两样（功能或外观都行），界面语言的短句，
       * 在 AI 修改页显示成可以点的句子，点了填进输入框。不替用户做事，只建议改 App。
       */
      suggest?: string[];
    }
  | BuildPlan
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason: RejectReason; message: string; examples: string[] };

/** 工具清单和搭建计划里一项的种类（AGENT_PLAN §1、§3.5）。 */
export type WorkKind = 'file' | 'record' | 'fileToRecord' | 'look';
export const WORK_KINDS = [
  'file',
  'record',
  'fileToRecord',
  'look',
] as const satisfies readonly WorkKind[];

/** 搭建计划的一步：request 是一句能单独发给 AI 的请求，没有操作（AGENT_PLAN §3.9）。 */
export interface BuildStep {
  id: string;
  kind: WorkKind;
  title: string;
  request: string;
}

/**
 * 大工程的搭建计划（规则 53）：不写操作，先给用户看，用户点「开始」才一步一步做（底线 16，D-415）。
 * 步数和字段由 PlanSchema 复核；计划本身只是文字，不运行任何工具（底线 6）。
 */
export interface BuildPlan {
  kind: 'build';
  summary: string;
  steps: BuildStep[];
}

/** 计划最多几步。 */
export const BUILD_MIN_STEPS = 2;
export const BUILD_MAX_STEPS = 8;

/** 一条说明最长多少字符。太长时截断（D14）：只因为说明太长，不该让整份合法的修改作废。 */
const NOTE_MAX = 200;
/** 截断时不留下半个 emoji。 */
const cutNote = (note: string) => note.slice(0, NOTE_MAX).replace(/[\uD800-\uDBFF]$/, '');

export const PlanSchema: z.ZodType<Plan> = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ops'),
    ops: OpListSchema,
    homeEntry: z.boolean().optional(),
    notes: z.array(z.string().min(1).transform(cutNote)).max(4).optional(),
    next: z.string().min(1).max(200).optional(),
    suggest: z.array(z.string().min(1).max(80)).max(2).optional(),
  }),
  z.strictObject({
    kind: z.literal('build'),
    summary: z
      .string()
      .trim()
      .min(1)
      .transform((x) => cutNote(x)),
    steps: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(64),
          kind: z.enum(WORK_KINDS),
          title: z
            .string()
            .trim()
            .min(1)
            .transform((x) => x.slice(0, 80).replace(/[\uD800-\uDBFF]$/, '')),
          // 不截断：截掉半句就是另一个请求，太长的发回去重写。
          request: z.string().trim().min(1).max(500),
        }),
      )
      .min(BUILD_MIN_STEPS)
      .max(BUILD_MAX_STEPS)
      .refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, {
        message: 'step ids must be different',
      }),
  }),
  z.strictObject({ kind: z.literal('restorePrevious') }),
  z.strictObject({
    kind: z.literal('reject'),
    reason: z.enum(REJECT_REASONS),
    message: z.string(),
    examples: z.array(z.string()),
  }),
]) as z.ZodType<Plan>;

/**
 * 用户是从哪里打开 AI 修改的（D-124）。只有结构，没有内容：
 * - workflow：从一个快捷操作打开（「让 AI 改这个」），「这个」「它」指的就是它。
 * - chain：从两次成功接续的结果打开，带有顺序的两个快捷操作 ID，没有文件信息。
 * - shared：从收件页面打开，带着分享进来的文件的类型和个数（没有文件名、大小和内容）。
 * - page：从一个页面右上角的入口打开（D-406），只有页面 ID；「这个页面」「这里」指的就是它。
 * - table：从一张表的记录表单或「做好了」页面打开（D-406），只有表 ID，没有记录。
 * - screen：从 Morph 自带的工具页、快捷操作页打开（D-406）：页面本身改不了，能加工具、加快捷操作。
 * - desk：从文件桌面打开（D-406），只有桌上文件的种类；能改工具栏和布局，碰不了文件（底线 3）。
 */
export type PlanAbout =
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'chain'; first: string; second: string }
  | {
      kind: 'shared';
      images: number;
      pdfs: number;
      others: number;
      /** 视频和音频（D-147）；旧版 App 不发，所以可选。 */
      videos?: number | undefined;
      audio?: number | undefined;
    }
  | { kind: 'page'; pageId: string }
  | { kind: 'table'; tableId: string }
  | { kind: 'screen'; screen: 'tools' | 'quickActions' }
  | { kind: 'desk'; fileKind: DeskKind };

export const PlanAboutSchema: z.ZodType<PlanAbout> = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('chain'),
    first: z.string().min(1).max(64),
    second: z.string().min(1).max(64),
  }),
  z.strictObject({ kind: z.literal('workflow'), workflowId: z.string().min(1).max(64) }),
  z.strictObject({
    kind: z.literal('shared'),
    images: z.number().int().min(0).max(100),
    pdfs: z.number().int().min(0).max(100),
    others: z.number().int().min(0).max(100),
    videos: z.number().int().min(0).max(100).optional(),
    audio: z.number().int().min(0).max(100).optional(),
  }),
  z.strictObject({ kind: z.literal('page'), pageId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal('table'), tableId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal('screen'), screen: z.enum(['tools', 'quickActions']) }),
  z.strictObject({
    kind: z.literal('desk'),
    fileKind: z.enum(['image', 'pdf', 'sheet', 'doc', 'video', 'audio', 'other']),
  }),
]);

/**
 * 同一份草稿里之前说过的一句（D-207），最早的在前。done：做了，改动已经在配置里；
 * reply：做了时是改了什么（给用户看的那几行），没做时是原因。
 */
export interface PlanEarlier {
  input: string;
  done: boolean;
  reply: string;
}

/** 工具清单里还没做完的一项（AGENT_PLAN §3.5）。 */
export interface PlanSessionItem {
  kind: WorkKind;
  text: string;
  status: 'todo' | 'failed';
  reason?: string;
}

/**
 * 发给模型的 <session> 块（D-414）：目标、没做完的项、最近几句。只有用户说的话、计划里的一句话和
 * 配置结构，没有记录内容（底线 1、2、14）。
 * step：正在做搭建计划的第几步（从 1 数），这时只能回操作；remaining 是后面还有几步。
 */
export interface PlanSession {
  goal?: string;
  open: PlanSessionItem[];
  recent: PlanEarlier[];
  step?: { index: number; total: number; remaining: number };
}

export interface PlanContext {
  config: WorkspaceConfig;
  registry: Registry;
  /** 界面语言：拒绝说明和示例用这种语言。 */
  locale: Locale;
  about?: PlanAbout;
  /** 只有评测和旧调用方还用；App 发 session（D-414）。 */
  earlier?: PlanEarlier[];
  session?: PlanSession;
  /** 规划走到哪一步（D-448）：AI 页在 Tink 旁边显示一句短话。只报阶段，不带句子或配置。 */
  onProgress?: (step: PlanProgress) => void;
}

/**
 * 规划的阶段（D-448）：前五个是这次给模型看的那部分提示词（全部 / 文件 / 记录 / 页面 / 风格），
 * checking 是在检查模型给的修改，fixing 是把问题告诉模型再问一次。
 */
export type PlanProgress = 'full' | 'files' | 'records' | 'look' | 'style' | 'checking' | 'fixing';

export interface AIProvider {
  plan(input: string, ctx: PlanContext): Promise<Plan>;
}
