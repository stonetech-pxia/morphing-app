import type { Locale, WorkspaceConfig } from '../schema';
import { newWorkflowId, presetById, presetWorkflow } from '../workflows/presets';

// 预设的简写（D-259）：AI 写 addTool {tool: {preset, params?, id?, name?, icon?}}，不写 steps，由 App 用
// presetWorkflow() 展开成和用户自己添加时完全一样的快捷操作；params 按步骤 ID 覆盖参数。展开在 PlanSchema 之前做，
// 后面的校验（参数是否合法）、修改说明、草稿看到的都是完整的 addTool {tool: {kind: "quickAction", …}}。
// 也接受把这几个键直接写在操作上（addTool {preset, …}，和 v33 的 addWorkflow {presetId} 一样）。

const SHORT_KEYS = new Set(['kind', 'preset', 'params', 'id', 'name', 'icon']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 一个 addTool 是不是简写：没有 tool 而有 preset，或 tool 是没有 steps、有 preset 的快捷操作。 */
function shorthand(op: Record<string, unknown>): Record<string, unknown> | null {
  if (op.op !== 'addTool') return null;
  if (op.tool === undefined && 'preset' in op) {
    const { op: _, ...rest } = op;
    return rest;
  }
  const tool = op.tool;
  if (
    isRecord(tool) &&
    tool.steps === undefined &&
    'preset' in tool &&
    (tool.kind === undefined || tool.kind === 'quickAction')
  ) {
    const { op: _, tool: _t, ...rest } = op;
    return { ...rest, ...tool };
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
  // 快捷操作和提醒共用一套 ID。
  const taken: { id: string }[] = [...config.tools];
  const ops = reply.ops.map((raw, i) => {
    if (!isRecord(raw)) return raw;
    const short = shorthand(raw);
    if (!short) {
      if (raw.op === 'addTool' && isRecord(raw.tool) && typeof raw.tool.id === 'string')
        taken.push({ id: raw.tool.id });
      return raw;
    }
    const where = `ops.${i}`;
    for (const key of Object.keys(short))
      if (!SHORT_KEYS.has(key)) issues.push(`${where}: unknown key "${key}" in addTool {preset}`);
    const preset = typeof short.preset === 'string' ? presetById(short.preset) : undefined;
    if (!preset) {
      issues.push(
        `${where}.preset: unknown preset ${JSON.stringify(short.preset)}; use an id from the quick-action presets, or write the steps yourself`,
      );
      return raw;
    }
    const id =
      typeof short.id === 'string'
        ? short.id
        : taken.some((w) => w.id === preset.id)
          ? newWorkflowId(preset.id, taken)
          : preset.id;
    taken.push({ id });
    const tool = presetWorkflow(preset, locale, id);
    if (typeof short.name === 'string') tool.name = short.name;
    if (typeof short.icon === 'string') tool.icon = short.icon;
    if (short.params !== undefined) {
      if (!isRecord(short.params)) {
        issues.push(`${where}.params: must be an object of step id → parameters`);
      } else {
        for (const [stepId, params] of Object.entries(short.params)) {
          const step = tool.steps.find((s) => s.id === stepId);
          if (!step) {
            issues.push(
              `${where}.params.${stepId}: preset "${preset.id}" has no step "${stepId}" (steps: ${tool.steps.map((s) => s.id).join(', ')})`,
            );
          } else if (!isRecord(params)) {
            issues.push(`${where}.params.${stepId}: must be an object of parameters`);
          } else {
            step.params = { ...step.params, ...params };
          }
        }
      }
    }
    return { op: 'addTool', tool };
  });
  return { value: { ...reply, ops }, issues };
}
