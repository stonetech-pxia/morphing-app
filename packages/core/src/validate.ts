import { COMPONENTS } from './components';
import { duplicates, isSystemField, type CheckProblem } from './components/define';
import { conditionProblems } from './conditions';
import { componentActionProblems } from './record-ops';
import { statMinusProblems } from './stat-minus';
import { expandCollection, relatedProblems } from './related';
import type { Registry } from './registry';
import { reminderProblems } from './reminders';
import {
  HOME_PAGE_ID,
  MAX_HOME_SCREEN,
  PROTECTED_TARGETS,
  WorkspaceConfigSchema,
  allComponents,
  componentCollection,
  BACKDROP_TYPES,
  componentDefinition,
  fieldDefinition,
  isKnownComponent,
  pageIdOf,
  workflowTargetId,
  type Component,
  type Condition,
  type OpenTarget,
  type Page,
  type WorkspaceConfig,
} from './schema';
import { contrastProblems } from './theme';
import { presetById } from './workflows/presets';
import { workflowProblems } from './workflow/check';
import { outputTypeOf, type ValueType } from './workflow/contract';

// 变更校验（§7D）：结构 → 引用 → 受保护元素 → 可读性 → 工具与权限 → 工作流数据流。
// 任何配置在保存或渲染之前都必须通过这里。

export interface ValidationIssue {
  code: string;
  message: string;
}

export type ValidationResult =
  { ok: true; config: WorkspaceConfig } | { ok: false; issues: ValidationIssue[] };

export interface ValidateOptions {
  /**
   * 这个版本不认识的组件（D-254，更新的 App 加的）。不写：一律当作结构错误（和以前一样）。
   * 'keep'：原样保留（读取已存的配置、恢复历史版本）。一份配置：只保留这份配置里原样就有的
   * （传 AI 或长按编辑修改前的配置：修改可以移动、删除它们，不能新加或改动）。
   */
  unknownComponents?: 'keep' | WorkspaceConfig;
}

