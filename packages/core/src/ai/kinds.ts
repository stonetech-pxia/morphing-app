import { prepareOps, type ChangeContext } from '../change';
import type { Op } from '../ops';
import type { WorkspaceConfig } from '../schema';

// 功能和外观分开改（D-191）。功能：快捷操作、工具、数据表结构，直接生效（可以撤销），做好后可以马上试用；
// 外观：主题、导航栏、页面和页面上的组件（数据表的列表、表单、统计也算），先进草稿看效果（D-190）。
// 一句话两样都有时先做功能，剩下的外观变成一条「接着改」的预设。由 App 按操作判断，不靠模型自觉。

const FUNCTION_OPS: ReadonlySet<Op['op']> = new Set<Op['op']>([
  'addWorkflow',
  'removeWorkflow',
  'renameWorkflow',
  'updateWorkflow',
  'addWorkflowStep',
  'removeWorkflowStep',
  'moveWorkflowStep',
  'setStepParams',
  'installTool',
  'uninstallTool',
  'updateTool',
  'addCollection',
  'updateCollection',
  'addField',
  'updateField',
  'moveField',
  'removeField',
  'removeCollection',
  // 提醒是功能（D-251）：直接生效、可以撤销。
  'addReminder',
  'updateReminder',
  'removeReminder',
]);

/** 同一批操作里新建的快捷操作。 */
function newWorkflowIds(ops: readonly Op[]): Set<string> {
  return new Set(ops.flatMap((op) => (op.op === 'addWorkflow' ? [op.workflow.id] : [])));
}

/** 是不是功能类操作。新快捷操作的入口卡片跟着它一起应用：不然做好了却找不到。 */
function isFunctionOp(op: Op, added: ReadonlySet<string>): boolean {
  if (FUNCTION_OPS.has(op.op)) return true;
  return (
    op.op === 'addComponent' &&
    op.component.type === 'workflowRunner' &&
    added.has(op.component.props.workflowId)
  );
}

/** 把一批操作分成功能和外观两部分，各自保持原来的顺序。 */
export function splitOps(ops: readonly Op[]): { function: Op[]; look: Op[] } {
  const added = newWorkflowIds(ops);
  const result: { function: Op[]; look: Op[] } = { function: [], look: [] };
  for (const op of ops) result[isFunctionOp(op, added) ? 'function' : 'look'].push(op);
  return result;
}

export const hasFunctionOps = (ops: readonly Op[]): boolean => splitOps(ops).function.length > 0;

export type FunctionFirst =
  | { kind: 'look' }
  /** ops：这一轮直接应用的；deferred：留到下一句的外观操作。 */
  | { kind: 'function'; ops: Op[]; deferred: Op[] };

/**
 * 这一轮做什么（D-191）：没有功能操作就是外观；有功能操作只做功能。功能单独套不上、连同外观才套得上时
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
