import { isSystemField } from './components/define';
import { deskActionFits } from './desk/tools';
import type { DeskKind } from './desk/model';
import type { DeskTool } from './desk/layout';
import type { Registry } from './registry';
import { allComponents, isKnownComponent, quickActionsOf, type WorkspaceConfig } from './schema';
import { handedInput } from './workflow/check';
import { findWorkflowTarget, presetById } from './workflows/presets';

// 底线 18 的一部分引用（审计 F3）：这些写错了不影响运行（不读的字段、显示时过滤掉的工具栏项），已经存下来的配置里
// 可能有，所以不进 validateWorkspace（底线 12：旧配置要还能打开）。只在修改时查（change.ts）：修改不能多出新的。

/** 数字块、图表、minus 上写着 field，但这张表没有这个字段（计数、按日子算时不读它，校验器不查）。 */
function fieldProblems(config: WorkspaceConfig): string[] {
  const problems: string[] = [];
  const check = (who: string, tableId: string, field: string | undefined) => {
    const table = config.data.tables.find((t) => t.id === tableId);
    if (field === undefined || !table || isSystemField(field)) return;
    if (!table.fields.some((f) => f.id === field))
      problems.push(
        `${who}: field ${field} is not a field of ${tableId}; leave field out (only sum, avg, min and max read it)`,
      );
  };
  for (const page of config.containers.pages)
    for (const c of allComponents(page)) {
      if (!isKnownComponent(c) || (c.look !== 'number' && c.look !== 'chart')) continue;
      check(c.id, c.source.table, c.source.field);
      if (c.look === 'number' && c.source.minus)
        check(`${c.id} minus`, c.source.minus.table, c.source.minus.field);
    }
  return problems;
}

/** 文件桌面工具栏上的一项：这种文件能用的动作（规格也要有），或者一个快捷操作。 */
function deskItemProblem(
  item: DeskTool,
  kind: DeskKind,
  config: WorkspaceConfig,
  registry: Registry,
): string | null {
  if (typeof item === 'string') {
    if (quickActionsOf(config).some((w) => w.id === item) || presetById(item)) {
      const wf = findWorkflowTarget(quickActionsOf(config), item, 'en');
      return wf && handedInput(wf.steps, registry)
        ? `${item} takes what a container hands over (a record, a value or attachments); it can't go on a toolbar`
        : null;
    }
    // 文字不分提醒和不存在：旧配置里的项，提醒删掉后不能变成「新」问题，挡住那次删除。
    return `${item} is not a quick action (reminders can't go on a toolbar); use the id of a quick action or a built-in one`;
  }
  const action = registry.actions.get(item.action);
  if (!action) return `action ${item.action} is not in the catalog`;
  if (!deskActionFits(action, kind)) return `action ${item.action} can't work on ${kind} files`;
  if (item.preset !== undefined && !action.presets?.some((p) => p.id === item.preset))
    return `action ${item.action} has no preset ${item.preset}; leave preset out`;
  return null;
}

function deskProblems(config: WorkspaceConfig, registry: Registry): string[] {
  const tools = config.containers.desk?.tools;
  if (!tools) return [];
  return (Object.keys(tools) as DeskKind[]).flatMap((kind) =>
    (tools[kind] ?? [])
      .flatMap((g) => g.items)
      .map((item) => deskItemProblem(item, kind, config, registry))
      .filter((p) => p !== null)
      .map((p) => `containers.desk.tools.${kind}: ${p}`),
  );
}

function presetProblems(config: WorkspaceConfig): string[] {
  return quickActionsOf(config)
    .filter((wf) => wf.preset !== undefined && !presetById(wf.preset))
    .map((wf) => `quick action ${wf.id}: preset ${wf.preset} is not a built-in quick action`);
}

/** 这份配置里所有这类问题（文字发给 AI，也用来比较修改前后）。 */
export function referenceProblems(config: WorkspaceConfig, registry: Registry): string[] {
  return [...fieldProblems(config), ...deskProblems(config, registry), ...presetProblems(config)];
}
