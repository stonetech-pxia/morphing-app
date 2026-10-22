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
