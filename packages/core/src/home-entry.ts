import { topIndex, type Op } from './ops';
import { isToolRefUse } from './record-ops-schema';
import {
  HOME_PAGE_ID,
  allComponents,
  isKnownComponent,
  quickActionsOf,
  type WorkspaceConfig,
} from './schema';

// 首页入口（D-109，易用性排名的方案甲）：AI 新建的快捷操作不再由 AI 顺手放到首页，
// 而是在预览里单列一项「在首页放一个入口」，用户自己勾选。

const hasRunner = (config: WorkspaceConfig, id: string) =>
  config.containers.pages.some((p) =>
    allComponents(p).some(
      (c) =>
        isKnownComponent(c) &&
        c.look === 'action' &&
        c.tools.some((u) => isToolRefUse(u) && u.tool === id),
    ),
  );

/** 这次修改新建、但哪个页面上都没有运行它的块（look action）的快捷操作。 */
export function workflowsWithoutEntry(ops: readonly Op[], after: WorkspaceConfig): string[] {
  return ops.flatMap((op) => {
    if (op.op !== 'addTool' || typeof op.tool === 'string' || op.tool.kind !== 'quickAction')
      return [];
    const id = op.tool.id;
    return quickActionsOf(after).some((w) => w.id === id) && !hasRunner(after, id) ? [id] : [];
  });
}

/** 在首页标题之后为这些快捷操作各加一个运行它的块。 */
export function homeEntryOps(config: WorkspaceConfig, workflowIds: readonly string[]): Op[] {
  const home = config.containers.pages.find((p) => p.id === HOME_PAGE_ID);
  if (!home) return [];
  const used = new Set(config.containers.pages.flatMap((p) => allComponents(p).map((c) => c.id)));
  const at = topIndex(home);
  return workflowIds.map((tool, i) => {
    const base = `run-${tool}`.slice(0, 40);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
    used.add(id);
    return {
      op: 'addContainer',
      page: HOME_PAGE_ID,
      index: at + i,
      block: { id, look: 'action', tools: [{ tool }] },
    };
  });
}
