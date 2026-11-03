import { prepareOps, type ChangeContext } from '../change';
import { describeChange } from '../describe';
import { t } from '../messages';
import { applyOps, isFunctionOp, type Op } from '../ops';
import type { WorkspaceConfig } from '../schema';

// 功能和外观分开改（D-191）。功能：数据（表结构、日期设置）、独立工具（快捷操作、提醒）、工具包、手机桌面，
// 直接生效（可以撤销），做好后可以马上试用；外观：主题、导航栏、页面和页面上的块（记录块、表单、数字也算，
// 块上的就地一键记录工具也是），先进草稿看效果（D-190）。
// 一个计划两样都有时功能先生效，剩下的外观直接进草稿（D-419）。由 App 按操作判断，不靠模型自觉。

/** 同一批操作里新建的快捷操作。 */
function newQuickActionIds(ops: readonly Op[]): Set<string> {
  return new Set(
    ops.flatMap((op) =>
      op.op === 'addTool' && typeof op.tool !== 'string' && op.tool.kind === 'quickAction'
        ? [op.tool.id]
        : [],
    ),
  );
}

/**
 * 是不是功能类操作（ops-schema.ts 的 isFunctionOp：数据、独立工具、工具包、手机桌面）。
 * 新快捷操作的运行块（look action）跟着它一起应用：不然做好了却找不到。
 */
function goesWithFunction(op: Op, added: ReadonlySet<string>): boolean {
  if (isFunctionOp(op)) return true;
  if (op.op !== 'addContainer' || op.block?.look !== 'action') return false;
  const use = op.block.tools[0];
  return use !== undefined && 'tool' in use && added.has(use.tool);
}

/** 把一批操作分成功能和外观两部分，各自保持原来的顺序。 */
export function splitOps(ops: readonly Op[]): { function: Op[]; look: Op[] } {
  const added = newQuickActionIds(ops);
  const result: { function: Op[]; look: Op[] } = { function: [], look: [] };
  for (const op of ops) result[goesWithFunction(op, added) ? 'function' : 'look'].push(op);
  return result;
}

export const hasFunctionOps = (ops: readonly Op[]): boolean => splitOps(ops).function.length > 0;

export type FunctionFirst =
  | { kind: 'look' }
  /** ops：这一轮直接应用的；deferred：功能生效后进草稿的外观操作（D-419）。 */
  | { kind: 'function'; ops: Op[]; deferred: Op[] };

/**
 * 这一轮做什么（D-191）：没有功能操作就是外观；有功能操作先做功能。功能单独套不上、连同外观才套得上时
 * （例如删字段要把它从表单和列表里拿掉），这些外观操作是功能的善后，一起做。
 */
export function functionFirst(
  before: WorkspaceConfig,
  ops: readonly Op[],
  ctx: ChangeContext,
): FunctionFirst {
  const split = splitOps(ops);
  if (split.function.length === 0) return { kind: 'look' };
  if (split.look.length === 0) return { kind: 'function', ops: split.function, deferred: [] };
  if (prepareOps(before, split.function, ctx).ok || !prepareOps(before, ops, ctx).ok)
    return { kind: 'function', ops: split.function, deferred: split.look };
  return { kind: 'function', ops: [...ops], deferred: [] };
}

/**
 * 外观套不上时留给用户的一句话（D-419）：能说明白做什么就说，说不出来就是原话。这句话会再发给模型。
 */
export function deferredLookText(
  config: WorkspaceConfig,
  deferred: readonly Op[],
  ctx: ChangeContext,
  input: string,
): string {
  const lines = describeChange(deferred, config, [], ctx);
  return (lines.length > 0 ? lines.join(t(ctx.locale, 'separatorSemicolon')) : input).slice(0, 200);
}

/**
 * 在草稿的样子上说的功能修改，要应用到正式版本（D-413）：善后的外观操作针对的页面、块只在草稿里时，
 * 正式版本上跳过，留给草稿套上时再做（rebaseDraft 的 cleanup）。功能操作和跟着新快捷操作的运行块不跳：
 * 它们套不上就是真的要用到草稿里的东西（返回 null）。
 */
export function splitDraftOnlyOps(
  head: WorkspaceConfig,
  ops: readonly Op[],
  ctx: ChangeContext,
): { kept: Op[]; skipped: Op[] } | null {
  const added = newQuickActionIds(ops);
  const kept: Op[] = [];
  const skipped: Op[] = [];
  let config = head;
  for (const op of ops) {
    const applied = applyOps(config, [op], ctx);
    if (applied.ok) {
      config = applied.config;
      kept.push(op);
    } else if (goesWithFunction(op, added)) return null;
    else skipped.push(op);
  }
  return skipped.length > 0 ? { kept, skipped } : null;
}

/** 这批善后操作里，在这份配置上套得上的部分（按顺序，一条套不上就跳过它）。 */
export function applicableOps(
  config: WorkspaceConfig,
  ops: readonly Op[],
  ctx: ChangeContext,
): Op[] {
  const kept: Op[] = [];
  let current = config;
  for (const op of ops) {
    const applied = applyOps(current, [op], ctx);
    if (!applied.ok) continue;
    current = applied.config;
    kept.push(op);
  }
  return kept;
}
