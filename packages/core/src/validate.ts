import { formulaType, parseFormula } from './formula';
import type { Registry } from './registry';
import {
  HOME_PAGE_ID,
  PROTECTED_TARGETS,
  WorkspaceConfigSchema,
  PERIODS,
  allComponents,
  componentTarget,
  pageIdOf,
  type Collection,
  type Component,
  type Condition,
  type WorkspaceConfig,
} from './schema';
import { contrastProblems } from './theme';
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
      if (c.type === 'toolGrid') {
        for (const toolId of c.props.toolIds ?? []) {
          if (!registry.tools.has(toolId)) {
            issue(
              'unknown-tool',
              `component ${c.id} lists tool ${toolId} which is not in the catalog`,
            );
          }
        }
        for (const toolId of duplicates(c.props.toolIds ?? [])) {
          issue('duplicate', `tool ${toolId} in component ${c.id}`);
        }
      }
      if (c.type === 'button' && c.props.variant === 'icon' && !c.props.icon) {
        issue('schema', `icon button ${c.id} on page ${page.id} needs an icon`);
      }
      if (c.type === 'workflowRunner' && !workflowIds.has(c.props.workflowId)) {
        issue('unknown-workflow', `component ${c.id} runs missing workflow ${c.props.workflowId}`);
      }
    }
  }

  // ---- 数据表结构与数据组件（docs/DATA_DESIGN.md）----
  for (const id of duplicates(config.collections.map((c) => c.id)))
    issue('duplicate', `collection ${id}`);
  for (const collection of config.collections) {
    for (const id of duplicates(collection.fields.map((f) => f.id))) {
      issue('duplicate', `field ${id} in ${collection.id}`);
    }
    for (const field of collection.fields) {
      if (field.type === 'formula') {
        for (const problem of formulaProblems(field.expression, collection))
          issue('data', `${collection.id}.${field.id}: ${problem}`);
        continue;
      }
      if (field.type !== 'choice') continue;
      for (const id of duplicates(field.options.map((o) => o.id))) {
        issue('duplicate', `option ${id} in ${collection.id}.${field.id}`);
      }
      if (field.default !== undefined && !field.options.some((o) => o.id === field.default)) {
        issue('data', `${collection.id}.${field.id}: default ${field.default} is not an option`);
      }
    }
  }
  for (const page of config.pages) {
    for (const c of allComponents(page)) {
      for (const problem of dataComponentProblems(c, config)) issue('data', `${c.id}: ${problem}`);
    }
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

const NUMERIC = ['number', 'money', 'rating', 'formula'];

/**
 * 公式（D-188）：能解析，引用的字段都在这张表里，而且是数字、金额、评分或日期（不引用别的公式）；
 * 日期只能用在 days() 和比较里，结果是数字（D-247）。
 */
function formulaProblems(expression: string, collection: Collection): string[] {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return [`formula "${expression}": ${parsed.error}`];
  const problems: string[] = [];
  for (const id of parsed.refs) {
    const ref = collection.fields.find((f) => f.id === id);
    if (!ref) problems.push(`formula uses ${id}, which is not a field of ${collection.id}`);
    else if (!['number', 'money', 'rating', 'date'].includes(ref.type))
      problems.push(`formula uses ${id}, which is not a number, money, rating or date field`);
  }
  if (problems.length > 0) return problems;
  const type = formulaType(parsed.node, (id) => {
    const ref = collection.fields.find((f) => f.id === id);
    return ref?.type === 'date' ? 'date' : 'number';
  });
  if (typeof type !== 'string') return [`formula "${expression}": ${type.error}`];
  if (type !== 'number')
    return [`formula "${expression}" gives a date; use days(from, to) to get a number`];
  return [];
}

/** 数据组件引用的表、字段和筛选条件是否合法。 */
function dataComponentProblems(c: Component, config: WorkspaceConfig): string[] {
  if (c.type !== 'recordList' && c.type !== 'recordForm' && c.type !== 'stat') return [];
  const collection = config.collections.find((x) => x.id === c.props.collectionId);
  if (!collection) return [`data table ${c.props.collectionId} does not exist`];
  const problems: string[] = [];
  const field = (id: string) => collection.fields.find((f) => f.id === id);
  const ref = (id: string, role: string) => {
    if (id !== 'createdAt' && id !== 'updatedAt' && !field(id)) {
      problems.push(`${role} ${id} is not a field of ${collection.id}`);
    }
  };
  switch (c.type) {
    case 'recordList': {
      ref(c.props.titleField, 'titleField');
      for (const f of c.props.subtitleFields ?? []) ref(f, 'subtitleField');
      if (c.props.trailingField) ref(c.props.trailingField, 'trailingField');
      if (c.props.display === 'checklist') {
        const check = c.props.checkField ? field(c.props.checkField) : undefined;
        if (check?.type !== 'checkbox')
          problems.push('a checklist needs checkField set to a checkbox field');
      } else if (c.props.checkField !== undefined) {
        ref(c.props.checkField, 'checkField');
      }
      if (c.props.sort) ref(c.props.sort.field, 'sort field');
      problems.push(...conditionProblems(c.props.filter, collection));
      break;
    }
    case 'recordForm':
      for (const id of c.props.fieldIds) {
        const f = field(id);
        if (!f) problems.push(`form field ${id} does not exist`);
        // 公式算出来、附件由快捷操作存进来（D-187、D-188）：表单里填不了。
        else if (f.type === 'formula' || f.type === 'file')
          problems.push(`form field ${id} is a ${f.type} field and cannot be filled in a form`);
      }
      for (const id of duplicates(c.props.fieldIds))
        problems.push(`form field ${id} is listed twice`);
      break;
    case 'stat': {
      if (c.props.aggregate !== 'count') {
        const f = c.props.fieldId ? field(c.props.fieldId) : undefined;
        if (!f || !NUMERIC.includes(f.type)) {
          problems.push(
            `${c.props.aggregate} needs fieldId set to a number, money, rating or formula field`,
          );
        }
      }
      problems.push(...conditionProblems(c.props.filter, collection));
      break;
    }
  }
  return problems;
}

function conditionProblems(conditions: Condition[] | undefined, collection: Collection): string[] {
  const problems: string[] = [];
  for (const cond of conditions ?? []) {
    const system = cond.field === 'createdAt' || cond.field === 'updatedAt';
    const f = collection.fields.find((x) => x.id === cond.field);
    if (!system && !f) {
      problems.push(`filter field ${cond.field} is not a field of ${collection.id}`);
      continue;
    }
    const type = system ? 'date' : f!.type;
    const v = cond.value;
    const where = `filter on ${cond.field}`;
    switch (cond.op) {
      case 'isEmpty':
      case 'isNotEmpty':
        break;
      case 'inPeriod':
        if (type !== 'date') problems.push(`${where}: inPeriod needs a date field`);
        else if (!(PERIODS as readonly unknown[]).includes(v)) {
          problems.push(`${where}: period must be one of ${PERIODS.join(', ')}`);
        }
        break;
      case 'contains':
        if (type !== 'text' && type !== 'note')
          problems.push(`${where}: contains needs a text field`);
        else if (typeof v !== 'string') problems.push(`${where}: value must be text`);
        break;
      case 'gt':
      case 'lt':
        if (
          NUMERIC.includes(type) ? typeof v !== 'number' : type !== 'date' || typeof v !== 'string'
        ) {
          problems.push(`${where}: ${cond.op} needs a number or date field and a matching value`);
        }
        break;
      case 'is':
      case 'isNot': {
        const ok =
          f?.type === 'choice'
            ? f.options.some((o) => o.id === v)
            : type === 'checkbox'
              ? typeof v === 'boolean'
              : NUMERIC.includes(type)
                ? typeof v === 'number'
                : typeof v === 'string';
        if (!ok) problems.push(`${where}: value does not match the field type`);
        break;
      }
    }
  }
  return problems;
}
