import { z } from 'zod';

import type { Registry } from './registry';
import {
  ComponentSchema,
  HOME_PAGE_ID,
  HexColorSchema,
  IdSchema,
  NavTargetSchema,
  PROTECTED_TARGETS,
  ThemeSchema,
  pageTarget,
  type Component,
  type Locale,
  type NavTarget,
  type Page,
  type WorkspaceConfig,
} from './schema';

// 语义化修改操作（§7D）。AI 只能输出这些操作；applyOps 是纯函数，不修改输入。
// apply 只负责执行和引用检查，完整合法性由 validateWorkspace 判定。

const pageId = IdSchema;
const componentId = IdSchema;

export const OpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('setTheme'),
    primaryColor: HexColorSchema.optional(),
    mode: ThemeSchema.shape.mode.optional(),
  }),
  z.strictObject({ op: z.literal('setNavItems'), items: z.array(NavTargetSchema).min(1).max(5) }),
  z.strictObject({ op: z.literal('setPageTitle'), pageId, title: z.string() }),
  z.strictObject({
    op: z.literal('moveComponent'),
    pageId,
    componentId,
    toIndex: z.number().int().min(0),
  }),
  z.strictObject({
    op: z.literal('setComponentProps'),
    pageId,
    componentId,
    props: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ op: z.literal('setComponentHidden'), pageId, componentId, hidden: z.boolean() }),
  z.strictObject({
    op: z.literal('addComponent'),
    pageId,
    component: ComponentSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.strictObject({ op: z.literal('removeComponent'), pageId, componentId }),
  z.strictObject({ op: z.literal('installTool'), toolId: IdSchema }),
  z.strictObject({ op: z.literal('uninstallTool'), toolId: IdSchema }),
  z.strictObject({
    op: z.literal('setStepParams'),
    workflowId: IdSchema,
    stepId: IdSchema,
    params: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ op: z.literal('removeWorkflowStep'), workflowId: IdSchema, stepId: IdSchema }),
]);
export type Op = z.infer<typeof OpSchema>;
export const OpListSchema = z.array(OpSchema).min(1).max(30);

/** apply 过程中系统自动做出的调整，需要在预览中告知用户。 */
export type ApplyNote = { kind: 'movedToFloating'; target: NavTarget };

export type ApplyResult =
  { ok: true; config: WorkspaceConfig; notes: ApplyNote[] } | { ok: false; error: string };

export interface ApplyContext {
  registry: Registry;
  /** 安装工具时，工具页面使用的语言。 */
  locale: Locale;
}

class OpError extends Error {}

function getPage(config: WorkspaceConfig, id: string): Page {
  const page = config.pages.find((p) => p.id === id);
  if (!page) throw new OpError(`page ${id} not found`);
  return page;
}

function getComponentIndex(page: Page, id: string): number {
  const index = page.components.findIndex((c) => c.id === id);
  if (index < 0) throw new OpError(`component ${id} not found on page ${page.id}`);
  return index;
}

/** 第一个非 header 组件的位置；“放到最上面”时放在页面标题之后。 */
export function topIndex(page: Page): number {
  const i = page.components.findIndex((c) => c.type !== 'header');
  return i < 0 ? page.components.length : i;
}

function toolCardIndex(home: Page): number {
  let last = -1;
  home.components.forEach((c, i) => {
    if (c.type === 'toolCard') last = i;
  });
  if (last >= 0) return last + 1;
  const catalog = home.components.findIndex((c) => c.type === 'catalogLink');
  return catalog >= 0 ? catalog : topIndex(home);
}

