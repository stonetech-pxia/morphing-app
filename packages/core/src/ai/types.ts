import { z } from 'zod';

import { OpListSchema, type Op } from '../ops';
import type { Registry } from '../registry';
import type { Locale, WorkspaceConfig } from '../schema';

// AIProvider（§5.4、§14.2）：输入用户的一句话和当前配置，输出结构化计划。
// mock 与真实模型实现同一个接口；计划在使用前一律经过 PlanSchema 和 validateWorkspace。

export type RejectReason = 'unknown' | 'protected' | 'deleteFiles' | 'notInstalled' | 'noChange';

export type Plan =
  | { kind: 'ops'; ops: Op[] }
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason: RejectReason; message: string; examples: string[] };

export const PlanSchema: z.ZodType<Plan> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ops'), ops: OpListSchema }),
  z.strictObject({ kind: z.literal('restorePrevious') }),
  z.strictObject({
    kind: z.literal('reject'),
    reason: z.enum(['unknown', 'protected', 'deleteFiles', 'notInstalled', 'noChange']),
    message: z.string(),
    examples: z.array(z.string()),
  }),
]) as z.ZodType<Plan>;

export interface PlanContext {
  config: WorkspaceConfig;
  registry: Registry;
  /** 界面语言：拒绝说明和示例用这种语言。 */
  locale: Locale;
}

export interface AIProvider {
  plan(input: string, ctx: PlanContext): Promise<Plan>;
}
