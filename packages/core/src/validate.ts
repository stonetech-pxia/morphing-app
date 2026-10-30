import { COMPONENTS } from './components';
import {
  duplicates,
  isSystemField,
  valueAt,
  type CheckContext,
  type CheckProblem,
} from './components/define';
import { conditionProblems } from './conditions';
import { FILES_COLLECTION, FILES_TABLE } from './files-table';
import { recordToolUseProblems, toolLabelMax, type ToolWhere } from './record-ops';
import {
  PICK_TOOLS,
  isOpenUse,
  isRecordToolUse,
  isToolRefUse,
  type ToolUse,
} from './record-ops-schema';
import { statMinusProblems } from './stat-minus';
import { expandCollection, relatedProblems } from './related';
import type { Registry } from './registry';
import { reminderProblems } from './reminders';
import {
  HOME_PAGE_ID,
  MAX_HOME_SCREEN,
  PROTECTED_TARGETS,
  WorkspaceConfigSchema,
  BACKDROP_TYPES,
  allComponents,
  childrenOf,
  componentCollection,
  componentDefinition,
  fieldDefinition,
  isKnownComponent,
  packageTargetId,
  pageIdOf,
  quickActionsOf,
  remindersOf,
  toolTargetId,
  type Collection,
  type Component,
  type Condition,
  type KnownComponent,
  type OpenTarget,
  type Page,
  type QuickAction,
  type WorkspaceConfig,
} from './schema';
import { contrastProblems } from './theme';
import { presetById } from './workflows/presets';
import { workflowProblems } from './workflow/check';
import { outputTypeOf, type ValueType } from './workflow/contract';

// 变更校验（§7D）：结构 → 引用 → 受保护元素 → 可读性 → 工具与权限 → 快捷操作的数据流。
// 任何配置在保存或渲染之前都必须通过这里。v34「数据 · 容器 · 工具」：块的引用按登记表里的路径查（refs），
// 块上能挂哪些工具按登记表的 tools 查（as、do、ref、open、个数），关系规则 12–14 见各处的注释。

export interface ValidationIssue {
  code: string;
  message: string;
}

export type ValidationResult =
  { ok: true; config: WorkspaceConfig } | { ok: false; issues: ValidationIssue[] };

