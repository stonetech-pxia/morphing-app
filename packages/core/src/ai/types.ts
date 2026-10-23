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
 */
export type RejectReason =
  'unknown' | 'protected' | 'deleteFiles' | 'userData' | 'notInstalled' | 'noChange' | 'errand';

export const REJECT_REASONS = [
  'unknown',
  'protected',
  'deleteFiles',
  'userData',
  'notInstalled',
  'noChange',
  'errand',
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
    }
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason: RejectReason; message: string; examples: string[] };

export const PlanSchema: z.ZodType<Plan> = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ops'),
    ops: OpListSchema,
    homeEntry: z.boolean().optional(),
    notes: z.array(z.string().min(1).max(200)).max(4).optional(),
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
 * - shared：从收件页面打开，带着分享进来的文件的类型和个数（没有文件名、大小和内容）。
 */
export type PlanAbout =
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'shared'; images: number; pdfs: number; others: number };

export const PlanAboutSchema: z.ZodType<PlanAbout> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('workflow'), workflowId: z.string().min(1).max(64) }),
  z.strictObject({
    kind: z.literal('shared'),
    images: z.number().int().min(0).max(100),
    pdfs: z.number().int().min(0).max(100),
    others: z.number().int().min(0).max(100),
  }),
]);

export interface PlanContext {
  config: WorkspaceConfig;
  registry: Registry;
  /** 界面语言：拒绝说明和示例用这种语言。 */
  locale: Locale;
  about?: PlanAbout;
}

export interface AIProvider {
  plan(input: string, ctx: PlanContext): Promise<Plan>;
}
