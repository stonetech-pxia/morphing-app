import { IO_ACTIONS } from './tools/io';
import type { IconName, Locale, Localized, Page, Workflow } from './schema';
import type { ActionDefinition, Permission } from './workflow/contract';

// 动作与工具的登记表（§6 ActionDefinition / ToolDefinition，§7B Tool Manifest）。
// 只有登记过的动作才能出现在工作流里；动作的实现由 tool-* 包和 App 运行时提供，这里只描述契约。

export interface ToolDefinition {
  id: string;
  version: string;
  name: Localized;
  description: Localized;
  icon: IconName;
  /** 供自然语言解析匹配的别名（小写）。 */
  aliases: readonly string[];
  permissions: readonly Permission[];
  actions: readonly ActionDefinition[];
  createPage(locale: Locale): Page;
  /** 安装时写进配置的工作流（单功能工作流和工具自带的流程，D-061）。 */
  createWorkflows(locale: Locale): Workflow[];
  /** 从服务器下载的工具（D-177）；没有这一项的是随 App 发布的内置工具。 */
  origin?: 'download';
}

/** 内核动作：不属于任何工具，所有工作流都可以使用。 */
export const CORE_ACTIONS: readonly ActionDefinition[] = IO_ACTIONS;

export interface Registry {
  tools: ReadonlyMap<string, ToolDefinition>;
  actions: ReadonlyMap<string, ActionDefinition>;
  /** 动作 → 所属工具；内核动作不在此表中。 */
  actionOwner: ReadonlyMap<string, string>;
}

export function createRegistry(tools: readonly ToolDefinition[]): Registry {
  const toolMap = new Map<string, ToolDefinition>();
  const actions = new Map<string, ActionDefinition>();
  const actionOwner = new Map<string, string>();
  for (const action of CORE_ACTIONS) actions.set(action.id, action);
  for (const tool of tools) {
    if (toolMap.has(tool.id)) throw new Error(`duplicate tool ${tool.id}`);
    toolMap.set(tool.id, tool);
    for (const action of tool.actions) {
      if (!action.id.startsWith(`${tool.id}.`)) {
        throw new Error(`action ${action.id} must be namespaced under ${tool.id}.`);
      }
      if (actions.has(action.id)) throw new Error(`duplicate action ${action.id}`);
      actions.set(action.id, action);
      actionOwner.set(action.id, tool.id);
    }
  }
  return { tools: toolMap, actions, actionOwner };
}

const revisions = new WeakMap<Registry, number>();

/** 注册表改过几次（加入或替换下载的工具时加 1）；提示词按它缓存。 */
export const registryRevision = (registry: Registry) => revisions.get(registry) ?? 0;

/**
 * 加入或替换一个下载的工具（D-177）。直接改这个注册表，用到它的地方（运行、校验、AI）都能看到。
 * 下载的工具没有自己的动作（第一步只组合已有的动作），不能顶替内置工具。
 */
export function registerTool(registry: Registry, tool: ToolDefinition): void {
  if (tool.origin !== 'download') throw new Error(`tool ${tool.id} is not a downloaded tool`);
  if (tool.actions.length > 0) throw new Error(`downloaded tool ${tool.id} must not add actions`);
  const existing = registry.tools.get(tool.id);
  if (existing && existing.origin !== 'download') throw new Error(`tool ${tool.id} is built in`);
  (registry.tools as Map<string, ToolDefinition>).set(tool.id, tool);
  revisions.set(registry, registryRevision(registry) + 1);
}
