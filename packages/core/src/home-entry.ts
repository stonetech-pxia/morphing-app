import { topIndex, type Op } from './ops';
import { HOME_PAGE_ID, allComponents, type WorkspaceConfig } from './schema';

// 首页入口（D-109，易用性排名的方案甲）：AI 新建的工作流不再由 AI 顺手放到首页，
// 而是在预览里单列一项「在首页放一个入口」，用户自己勾选。

const hasRunner = (config: WorkspaceConfig, workflowId: string) =>
  config.pages.some((p) =>
    allComponents(p).some((c) => c.type === 'workflowRunner' && c.props.workflowId === workflowId),
  );

/** 这次修改新建、但哪个页面上都没有运行入口的工作流。 */
export function workflowsWithoutEntry(ops: readonly Op[], after: WorkspaceConfig): string[] {
  return ops.flatMap((op) =>
    op.op === 'addWorkflow' &&
    after.workflows.some((w) => w.id === op.workflow.id) &&
    !hasRunner(after, op.workflow.id)
      ? [op.workflow.id]
      : [],
  );
}

/** 在首页标题之后为这些工作流各加一个运行卡片。 */
export function homeEntryOps(config: WorkspaceConfig, workflowIds: readonly string[]): Op[] {
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID);
  if (!home) return [];
  const used = new Set(config.pages.flatMap((p) => allComponents(p).map((c) => c.id)));
  const at = topIndex(home);
  return workflowIds.map((workflowId, i) => {
    const base = `run-${workflowId}`.slice(0, 40);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
    used.add(id);
    return {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      index: at + i,
      component: { id, type: 'workflowRunner', props: { workflowId } },
    };
  });
}