export function validateWorkspace(
  input: unknown,
  registry: Registry,
  options: ValidateOptions = {},
): ValidationResult {
  const unknown = setAsideUnknown(input, options.unknownComponents);
  const parsed = WorkspaceConfigSchema.safeParse(unknown.input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'schema',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      })),
    };
  }
  const config = unknown.restore(parsed.data);
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
    const problem = recordPageTargetProblem(config, target);
    if (problem) issue('record-page', `nav entry ${problem}`);
  }
  // ---- 给一条记录用的页面（D-332）----
  for (const page of config.pages) {
    if (page.recordOf === undefined) continue;
    if (page.id === HOME_PAGE_ID) issue('record-page', 'the home page cannot have recordOf');
    if (!config.collections.some((c) => c.id === page.recordOf))
      issue('record-page', `page ${page.id}: recordOf ${page.recordOf} is not a data table`);
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

  // ---- 组件引用（定义里的 refs，见 components/define.ts）----
  const workflowIds = new Set(config.workflows.map((w) => w.id));
  const componentIssue = (c: Component, problem: CheckProblem) =>
    typeof problem === 'string'
      ? issue('data', `${c.id}: ${problem}`)
      : issue(problem.code, problem.message);
  for (const page of config.pages) {
    for (const c of allComponents(page)) {
      // 不认识的组件（D-254）原样保留，没有可以检查的引用。
      if (!isKnownComponent(c)) continue;
      const def = componentDefinition(c.type);
      if (c.style?.backdrop && !def.edit.backdrop) {
        issue(
          'style',
          `component ${c.id} (${c.type}) can't have a picture background: style.backdrop is only for ${BACKDROP_TYPES.join(', ')}`,
        );
      }
      for (const [prop, ref] of Object.entries(def.refs ?? {})) {
        const value = (c.props as Record<string, unknown>)[prop];
        if (!ref || value === undefined) continue;
        if (ref.to === 'target') {
          const targetPage = pageIdOf(value as OpenTarget);
          if (targetPage !== null && !pageIds.has(targetPage)) {
            issue('unknown-page', `component ${c.id} on page ${page.id} opens missing ${value}`);
          }
          const problem = recordPageTargetProblem(config, value as OpenTarget);
          if (problem) issue('record-page', `component ${c.id} on page ${page.id}: ${problem}`);
          // D-256：快捷操作是配置里的，或者内设的（预设 ID）。
          const targetWorkflow = workflowTargetId(value as OpenTarget);
          if (
            targetWorkflow !== null &&
            !workflowIds.has(targetWorkflow) &&
            !presetById(targetWorkflow)
          ) {
            issue(
              'unknown-workflow',
              `component ${c.id} on page ${page.id} opens missing ${value}`,
            );
          }
        } else if (ref.to === 'tool') {
          for (const toolId of [value].flat() as string[]) {
            if (ref.in === 'installed' && !installed.has(toolId)) {
              issue(
                'unknown-tool',
                `component ${c.id} shows tool ${toolId} which is not installed`,
              );
            } else if (ref.in === 'catalog' && !registry.tools.has(toolId)) {
              issue(
                'unknown-tool',
                `component ${c.id} lists tool ${toolId} which is not in the catalog`,
              );
            }
          }
        } else if (
          ref.to === 'workflow' &&
          !workflowIds.has(value as string) &&
          // 内设快捷操作用预设 ID 运行，不用添加（D-236、D-259）。
          !presetById(value as string)
        ) {
          issue('unknown-workflow', `component ${c.id} runs missing workflow ${value}`);
        }
      }
      // 引用数据表的组件在下面和数据表一起检查。
      if (componentCollection(c) !== null) continue;
      for (const problem of def.check?.(c, { config, registry, page }) ?? [])
        componentIssue(c, problem);
    }
  }

  // ---- 数据表结构与数据组件（docs/DATA_DESIGN.md）----
  for (const id of duplicates(config.collections.map((c) => c.id)))
    issue('duplicate', `collection ${id}`);
  for (const collection of config.collections) {
    for (const id of duplicates(collection.fields.map((f) => f.id))) {
      issue('duplicate', `field ${id} in ${collection.id}`);
    }
    // 每种字段自己的检查（公式能算、引用的表存在、选项不重复……），见 fields/<type>.ts。
    const view = expandCollection(config.collections, collection);
    for (const field of collection.fields) {
      for (const problem of fieldDefinition(field.type).check?.(field, {
        config,
        collection,
        view,
      }) ?? [])
        issue(problem.code, problem.message);
      // 查找、汇总、上一条（D-287–D-290）：定义对不对、会不会绕回自己、叠得太深。
      for (const problem of relatedProblems(field, { config, collection, view }))
        issue(problem.code, problem.message);
    }
  }
  for (const page of config.pages) {
    for (const c of allComponents(page)) {
      for (const problem of dataComponentProblems(c, page, config, registry))
        componentIssue(c, problem);
      // 一键记录操作（D-300–D-304）：按钮和记录列表每一行。
      if (isKnownComponent(c))
        for (const problem of componentActionProblems(c, config, page.recordOf))
          componentIssue(c, problem);
    }
  }

  // ---- 手机桌面（D-271）：长按 Morph 图标的菜单最多放 MAX_HOME_SCREEN 个 ----
  const onHomeScreen = config.workflows.filter((w) => w.homeScreen).map((w) => w.id);
  if (onHomeScreen.length > MAX_HOME_SCREEN) {
    issue(
      'homeScreen',
      `at most ${MAX_HOME_SCREEN} quick actions can be on the phone home screen (now ${onHomeScreen.join(', ')}); take one off first`,
    );
  }
  // ---- 提醒（D-251）----
  for (const id of duplicates((config.reminders ?? []).map((r) => r.id)))
    issue('duplicate', `reminder ${id}`);
  for (const r of config.reminders ?? []) {
    for (const problem of reminderProblems(r, config)) issue('reminder', problem);
  }

  // ---- 工作流：动作登记、参数、权限、相邻两步的类型（§7B、§7C、D-060）----
  for (const wf of config.workflows) {
    let toolDef = undefined;
    if (wf.toolId !== undefined) {
      toolDef = registry.tools.get(wf.toolId);
      if (!installed.has(wf.toolId) || !toolDef) {
        issue(
          'unknown-tool',
          `workflow ${wf.id} belongs to tool ${wf.toolId} which is not installed`,
        );
        continue;
      }
    }
    for (const id of duplicates(wf.steps.map((s) => s.id)))
      issue('duplicate', `step ${id} in ${wf.id}`);
    for (const problem of workflowProblems(wf, registry)) issue(problem.code, problem.message);
    for (const message of recordStepProblems(wf, config, registry)) issue('data', message);
    // 工具自带的工作流只能用该工具声明过的权限；用户自己的工作流由用户逐步确认。
    if (!toolDef) continue;
    for (const step of wf.steps) {
      for (const permission of registry.actions.get(step.action)?.requires ?? []) {
        if (!toolDef.permissions.includes(permission)) {
          issue(
            'permission',
            `${wf.id}/${step.id}: tool ${wf.toolId} did not declare ${permission}`,
          );
        }
      }
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, config };
}

const KNOWN_TYPES = new Set<string>(COMPONENTS.map((d) => d.type));

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isUnknownComponent = (v: unknown): v is Json & { type: string } =>
  isObject(v) && typeof v.type === 'string' && !KNOWN_TYPES.has(v.type);

/** 一份配置里所有不认识的组件（D-254），按 JSON 文本。 */
function unknownComponentTexts(config: WorkspaceConfig): Set<string> {
  return new Set(
    config.pages.flatMap((p) =>
      allComponents(p).flatMap((c) => (isKnownComponent(c) ? [] : [JSON.stringify(c)])),
    ),
  );
}

/**
 * 允许保留的不认识的组件（D-254）先换成同 ID 的分隔线做结构校验（其余问题的文字和位置都不变），
 * 通过以后再换回原来的 JSON。不允许的照常校验，报结构错误。
 */
function setAsideUnknown(
  input: unknown,
  allow: ValidateOptions['unknownComponents'],
): { input: unknown; restore: (config: WorkspaceConfig) => WorkspaceConfig } {
  const none = { input, restore: (config: WorkspaceConfig) => config };
  if (allow === undefined || !isObject(input) || !Array.isArray(input.pages)) return none;
  const allowed = allow === 'keep' ? null : unknownComponentTexts(allow);
  const isAllowed = (c: unknown): c is Json =>
    isUnknownComponent(c) && (allowed === null || allowed.has(JSON.stringify(c)));
  const kept: { page: number; index: number; child?: number; raw: Json }[] = [];
  (input.pages as unknown[]).forEach((page, p) => {
    if (!isObject(page) || !Array.isArray(page.components)) return;
    page.components.forEach((c: unknown, i) => {
      if (isAllowed(c)) kept.push({ page: p, index: i, raw: c });
      else if (isObject(c) && c.type === 'group' && Array.isArray(c.children)) {
        c.children.forEach((child: unknown, j) => {
          if (isAllowed(child)) kept.push({ page: p, index: i, child: j, raw: child });
        });
      }
    });
  });
  if (kept.length === 0) return none;
  const copy = JSON.parse(JSON.stringify(input)) as { pages: { components: Json[] }[] };
  const slot = (pages: { components: Json[] }[], k: (typeof kept)[number]) =>
    k.child === undefined
      ? { list: pages[k.page]!.components, at: k.index }
      : { list: pages[k.page]!.components[k.index]!.children as Json[], at: k.child };
  for (const k of kept) {
    const { list, at } = slot(copy.pages, k);
    const standIn: Json = { id: k.raw.id, type: 'divider', props: {} };
    if (k.raw.hidden !== undefined) standIn.hidden = k.raw.hidden;
    list[at] = standIn;
  }
  return {
    input: copy,
    restore: (config) => {
      const pages = config.pages as unknown as { components: Json[] }[];
      for (const k of kept) {
        const { list, at } = slot(pages, k);
        list[at] = JSON.parse(JSON.stringify(k.raw)) as Json;
      }
      return config;
    },
  };
}

/**
 * 读取记录的步骤要指向存在的数据表；生成 PDF 的字段要是这张表的字段（D-042）。
 * 记一笔（D-187）：表要存在；收文件时表里要有附件字段，收文字时要有长文本或文字字段。
 */
function recordStepProblems(
  wf: WorkspaceConfig['workflows'][number],
  config: WorkspaceConfig,
  registry: Registry,
): string[] {
  const problems: string[] = [];
  let collection: WorkspaceConfig['collections'][number] | undefined;
  let value: ValueType | null = null;
  for (const step of wf.steps) {
    const action = registry.actions.get(step.action);
    if (step.action === 'out.addRecord') {
      const target = config.collections.find((c) => c.id === step.params.collectionId);
      if (!target) {
        problems.push(
          `${wf.id}/${step.id}: data table ${String(step.params.collectionId)} does not exist`,
        );
      } else if (value === 'text') {
        if (!target.fields.some((f) => f.type === 'note' || f.type === 'text'))
          problems.push(
            `${wf.id}/${step.id}: ${target.id} needs a text or long text field for the text`,
          );
      } else if (value !== null && !target.fields.some((f) => f.type === 'file')) {
        problems.push(
          `${wf.id}/${step.id}: ${target.id} needs an attachment (file) field for the files`,
        );
      }
    }
    if (action) value = outputTypeOf(action, step.params, value);
    if (step.action === 'in.records') {
      collection = config.collections.find((c) => c.id === step.params.collectionId);
      if (!collection) {
        problems.push(
          `${wf.id}/${step.id}: data table ${String(step.params.collectionId)} does not exist`,
        );
      }
    }
    if (step.action === 'print.records' && collection && Array.isArray(step.params.fields)) {
      for (const ref of step.params.fields as unknown[]) {
        const ok =
          ref === 'createdAt' || ref === 'updatedAt' || collection.fields.some((f) => f.id === ref);
        if (!ok)
          problems.push(`${wf.id}/${step.id}: ${String(ref)} is not a field of ${collection.id}`);
      }
    }
  }
  return problems;
}

/**
 * 数据组件：表要存在；refs 里的字段要存在、类型对；然后是组件自己的检查；最后是筛选条件。
 * 问题文字会发给 AI，顺序和文字都保持稳定。
 */
function dataComponentProblems(
  c: Component,
  page: Page,
  config: WorkspaceConfig,
  registry: Registry,
): CheckProblem[] {
  const collectionId = componentCollection(c);
  if (collectionId === null || !isKnownComponent(c)) return [];
  const table = config.collections.find((x) => x.id === collectionId);
  if (!table) return [`data table ${collectionId} does not exist`];
  // 查找、汇总、上一条按它们显示的那种字段检查（D-287–D-289）。
  const collection = expandCollection(config.collections, table);
  const def = componentDefinition(c.type);
  const problems: CheckProblem[] = [];
  let filter: Condition[] | undefined;
  for (const [prop, ref] of Object.entries(def.refs ?? {})) {
    const value = (c.props as Record<string, unknown>)[prop];
    if (!ref || value === undefined) continue;
    if (ref.to === 'filter') filter = value as Condition[];
    if (ref.to !== 'field') continue;
    const role = ref.role ?? prop;
    for (const id of [value].flat() as string[]) {
      const field = collection.fields.find((f) => f.id === id);
      if (ref.types) {
        const ok = isSystemField(id)
          ? ref.types.includes('date')
          : field !== undefined && ref.types.includes(field.type);
        if (!ok)
          problems.push(
            `${role} ${id} must be a ${ref.types.join(' or ')} field of ${collection.id}`,
          );
      } else if (!isSystemField(id) && !field) {
        problems.push(`${role} ${id} is not a field of ${collection.id}`);
      }
    }
  }
  problems.push(...(def.check?.(c, { config, registry, page, collection }) ?? []));
  problems.push(...conditionProblems(filter, collection, page.recordOf));
  // 看板按引用分栏（D-341）：groupFilter 筛的是被引用的那张表。
  if (c.type === 'recordList' && c.props.groupFilter) {
    const link = collection.fields.find((f) => f.id === c.props.groupField);
    const other =
      link?.type === 'link'
        ? config.collections.find((x) => x.id === link.collectionId)
        : undefined;
    if (other)
      problems.push(
        ...conditionProblems(
          c.props.groupFilter,
          expandCollection(config.collections, other),
          page.recordOf,
        ).map((p) => `groupFilter: ${p}`),
      );
  }
  // 统计相减（D-327）：被减的那张表和它的筛选。
  if (c.type === 'stat') problems.push(...statMinusProblems(c, collection, config, page.recordOf));
  return problems;
}

/**
 * 给一条记录用的页面（D-332）不能直接打开：不知道是哪一条。导航栏、按钮、快捷入口、提醒打开它时报错，
 * 文字发给 AI（改用这张表的记录列表的 opens）。
 */
export function recordPageTargetProblem(
  config: WorkspaceConfig,
  target: OpenTarget,
): string | null {
  const pageId = pageIdOf(target);
  const page = pageId === null ? undefined : config.pages.find((p) => p.id === pageId);
  if (!page?.recordOf) return null;
  return `${target} opens page ${page.id}, which shows one entry of ${page.recordOf}; it can only be opened from a list of ${page.recordOf} (recordList.opens)`;
}