export interface ValidateOptions {
  /**
   * 这个版本不认识的块（D-254，更新的 App 加的外观，或 v33 迁移来的 look "$unknown"）。不写：一律当作结构错误。
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
  const config = unknown.restore(parsed.data as WorkspaceConfig);
  const issues: ValidationIssue[] = [];
  const issue = (code: string, message: string) => issues.push({ code, message });
  const pages = config.containers.pages;
  const tables = config.data.tables;

  // ---- 唯一性 ----
  const pageIds = new Set(pages.map((p) => p.id));
  for (const id of duplicates(pages.map((p) => p.id))) issue('duplicate', `page ${id}`);
  for (const page of pages) {
    for (const id of duplicates(allComponents(page).map((c) => c.id))) {
      issue('duplicate', `component ${id} on page ${page.id}`);
    }
  }
  for (const id of duplicates(config.packages.map((t) => t.id))) issue('duplicate', `tool ${id}`);
  // 快捷操作和提醒是同一个 ID 空间（tools[]，tool:<id> 和运行记录都按 ID 找）。
  for (const id of duplicates(config.tools.map((t) => t.id)))
    issue('duplicate', `quick action or reminder ${id}`);
  if (!pageIds.has(HOME_PAGE_ID)) issue('missing-home', 'home page is required');

  // ---- 导航与受保护元素（§5.1）----
  const entries = [...config.nav.bar, ...config.nav.floating];
  for (const target of duplicates(entries)) issue('duplicate', `nav entry ${target}`);
  for (const target of entries) {
    const pageId = pageIdOf(target);
    if (pageId !== null && !pageIds.has(pageId)) issue('unknown-page', `nav entry ${target}`);
    const problem = recordPageTargetProblem(config, target);
    if (problem) issue('record-page', `nav entry ${problem}`);
  }
  // ---- 给一条记录用的页面（D-342，page.of）----
  for (const page of pages) {
    if (page.of === undefined) continue;
    if (page.id === HOME_PAGE_ID) issue('record-page', 'the home page cannot have of');
    if (!tables.some((c) => c.id === page.of))
      issue('record-page', `page ${page.id}: of ${page.of} is not a data table`);
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

  // ---- 工具包（界面上叫「工具」）：每个工具包拥有自己的页面 ----
  const installed = new Map(config.packages.map((t) => [t.id, t]));
  for (const pkg of config.packages) {
    if (!registry.tools.has(pkg.id)) issue('unknown-tool', `tool ${pkg.id}`);
    const page = pages.find((p) => p.id === pkg.page);
    if (!page || page.package !== pkg.id) {
      issue('tool-page', `tool ${pkg.id} must own page ${pkg.page}`);
    }
  }
  for (const page of pages) {
    if (page.package !== undefined && !installed.has(page.package)) {
      issue('tool-page', `page ${page.id} belongs to a tool that is not installed`);
    }
  }

  // ---- 块：引用（登记表里的 refs）、工具（登记表里的 tools）、各外观自己的检查、读的数据 ----
  const blockIssue = (c: Component, problem: CheckProblem) =>
    typeof problem === 'string'
      ? issue('data', `${c.id}: ${problem}`)
      : issue(problem.code, problem.message);
  const desk = config.containers.desk;
  const deskPage: Page | undefined =
    desk && (desk.above?.length || desk.below?.length)
      ? { id: '$desk', title: 'Desk', blocks: [...(desk.above ?? []), ...(desk.below ?? [])] }
      : undefined;
  for (const page of deskPage ? [...pages, deskPage] : pages) {
    for (const { block: c, parent } of withParents(page)) {
      // 不认识的块（D-254）原样保留，没有可以检查的引用。
      if (!isKnownComponent(c)) continue;
      const ctx: CheckContext = { config, registry, page, ...(parent ? { parent } : {}) };
      for (const p of blockProblems(c, ctx)) blockIssue(c, p);
    }
  }

  // ---- 数据表结构（docs/DATA_DESIGN.md）----
  for (const id of duplicates(tables.map((c) => c.id))) issue('duplicate', `collection ${id}`);
  for (const collection of tables) {
    for (const id of duplicates(collection.fields.map((f) => f.id))) {
      issue('duplicate', `field ${id} in ${collection.id}`);
    }
    // 每种字段自己的检查（公式能算、引用的表存在、选项不重复……），见 fields/<type>.ts。
    const view = expandCollection(tables, collection);
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

  // ---- 手机桌面（D-271）：长按 Morph 图标的菜单最多放 MAX_HOME_SCREEN 个快捷操作 ----
  const onHomeScreen = config.nav.phoneHomeScreen ?? [];
  const quickActions = quickActionsOf(config);
  const quickActionIds = new Set(quickActions.map((w) => w.id));
  if (onHomeScreen.length > MAX_HOME_SCREEN) {
    issue(
      'homeScreen',
      `at most ${MAX_HOME_SCREEN} quick actions can be on the phone home screen (now ${onHomeScreen.join(', ')}); take one off first`,
    );
  }
  for (const id of duplicates(onHomeScreen))
    issue('duplicate', `nav.phoneHomeScreen lists ${id} twice`);
  for (const id of onHomeScreen)
    if (!quickActionIds.has(id))
      issue(
        'homeScreen',
        `nav.phoneHomeScreen: ${id} is not a quick action in tools (only quick actions can be on the phone home screen)`,
      );

  // ---- 提醒（D-251）----
  for (const r of remindersOf(config)) {
    for (const problem of reminderProblems(r, config)) issue('reminder', problem);
  }

  // ---- 快捷操作：动作登记、参数、权限、相邻两步的类型（§7B、§7C、D-060）----
  for (const wf of quickActions) {
    let toolDef = undefined;
    if (wf.package !== undefined) {
      toolDef = registry.tools.get(wf.package);
      if (!installed.has(wf.package) || !toolDef) {
        issue(
          'unknown-tool',
          `quick action ${wf.id} belongs to tool ${wf.package} which is not installed`,
        );
        continue;
      }
    }
    for (const id of duplicates(wf.steps.map((s) => s.id)))
      issue('duplicate', `step ${id} in ${wf.id}`);
    for (const problem of workflowProblems(wf, registry)) issue(problem.code, problem.message);
    for (const message of recordStepProblems(wf, config, registry)) issue('data', message);
    // 工具包自带的快捷操作只能用该工具包声明过的权限；用户自己的快捷操作由用户逐步确认。
    if (!toolDef) continue;
    for (const step of wf.steps) {
      for (const permission of registry.actions.get(step.action)?.requires ?? []) {
        if (!toolDef.permissions.includes(permission)) {
          issue(
            'permission',
            `${wf.id}/${step.id}: tool ${wf.package} did not declare ${permission}`,
          );
        }
      }
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, config };
}

/** 页面上的块和它外层的分组（两层，按显示顺序）。 */
function withParents(page: Page): { block: Component; parent?: { id: string; look: 'group' } }[] {
  const walk = (list: readonly Component[], parent?: { id: string; look: 'group' }) =>
    list.flatMap((c): { block: Component; parent?: { id: string; look: 'group' } }[] => [
      parent ? { block: c, parent } : { block: c },
      ...walk(childrenOf(c), { id: c.id, look: 'group' }),
    ]);
  return walk(page.blocks);
}

/**
 * 一个块的问题，顺序固定（文字发给 AI）：图片背景 → 打开的目标、工具包 → 读的数据（表、字段、外观自己的检查、
 * 筛选）→ 块上的工具。不读表的块的外观检查在工具之前。
 */
function blockProblems(c: KnownComponent, ctx: CheckContext): CheckProblem[] {
  const { config, registry, page } = ctx;
  const def = componentDefinition(c.look);
  const problems: CheckProblem[] = [];
  if (c.style?.backdrop && !def.edit.backdrop) {
    problems.push({
      code: 'style',
      message: `component ${c.id} (${c.look}) can't have a picture background: style.backdrop is only for ${BACKDROP_TYPES.join(', ')}`,
    });
  }
  for (const [path, ref] of Object.entries(def.refs ?? {})) {
    const value = valueAt(c, path);
    if (!ref || value === undefined) continue;
    if (ref.to === 'target')
      problems.push(...targetProblems(config, value as OpenTarget, `component ${c.id}`, page.id));
    else if (ref.to === 'package') {
      for (const id of [value].flat() as string[]) {
        if (ref.in === 'installed' && !config.packages.some((p) => p.id === id)) {
          problems.push({
            code: 'unknown-tool',
            message: `component ${c.id} shows tool ${id} which is not installed`,
          });
        } else if (ref.in === 'catalog' && !registry.tools.has(id)) {
          problems.push({
            code: 'unknown-tool',
            message: `component ${c.id} lists tool ${id} which is not in the catalog`,
          });
        }
      }
    }
  }
  const tableId = componentCollection(c);
  if (c.look === 'files') problems.push(...filesProblems(c));
  if (tableId === null) {
    problems.push(...(def.check?.(c, ctx) ?? []));
    problems.push(...toolUseProblems(c, ctx, undefined));
    return problems;
  }
  const table = config.data.tables.find((x) => x.id === tableId);
  if (!table) return [...problems, `data table ${tableId} does not exist`];
  // 查找、汇总、上一条按它们显示的那种字段检查（D-287–D-289）。
  const collection = expandCollection(config.data.tables, table);
  let filter: Condition[] | undefined;
  for (const [path, ref] of Object.entries(def.refs ?? {})) {
    const value = valueAt(c, path);
    if (!ref || value === undefined) continue;
    if (ref.to === 'filter') filter = value as Condition[];
    if (ref.to !== 'field') continue;
    const role = ref.role ?? path;
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
  problems.push(...(def.check?.(c, { ...ctx, collection }) ?? []));
  problems.push(...conditionProblems(filter, collection, page.of));
  // 看板按引用分栏（D-351）：source.group.filter 筛的是被引用的那张表。
  const group = (c as { source?: { group?: { by?: string; filter?: Condition[] } } }).source?.group;
  if (group?.filter && group.by !== undefined) {
    const link = collection.fields.find((f) => f.id === group.by);
    const other =
      link?.type === 'link' ? config.data.tables.find((x) => x.id === link.table) : undefined;
    if (other)
      problems.push(
        ...conditionProblems(
          group.filter,
          expandCollection(config.data.tables, other),
          page.of,
        ).map((p) => `source.group.filter: ${p}`),
      );
  }
  // 数字相减（D-337）：被减的那张表和它的筛选。
  if (c.look === 'number') problems.push(...statMinusProblems(c, collection, config, page.of));
  // 记录块上的工具作用在 source 表的一条上（$row）；表单的提交写自己那张表（关系规则 12）。
  problems.push(...toolUseProblems(c, ctx, c.look === 'form' ? undefined : table));
  return problems;
}

/** 文件列表读系统表 $files（Q2）：筛选、排序只能用它的自动字段。 */
function filesProblems(c: Extract<KnownComponent, { look: 'files' }>): string[] {
  const problems = conditionProblems(c.source.filter, FILES_COLLECTION).map(
    (p) => `${FILES_TABLE} ${p}`,
  );
  const sort = c.source.sort?.field;
  if (sort !== undefined && !isSystemField(sort) && sort !== 'name' && sort !== 'size')
    problems.push(`${FILES_TABLE} can be sorted by name, size or createdAt, not ${sort}`);
  return problems;
}

/**
 * opens 的目标（导航，关系规则 6）：页面要在、不能是给一条记录用的页面；tool:<id> 是配置里的快捷操作
 * 或内设快捷操作的预设 ID（只摆出来，不运行；提醒不能被打开，关系规则 13）；package:<id> 要已添加。
 */
function targetProblems(
  config: WorkspaceConfig,
  target: OpenTarget,
  who: string,
  pageId: string,
): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const where = `${who} on page ${pageId}`;
  const page = pageIdOf(target);
  if (page !== null && !config.containers.pages.some((p) => p.id === page)) {
    problems.push({ code: 'unknown-page', message: `${where} opens missing ${String(target)}` });
  }
  const recordPage = recordPageTargetProblem(config, target);
  if (recordPage) problems.push({ code: 'record-page', message: `${where}: ${recordPage}` });
  const tool = toolTargetId(target);
  if (tool !== null) {
    const problem = quickActionRefProblem(config, tool);
    if (problem) problems.push({ code: 'unknown-workflow', message: `${where} opens ${problem}` });
  }
  const pkg = packageTargetId(target);
  if (pkg !== null && !config.packages.some((p) => p.id === pkg)) {
    problems.push({
      code: 'unknown-tool',
      message: `${where} opens tool ${pkg} which is not installed`,
    });
  }
  return problems;
}

/**
 * 块引用的快捷操作（opens tool:<id>、{tool: <id>}）：tools[] 里的快捷操作，或者内设快捷操作的预设 ID
 * （D-236、D-256、D-259，不用添加）。提醒不是能从块上打开、运行的工具（关系规则 13）。没问题时为 null。
 */
function quickActionRefProblem(config: WorkspaceConfig, id: string): string | null {
  const tool = config.tools.find((t) => t.id === id);
  if (tool?.kind === 'quickAction' || (!tool && presetById(id))) return null;
  return tool?.kind === 'reminder'
    ? `${id}, which is a reminder; only a quick action can be opened or run from a block (a reminder only fires at its time)`
    : `missing quick action ${id}`;
}

const AS_NAME = (as: ToolUse['as']) => (as === undefined ? 'without as' : `as "${as}"`);

/**
 * 块上的工具（NEW_FORMAT §3.4）：按登记表的 tools 查出现方式（as）、一键记录的种类（do）、能引用的独立工具（ref）、
 * 行上的「打开」（open）和个数（button ≤3、tap ≤3、其余每种 ≤1）；清单要正好一个打勾、看板的拖动写分栏字段；
 * 然后是每个就地工具自己的问题（record-ops.ts）。rowOf：记录块读的表（工具作用的 $row 是它的一条）。
 */
function toolUseProblems(
  c: KnownComponent,
  { config, page }: CheckContext,
  rowOf: Collection | undefined,
): CheckProblem[] {
  const meta = componentDefinition(c.look).tools;
  const uses = ((c as { tools?: ToolUse[] }).tools ?? []) as ToolUse[];
  const problems: CheckProblem[] = [];
  // 按钮：打开一个地方，或者做一个一键记录工具（v33 的 target / action 二选一）。
  if (c.look === 'button' && c.opens === undefined && uses.length === 0)
    problems.push('a button needs opens (to open something) or tools (one record tool)');
  if (!meta) return problems;
  if (uses.length > meta.max)
    problems.push(`a ${c.look} block has at most ${meta.max} tools (now ${uses.length})`);
  const counts = new Map<string, number>();
  for (const u of uses) counts.set(u.as ?? 'self', (counts.get(u.as ?? 'self') ?? 0) + 1);
  for (const [as, n] of counts) {
    const max = as === 'button' || as === 'tap' ? 3 : 1;
    if (n > max)
      problems.push(
        `a ${c.look} block has at most ${max} tool${max === 1 ? '' : 's'} ${as === 'self' ? 'without as' : `as "${as}"`} (now ${n})`,
      );
  }
  const group = (c as { source?: { group?: { by?: string } } }).source?.group;
  if (c.look === 'checklist' && (counts.get('check') ?? 0) !== 1)
    problems.push(
      'a checklist needs exactly one tool {as: "check", do: "toggle", table, field: <a checkbox field>}',
    );
  uses.forEach((u, i) => {
    const as = u.as ?? 'self';
    const label = `${c.look} ${c.id} ${u.as ?? 'tool'}${u.label ? ` "${u.label}"` : uses.length > 1 ? ` ${i + 1}` : ''}`;
    if (!(meta.as as readonly string[]).includes(as)) {
      problems.push(
        `${label}: ${AS_NAME(u.as)} doesn't fit a ${c.look} block (allowed: ${meta.as.map((a) => (a === 'self' ? 'no as' : a)).join(', ')})`,
      );
      return;
    }
    if (isToolRefUse(u)) {
      const pick = (PICK_TOOLS as readonly string[]).includes(u.tool);
      if (!meta.ref?.includes(pick ? 'pick' : 'quickAction')) {
        problems.push(
          `${label}: a ${c.look} block can't ${pick ? `use ${u.tool}` : 'run a quick action'}`,
        );
        return;
      }
      if (!pick) {
        const problem = quickActionRefProblem(config, u.tool);
        if (problem)
          problems.push({
            code: 'unknown-workflow',
            message: `component ${c.id} runs ${problem}`,
          });
      }
      if (u.label !== undefined || u.when !== undefined)
        problems.push(`${label}: label and when only apply to tools on each entry`);
      return;
    }
    if (isOpenUse(u)) {
      if (!meta.open) {
        problems.push(`${label}: a ${c.look} block can't open an entry`);
        return;
      }
      if (u.as !== 'button' && u.as !== 'tap')
        problems.push(`${label}: opening an entry is a button or tap on each entry`);
      if (u.label === undefined)
        problems.push(`${label}: needs a label (shown on the button and read by screen readers)`);
      else if (u.label.length > toolLabelMax(u.as))
        problems.push(`${label}: label can be at most ${toolLabelMax(u.as)} characters`);
      if (u.opens !== 'record') {
        const target = config.containers.pages.find((p) => p.id === u.opens);
        if (!target) problems.push(`${label}: opens ${u.opens} is not a page`);
        else if (rowOf && target.of !== rowOf.id)
          problems.push(
            `${label}: opens ${u.opens} must be a page for one entry of ${rowOf.id} (of: "${rowOf.id}")`,
          );
      }
      if (u.when && rowOf)
        problems.push(
          ...conditionProblems(u.when, expandCollection(config.data.tables, rowOf), page.of).map(
            (x) => `${label} when: ${x}`,
          ),
        );
      return;
    }
    if (!isRecordToolUse(u)) return;
    if (!meta.do?.includes(u.do)) {
      problems.push(
        `${label}: a ${c.look} block can't have a ${u.do} tool${meta.do ? ` (allowed: ${meta.do.join(', ')})` : ''}`,
      );
      return;
    }
    if (u.as === 'check' && u.do !== 'toggle') {
      problems.push(
        `${label}: the check of a checklist is {do: "toggle", field: <a checkbox field>}`,
      );
      return;
    }
    if (u.as === 'drag') {
      if (u.do !== 'set' || u.field !== group?.by || u.value !== '$group') {
        problems.push(
          `${label}: dragging a card to another column is {as: "drag", do: "set", table, field: ${group?.by ?? '<source.group.by>'}, value: "$group"}`,
        );
        return;
      }
    }
    const where: ToolWhere = {
      label,
      ...(rowOf ? { rowOf } : {}),
      ...(page.of !== undefined ? { recordOf: page.of } : {}),
      ...(c.look === 'form' ? { form: true } : {}),
      ...(u.as === 'drag' && group?.by !== undefined ? { dragField: group.by } : {}),
    };
    problems.push(...recordToolUseProblems(u, config, where));
  });
  return problems;
}

const KNOWN_LOOKS = new Set<string>(COMPONENTS.map((d) => d.look));

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isUnknownBlock = (v: unknown): v is Json & { look: string } =>
  isObject(v) && typeof v.look === 'string' && !KNOWN_LOOKS.has(v.look);

/** 一份配置里所有不认识的块（D-254），按 JSON 文本。 */
function unknownBlockTexts(config: WorkspaceConfig): Set<string> {
  return new Set(
    config.containers.pages.flatMap((p) =>
      allComponents(p).flatMap((c) => (isKnownComponent(c) ? [] : [JSON.stringify(c)])),
    ),
  );
}

/**
 * 允许保留的不认识的块（D-254）先换成同 ID 的分隔线做结构校验（其余问题的文字和位置都不变），
 * 通过以后再换回原来的 JSON。不允许的照常校验，报结构错误。分组里的、里层分组里的也一样。
 */
function setAsideUnknown(
  input: unknown,
  allow: ValidateOptions['unknownComponents'],
): { input: unknown; restore: (config: WorkspaceConfig) => WorkspaceConfig } {
  const none = { input, restore: (config: WorkspaceConfig) => config };
  const containers = isObject(input) ? input.containers : undefined;
  if (allow === undefined || !isObject(containers) || !Array.isArray(containers.pages)) return none;
  const allowed = allow === 'keep' ? null : unknownBlockTexts(allow);
  const isAllowed = (c: unknown): c is Json =>
    isUnknownBlock(c) && (allowed === null || allowed.has(JSON.stringify(c)));
  /** 块在哪：页面下标，然后一串 blocks / children 的下标。 */
  const kept: { page: number; path: number[]; raw: Json }[] = [];
  const walk = (list: unknown[], page: number, path: number[]) =>
    list.forEach((c, i) => {
      if (isAllowed(c)) kept.push({ page, path: [...path, i], raw: c });
      else if (isObject(c) && c.look === 'group' && Array.isArray(c.children))
        walk(c.children as unknown[], page, [...path, i]);
    });
  (containers.pages as unknown[]).forEach((page, p) => {
    if (isObject(page) && Array.isArray(page.blocks)) walk(page.blocks as unknown[], p, []);
  });
  if (kept.length === 0) return none;
  type Pages = { blocks: Json[] }[];
  const slot = (pages: Pages, k: (typeof kept)[number]) => {
    let list = pages[k.page]!.blocks;
    for (const i of k.path.slice(0, -1)) list = list[i]!.children as Json[];
    return { list, at: k.path.at(-1)! };
  };
  const copy = JSON.parse(JSON.stringify(input)) as { containers: { pages: Pages } };
  for (const k of kept) {
    const { list, at } = slot(copy.containers.pages, k);
    const standIn: Json = { id: k.raw.id, look: 'divider' };
    if (k.raw.hidden !== undefined) standIn.hidden = k.raw.hidden;
    list[at] = standIn;
  }
  return {
    input: copy,
    restore: (config) => {
      const pages = config.containers.pages as unknown as Pages;
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
 * 参数名 collectionId 是动作目录（in.records、out.addRecord）的写法，不是配置结构，v34 不改。
 */
function recordStepProblems(
  wf: QuickAction,
  config: WorkspaceConfig,
  registry: Registry,
): string[] {
  const problems: string[] = [];
  let collection: Collection | undefined;
  let value: ValueType | null = null;
  const tables = config.data.tables;
  for (const step of wf.steps) {
    const action = registry.actions.get(step.action);
    if (step.action === 'out.addRecord') {
      const target = tables.find((c) => c.id === step.params.collectionId);
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
      collection = tables.find((c) => c.id === step.params.collectionId);
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
 * 给一条记录用的页面（D-342，page.of）不能直接打开：不知道是哪一条。导航栏、按钮、入口、提醒打开它时报错，
 * 文字发给 AI（改用这张表的记录块的 opens）。
 */
export function recordPageTargetProblem(
  config: WorkspaceConfig,
  target: OpenTarget,
): string | null {
  const pageId = pageIdOf(target);
  const page = pageId === null ? undefined : config.containers.pages.find((p) => p.id === pageId);
  if (!page?.of) return null;
  return `${String(target)} opens page ${page.id}, which shows one entry of ${page.of}; it can only be opened from a list of ${page.of} (the opens of a list, cards, board… block)`;
}
