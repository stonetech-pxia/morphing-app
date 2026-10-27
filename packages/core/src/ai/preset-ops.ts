import type { Locale, WorkspaceConfig } from '../schema';
import { newWorkflowId, presetById, presetWorkflow } from '../workflows/presets';

// 预设的简写（D-259）：AI 写 addWorkflow {presetId, params?, id?, name?}，不写 steps，由 App 用 presetWorkflow()
// 展开成和用户自己添加时完全一样的快捷操作；params 按步骤 ID 覆盖参数。展开在 PlanSchema 之前做，
// 后面的校验（参数是否合法）、修改说明、草稿看到的都是完整的 addWorkflow {workflow}。

const SHORT_KEYS = new Set(['op', 'presetId', 'params', 'id', 'name', 'icon']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 一个 addWorkflow 是不是简写：没有 workflow，或 workflow 里没有 steps 但有 presetId。 */
function shorthand(op: Record<string, unknown>): Record<string, unknown> | null {
  if (op.op !== 'addWorkflow') return null;
  if (op.workflow === undefined) return op;
  if (isRecord(op.workflow) && op.workflow.steps === undefined && 'presetId' in op.workflow) {
    const { workflow, ...rest } = op;
    return { ...rest, ...(workflow as Record<string, unknown>) };
  }
  return null;
}

/**
 * 把模型回复里的预设简写展开。value 是展开后的回复（没有简写时原样返回），issues 是写错的地方
 * （预设 ID 不存在、步骤 ID 不对、多了不认识的键），会发回给模型改正。
 */
export function expandPresetWorkflows(
  reply: unknown,
  config: WorkspaceConfig,
  locale: Locale,
): { value: unknown; issues: string[] } {
  if (!isRecord(reply) || !Array.isArray(reply.ops)) return { value: reply, issues: [] };
  const issues: string[] = [];
  const taken: { id: string }[] = [...config.workflows];
  const ops = reply.ops.map((raw, i) => {
    if (!isRecord(raw)) return raw;
    const op = shorthand(raw);
    if (!op) {
      if (raw.op === 'addWorkflow' && isRecord(raw.workflow) && typeof raw.workflow.id === 'string')
        taken.push({ id: raw.workflow.id });
      return raw;
    }
    const where = `ops.${i}`;
    for (const key of Object.keys(op))
      if (!SHORT_KEYS.has(key))
        issues.push(`${where}: unknown key "${key}" in addWorkflow {presetId}`);
    const preset = typeof op.presetId === 'string' ? presetById(op.presetId) : undefined;
    if (!preset) {
      issues.push(
        `${where}.presetId: unknown preset ${JSON.stringify(op.presetId)}; use an id from the quick-action presets, or write the steps yourself`,
      );
      return raw;
    }
    const id =
      typeof op.id === 'string'
        ? op.id
        : taken.some((w) => w.id === preset.id)
          ? newWorkflowId(preset.id, taken)
          : preset.id;
    taken.push({ id });
    const workflow = presetWorkflow(preset, locale, id);
    if (typeof op.name === 'string') workflow.name = op.name;
    if (typeof op.icon === 'string') workflow.icon = op.icon;
    if (op.params !== undefined) {
      if (!isRecord(op.params)) {
        issues.push(`${where}.params: must be an object of step id → parameters`);
      } else {
        for (const [stepId, params] of Object.entries(op.params)) {
          const step = workflow.steps.find((s) => s.id === stepId);
          if (!step) {
            issues.push(
              `${where}.params.${stepId}: preset "${preset.id}" has no step "${stepId}" (steps: ${workflow.steps.map((s) => s.id).join(', ')})`,
            );
          } else if (!isRecord(params)) {
            issues.push(`${where}.params.${stepId}: must be an object of parameters`);
          } else {
            step.params = { ...step.params, ...params };
          }
        }
      }
    }
    return { op: 'addWorkflow', workflow };
  });
  return { value: { ...reply, ops }, issues };
}