function applyOne(config: WorkspaceConfig, op: Op, ctx: ApplyContext, notes: ApplyNote[]): void {
  switch (op.op) {
    case 'setTheme': {
      if (op.primaryColor !== undefined) config.theme.primaryColor = op.primaryColor;
      if (op.mode !== undefined) config.theme.mode = op.mode;
      return;
    }
    case 'setNavItems': {
      const items = [...new Set(op.items)];
      config.shell.nav = items;
      config.shell.floating = config.shell.floating.filter((t) => !items.includes(t));
      // 受保护元素被移出导航时，自动改为浮动入口（§3 旅程 A、§5.1）。
      for (const target of PROTECTED_TARGETS) {
        if (!items.includes(target) && !config.shell.floating.includes(target)) {
          config.shell.floating.push(target);
          notes.push({ kind: 'movedToFloating', target });
        }
      }
      return;
    }
    case 'setPageTitle': {
      getPage(config, op.pageId).title = op.title;
      return;
    }
    case 'moveComponent': {
      const page = getPage(config, op.pageId);
      const [component] = page.components.splice(getComponentIndex(page, op.componentId), 1);
      page.components.splice(Math.min(op.toIndex, page.components.length), 0, component!);
      return;
    }
    case 'setComponentProps': {
      const page = getPage(config, op.pageId);
      const component = page.components[getComponentIndex(page, op.componentId)]!;
      // 只合并属性；类型不能通过此操作改变，合法性由 validateWorkspace 检查。
      (component as { props: Record<string, unknown> }).props = { ...component.props, ...op.props };
      return;
    }
    case 'setComponentHidden': {
      const page = getPage(config, op.pageId);
      const component = page.components[getComponentIndex(page, op.componentId)]!;
      if (op.hidden) component.hidden = true;
      else delete component.hidden;
      return;
    }
    case 'addComponent': {
      const page = getPage(config, op.pageId);
      if (page.components.some((c) => c.id === op.component.id)) {
        throw new OpError(`component ${op.component.id} already exists on page ${page.id}`);
      }
      const index = Math.min(op.index ?? page.components.length, page.components.length);
      page.components.splice(index, 0, op.component as Component);
      return;
    }
    case 'removeComponent': {
      const page = getPage(config, op.pageId);
      page.components.splice(getComponentIndex(page, op.componentId), 1);
      return;
    }
    case 'installTool': {
      if (config.tools.some((t) => t.toolId === op.toolId)) {
        throw new OpError(`tool ${op.toolId} is already installed`);
      }
      const def = ctx.registry.tools.get(op.toolId);
      if (!def) throw new OpError(`tool ${op.toolId} is not in the catalog`);
      const page = def.createPage(ctx.locale);
      if (config.pages.some((p) => p.id === page.id)) throw new OpError(`page ${page.id} exists`);
      const workflows = def.createWorkflows(ctx.locale);
      for (const wf of workflows) {
        if (config.workflows.some((w) => w.id === wf.id))
          throw new OpError(`workflow ${wf.id} exists`);
      }
      config.pages.push(page);
      config.workflows.push(...workflows);
      config.tools.push({ toolId: def.id, version: def.version, pageId: page.id });
      const home = getPage(config, HOME_PAGE_ID);
      home.components.splice(toolCardIndex(home), 0, {
        id: `card-${def.id}`,
        type: 'toolCard',
        props: { toolId: def.id },
      });
      return;
    }
    case 'uninstallTool': {
      const tool = config.tools.find((t) => t.toolId === op.toolId);
      if (!tool) throw new OpError(`tool ${op.toolId} is not installed`);
      // 只移除入口、页面和工作流；用户文件不在配置中，不受影响（§7G）。
      config.tools = config.tools.filter((t) => t.toolId !== op.toolId);
      config.pages = config.pages.filter((p) => p.toolId !== op.toolId);
      config.workflows = config.workflows.filter((w) => w.toolId !== op.toolId);
      for (const page of config.pages) {
        page.components = page.components.filter(
          (c) => !(c.type === 'toolCard' && c.props.toolId === op.toolId),
        );
      }
      const target = pageTarget(tool.pageId);
      config.shell.nav = config.shell.nav.filter((t) => t !== target);
      config.shell.floating = config.shell.floating.filter((t) => t !== target);
      return;
    }
    case 'setStepParams': {
      const step = getWorkflow(config, op.workflowId).steps.find((s) => s.id === op.stepId);
      if (!step) throw new OpError(`step ${op.stepId} not found in ${op.workflowId}`);
      step.params = { ...step.params, ...op.params };
      return;
    }
    case 'removeWorkflowStep': {
      const wf = getWorkflow(config, op.workflowId);
      if (!wf.steps.some((s) => s.id === op.stepId)) {
        throw new OpError(`step ${op.stepId} not found in ${op.workflowId}`);
      }
      wf.steps = wf.steps.filter((s) => s.id !== op.stepId);
      return;
    }
  }
}

function getWorkflow(config: WorkspaceConfig, id: string) {
  const wf = config.workflows.find((w) => w.id === id);
  if (!wf) throw new OpError(`workflow ${id} not found`);
  return wf;
}

export function applyOps(
  config: WorkspaceConfig,
  ops: readonly Op[],
  ctx: ApplyContext,
): ApplyResult {
  const next = JSON.parse(JSON.stringify(config)) as WorkspaceConfig;
  const notes: ApplyNote[] = [];
  try {
    for (const op of ops) applyOne(next, op, ctx, notes);
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true, config: next, notes };
}
