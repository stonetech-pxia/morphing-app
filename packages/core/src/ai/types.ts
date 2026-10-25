import { z } from 'zod';

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
       * 新建的工作流要不要在首页放入口（D-109）：false = 用户说了不要放；省略 = 由用户在预览里勾选，
       * 默认勾上。用户要放到首页时，AI 直接加 workflowRunner，不用这个字段。
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
    }
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason: RejectReason; message: string; examples: string[] };

export const PlanSchema: z.ZodType<Plan> = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ops'),
    ops: OpListSchema,
    homeEntry: z.boolean().optional(),
    notes: z.array(z.string().min(1).max(200)).max(4).optional(),
    next: z.string().min(1).max(200).optional(),
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
    };

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

export interface PlanContext {
  config: WorkspaceConfig;
  registry: Registry;
  /** 界面语言：拒绝说明和示例用这种语言。 */
  locale: Locale;
  about?: PlanAbout;
  earlier?: PlanEarlier[];
}

export interface AIProvider {
  plan(input: string, ctx: PlanContext): Promise<Plan>;
}
