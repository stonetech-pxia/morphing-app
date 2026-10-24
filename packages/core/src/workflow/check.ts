import type { Registry } from '../registry';
import type { Workflow, WorkflowStep } from '../schema';
import {
  actionAccepts,
  isSourceAction,
  outputTypeOf,
  type ActionDefinition,
  type ValueType,
} from './contract';

// 工作流的静态检查（D-060）：动作登记、参数、运行时询问的参数、相邻两步的类型能否接上。
// 校验器、编辑器（只列出能插入的动作）和执行器共用这里。

export interface StepProblem {
  stepId: string;
  code: 'unknown-action' | 'params' | 'ask' | 'binding' | 'source';
  message: string;
}

/** 解析参数；失败时返回 null。 */
export function parseStepParams(
  action: ActionDefinition,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const parsed = action.params.safeParse(params);
  return parsed.success ? parsed.data : null;
}

/**
 * 每一步执行之后的值类型（下标 i = 第 i 步的输出）。遇到无法确定的步骤（未登记或类型接不上）之后为 null。
 */
export function typesAlong(
  steps: readonly WorkflowStep[],
  registry: Registry,
): (ValueType | null)[] {
  const out: (ValueType | null)[] = [];
  let current: ValueType | null = null;
  let broken = false;
  for (const [i, step] of steps.entries()) {
    const action = registry.actions.get(step.action);
    if (broken || !action) {
      broken = true;
      out.push(null);
      continue;
    }
    if (isSourceAction(action) ? i !== 0 : current === null || !actionAccepts(action, current)) {
      broken = true;
      out.push(null);
      continue;
    }
    current = outputTypeOf(action, step.params, current);
    out.push(current);
  }
  return out;
}

/** 能插入到第 index 步之前的动作（第 0 步只能是输入动作；后面的步骤要能接上前后两步）。 */
export function insertableActions(
  steps: readonly WorkflowStep[],
  index: number,
  registry: Registry,
): ActionDefinition[] {
  const types = typesAlong(steps, registry);
  const before = index === 0 ? null : (types[index - 1] ?? null);
  if (index > 0 && before === null) return [];
  const next = steps[index] ? registry.actions.get(steps[index]!.action) : undefined;
  return [...registry.actions.values()].filter((action) => {
    if (index === 0) {
      // 第一步只能是输入动作，而且原来的第一步（也是输入动作）不能被挤到后面。
      return isSourceAction(action) && (!next || !isSourceAction(next));
    }
    if (isSourceAction(action) || !actionAccepts(action, before!)) return false;
    if (!next) return true;
    const defaults = defaultParams(action);
    const produced = outputTypeOf(action, defaults ?? {}, before);
    return produced !== null && !isSourceAction(next) && actionAccepts(next, produced);
  });
}

/**
 * 新插入一步时的参数：默认参数，否则按界面元数据给每个参数一个初始值（选项取第一个、数字取最小值、
 * 开关为关、文字为空）。结果不一定能通过校验（例如必填的文字），编辑页会提示用户填写。
 */
export function initialParams(action: ActionDefinition): Record<string, unknown> {
  const defaults = defaultParams(action);
  if (defaults) return defaults;
  const params: Record<string, unknown> = {};
  for (const f of action.fields) {
    if (f.showIf || f.kind === 'secret') continue;
    if (f.kind === 'choice') params[f.key] = f.options?.[0]?.value;
    else if (f.kind === 'number') params[f.key] = f.min ?? 0;
    else if (f.kind === 'toggle') params[f.key] = false;
    else if (f.kind === 'fields') params[f.key] = [];
    else params[f.key] = '';
  }
  return params;
}

/** 动作的默认参数：第一个预设，否则参数结构接受空对象时为 {}。 */
export function defaultParams(action: ActionDefinition): Record<string, unknown> | null {
  const preset = action.presets?.[0]?.values;
  if (preset && action.params.safeParse(preset).success) return { ...preset };
  return action.params.safeParse({}).success ? {} : null;
}

export function workflowProblems(wf: Workflow, registry: Registry): StepProblem[] {
  const problems: StepProblem[] = [];
  let current: ValueType | null = null;
  let broken = false;
  for (const [i, step] of wf.steps.entries()) {
    const problem = (code: StepProblem['code'], message: string) =>
      problems.push({ stepId: step.id, code, message: `${wf.id}/${step.id}: ${message}` });
    const action = registry.actions.get(step.action);
    if (!action) {
      problem('unknown-action', `action ${step.action} is not registered`);
      broken = true;
      continue;
    }
    const parsed = action.params.safeParse(step.params);
    if (!parsed.success) {
      problem(
        'params',
        parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; '),
      );
    }
    const keys = new Set(action.fields.map((f) => f.key));
    for (const key of step.ask ?? []) {
      if (!keys.has(key)) problem('ask', `${key} is not a parameter of ${action.id}`);
    }
    if (isSourceAction(action)) {
      if (i !== 0) {
        problem('source', `${action.id} chooses the input and must be the first step`);
        broken = true;
      }
    } else if (i === 0) {
      problem('source', `the first step must choose the input (photos or files), not ${action.id}`);
      broken = true;
    } else if (!broken && current !== null && !actionAccepts(action, current)) {
      problem(
        'binding',
        action.rejects?.includes(current)
          ? `${action.id} does not take ${current}`
          : `${action.id} needs ${action.input.join(' or ')} but the previous step gives ${current}`,
      );
      broken = true;
    }
    if (!broken)
      current = outputTypeOf(action, parsed.success ? parsed.data : step.params, current);
  }
  return problems;
}
