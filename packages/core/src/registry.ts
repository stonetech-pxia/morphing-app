import { z } from 'zod';

import { checkNameTemplate } from './naming';
import type { IconName, Locale, Localized, Page, Workflow } from './schema';

// 动作与工具的登记表（§6 ActionDefinition / ToolDefinition，§7B Tool Manifest）。
// 只有登记过的动作才能出现在工作流里；动作的实现由 App 运行时提供，这里只描述契约。

/** 工作流步骤之间传递数据的固定槽位。 */
export type Slot = 'files' | 'document' | 'fileName' | 'savedFile';

export type Permission = 'files.pick' | 'files.write';

export interface ActionDefinition {
  id: string;
  label: Localized;
  params: z.ZodType<Record<string, unknown>>;
  /** 执行前必须已有的槽位。 */
  reads: readonly Slot[];
  /** 有则使用、没有也能执行的槽位。 */
  optionalReads?: readonly Slot[];
  writes: readonly Slot[];
  /** 需要用户在执行过程中操作（选择文件、输入文字）。 */
  interactive: boolean;
  requires: readonly Permission[];
}

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
  createWorkflows(locale: Locale): Workflow[];
}

const nameTemplate = z
  .string()
  .refine((t) => checkNameTemplate(t).ok, { message: 'invalid name template' });

/** 内核动作：不属于任何工具，所有工具的工作流都可以使用。 */
export const CORE_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'ui.askFileName',
    label: { en: 'Name the file', zh: '输入文件名' },
    params: z.strictObject({ defaultTemplate: nameTemplate }),
    reads: ['document'],
    writes: ['fileName'],
    interactive: true,
    requires: [],
  },
  {
    id: 'file.save',
    label: { en: 'Save to workspace', zh: '保存到工作空间' },
    params: z.strictObject({ nameTemplate }),
    reads: ['document'],
    optionalReads: ['fileName'],
    writes: ['savedFile'],
    interactive: false,
    requires: ['files.write'],
  },
];

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
