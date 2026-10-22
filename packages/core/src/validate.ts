import type { Registry, Slot } from './registry';
import {
  HOME_PAGE_ID,
  PROTECTED_TARGETS,
  WorkspaceConfigSchema,
  allComponents,
  componentTarget,
  pageIdOf,
  type WorkspaceConfig,
} from './schema';
import { contrastProblems } from './theme';

// 变更校验（§7D）：结构 → 引用 → 受保护元素 → 可读性 → 工具与权限 → 工作流数据流。
// 任何配置在保存或渲染之前都必须通过这里。

export interface ValidationIssue {
  code: string;
  message: string;
}

export type ValidationResult =
  { ok: true; config: WorkspaceConfig } | { ok: false; issues: ValidationIssue[] };

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function validateWorkspace(input: unknown, registry: Registry): ValidationResult {
  const parsed = WorkspaceConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'schema',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      })),
    };
  }
  const config = parsed.data;
  const issues: ValidationIssue[] = [];
  const issue = (code: string, message: string) => issues.push({ code, message });

  // ---- 唯一性 ----
  const pageIds = new Set(config.pages.map((p) => p.id));
  for (const id of duplicates(config.pages.map((p) => p.id))) issue('duplicate', `page ${id}`);
  for (const page of config.pages) {
    for (const id of duplicates(allComponents(page).map((c) => c.id))) {
      issue('duplicate', `component ${id} on page ${page.id}`);
    }
  }
  for (const id of duplicates(config.tools.map((t) => t.toolId))) issue('duplicate', `tool ${id}`);
  for (const id of duplicates(config.workflows.map((w) => w.id)))
    issue('duplicate', `workflow ${id}`);
  if (!pageIds.has(HOME_PAGE_ID)) issue('missing-home', 'home page is required');

  // ---- 导航与受保护元素（§5.1）----
  const entries = [...config.shell.nav, ...config.shell.floating];
  for (const target of duplicates(entries)) issue('duplicate', `nav entry ${target}`);
  for (const target of entries) {
    const pageId = pageIdOf(target);
    if (pageId !== null && !pageIds.has(pageId)) issue('unknown-page', `nav entry ${target}`);
  }
  for (const target of PROTECTED_TARGETS) {
    if (!entries.includes(target)) {
      issue(
        'protected',
        `${target} must stay in the nav bar or a floating button (it holds the AI and History entries)`,
      );
    }
  }

  // ---- 可读性：主题改坏之后用户必须仍能找到设置（§5.1）----
  for (const problem of contrastProblems(config.theme)) issue('contrast', `theme: ${problem}`);

  // ---- 工具 ----
  const installed = new Map(config.tools.map((t) => [t.toolId, t]));
  for (const tool of config.tools) {
    if (!registry.tools.has(tool.toolId)) issue('unknown-tool', `tool ${tool.toolId}`);
    const page = config.pages.find((p) => p.id === tool.pageId);
    if (!page || page.toolId !== tool.toolId) {
      issue('tool-page', `tool ${tool.toolId} must own page ${tool.pageId}`);
    }
  }
  for (const page of config.pages) {
    if (page.toolId !== undefined && !installed.has(page.toolId)) {
      issue('tool-page', `page ${page.id} belongs to a tool that is not installed`);
    }
  }

  // ---- 组件引用 ----
  const workflowIds = new Set(config.workflows.map((w) => w.id));
  for (const page of config.pages) {
    for (const c of allComponents(page)) {
      const target = componentTarget(c);
      const targetPage = target === null ? null : pageIdOf(target);
      if (targetPage !== null && !pageIds.has(targetPage)) {
        issue('unknown-page', `component ${c.id} on page ${page.id} opens missing ${target}`);
      }
      if (c.type === 'toolCard' && !installed.has(c.props.toolId)) {
        issue(
          'unknown-tool',
          `component ${c.id} shows tool ${c.props.toolId} which is not installed`,
        );
      }
      if (c.type === 'workflowRunner' && !workflowIds.has(c.props.workflowId)) {
        issue('unknown-workflow', `component ${c.id} runs missing workflow ${c.props.workflowId}`);
      }
    }
  }

  // ---- 工作流：动作登记、归属、参数、权限、数据槽（§7B、§7C）----
  for (const wf of config.workflows) {
    const toolDef = registry.tools.get(wf.toolId);
    if (!installed.has(wf.toolId) || !toolDef) {
      issue(
        'unknown-tool',
        `workflow ${wf.id} belongs to tool ${wf.toolId} which is not installed`,
      );
      continue;
    }
    for (const id of duplicates(wf.steps.map((s) => s.id)))
      issue('duplicate', `step ${id} in ${wf.id}`);
    const available = new Set<Slot>();
    for (const step of wf.steps) {
      const where = `${wf.id}/${step.id}`;
      const action = registry.actions.get(step.action);
      if (!action) {
        issue('unknown-action', `${where}: action ${step.action} is not registered`);
        continue;
      }
      const owner = registry.actionOwner.get(step.action);
      if (owner !== undefined && owner !== wf.toolId) {
        issue('foreign-action', `${where}: ${step.action} belongs to another tool`);
      }
      const params = action.params.safeParse(step.params);
      if (!params.success) {
        issue('params', `${where}: ${params.error.issues.map((i) => i.message).join('; ')}`);
      }
      for (const permission of action.requires) {
        if (!toolDef.permissions.includes(permission)) {
          issue('permission', `${where}: tool ${wf.toolId} did not declare ${permission}`);
        }
      }
      for (const slot of action.reads) {
        if (!available.has(slot)) issue('binding', `${where}: needs ${slot} from an earlier step`);
      }
      for (const slot of action.writes) available.add(slot);
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, config };
}
