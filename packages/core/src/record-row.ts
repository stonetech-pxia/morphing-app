import { fieldLink } from './field-link';
import type { Registry } from './registry';
import { findWorkflowTarget } from './workflows/presets';
import type { Collection, Field, Locale, QuickAction, Workflow } from './schema';
import { handedInput } from './workflow/check';
import type { DataRecord } from './data';
import type { RunValue } from './workflow/engine';

// 记录页顶部的一排按钮（D-428，取代 D-423 写死的那排）：data.tables[].recordRow 说有哪些，这里按现在的值算出
// 哪些能用。纯函数：看的时候只读，点了才运行（底线 10、15）。和表是什么无关，只看配置、动作和字段的 format。

export interface RecordRowButton {
  key: string;
  workflow: Workflow;
  /** 交这个字段的值。不写：交这一条记录。 */
  field?: Field;
  /** 字段的值（收文字的快捷操作）。 */
  text?: string;
  /** 同一个快捷操作出现了不止一次（两个电话字段）：按钮上要写字段名才分得清。 */
  showField: boolean;
}

/** 值是空的、对不上（fieldLink）、记录用不了这个动作（做不出 vCard）的按钮不出现。 */
export function recordRowButtons(
  table: Collection,
  quickActions: readonly QuickAction[],
  registry: Registry,
  locale: Locale,
  values: Readonly<Record<string, unknown>>,
): RecordRowButton[] {
  const row = table.recordRow ?? [];
  const buttons: RecordRowButton[] = [];
  for (const item of row) {
    const workflow = findWorkflowTarget(quickActions, item.tool, locale);
    if (!workflow) continue;
    const takes = handedInput(workflow.steps, registry);
    const actions = workflow.steps.map((s) => registry.actions.get(s.action));
    const key = `${item.tool}${item.field ? `-${item.field}` : ''}`;
    if (takes === 'records') {
      const first = actions[0];
      if (first?.recordFits && !first.recordFits(table.fields, values)) continue;
      buttons.push({ key, workflow, showField: false });
    } else if (takes === 'text') {
      const field = table.fields.find((f) => f.id === item.field);
      const raw = field && values[field.id];
      if (!field || typeof raw !== 'string' || raw.trim() === '') continue;
      const opens = actions.find((a) => a?.opensLink)?.opensLink;
      if (opens && !linkFits(field, raw, opens)) continue;
      buttons.push({
        key,
        workflow,
        field,
        text: raw,
        showField: row.filter((other) => other.tool === item.tool).length > 1,
      });
    }
  }
  return buttons;
}

/** 这个字段的值能不能当这种链接打开：只由 fieldLink 判断（D-422）。 */
function linkFits(
  field: Field,
  value: string,
  opens: 'phone' | 'message' | 'email' | 'url',
): boolean {
  const link = fieldLink(field, value, opens === 'message' ? 'message' : undefined);
  return link?.kind === opens;
}

/** 按钮交给第一步的值。record：这一条，值已经是框里现在的（还没保存的修改也算）。 */
export function recordRowValue(
  button: RecordRowButton,
  table: Collection,
  record: DataRecord,
): RunValue {
  if (button.text !== undefined) {
    return { type: 'text', text: button.text.trim(), name: button.field?.name ?? table.name };
  }
  return recordsValue(table, [record]);
}

/** 一条或几条记录作为工具的输入：单条记录块、列表都走这里（底线 17：交的就是看到的这些）。 */
export const recordsValue = (table: Collection, records: DataRecord[]): RunValue => ({
  type: 'records',
  collectionId: table.id,
  records,
  name: table.name,
});

/**
 * 在原地跑、不打开运行页面的情况（D-428）：一个值或一条记录、最后一步把它交给 App 外面（拨号、分享面板）。
 * 这时没有结果可看。别的（很多条、结果留在 App 里）打开运行页面，能看进度和结果。
 */
export function runsInPlace(workflow: Workflow, value: RunValue): boolean {
  const small = value.type === 'text' || (value.type === 'records' && value.records.length === 1);
  return small && /^out\./.test(workflow.steps[workflow.steps.length - 1]?.action ?? '');
}
