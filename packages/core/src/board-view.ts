import type { DataRecord } from './data';
import type { FieldOf } from './fields';
import type { RowAction } from './record-ops-schema';
import type { Collection } from './schema';

// 记录列表的两种外观（D-311–D-314）：大圆块 tiles 和看板 board。
// 纯逻辑：圆块最多几个、看板分哪几栏、每栏有哪些记录、拖到另一栏要改成什么；App 只负责画和拖。

/** 大圆块最多显示几个（D-312，待创始人确认）：Streaks 故意限 24 个，一屏能看全。 */
export const MAX_TILES = 24;

/** 看板的一栏：一个选项，或 option 为 null 的「未分」（没有值，或选项已经删掉）。 */
export interface BoardColumn {
  option: string | null;
  label: string | null;
  records: DataRecord[];
}

type ChoiceField = FieldOf<'choice'>;

/** 看板分栏用的单选字段；没有或不是单选时为 undefined（check 会拒绝这种配置）。 */
export function boardField(collection: Collection, groupField: string | undefined) {
  const field = collection.fields.find((f) => f.id === groupField);
  return field?.type === 'choice' ? field : undefined;
}

/**
 * 分栏：按选项顺序每个选项一栏，最后是「未分」。records 已经筛选、排好序；每栏最多 limit 条。
 * 「未分」在必填字段上没有记录时不显示（拖进去也存不了）；不是必填时总显示，可以拖回去清空。
 */
export function boardColumns(
  field: ChoiceField,
  records: readonly DataRecord[],
  limit: number,
): BoardColumn[] {
  const columns: BoardColumn[] = field.options.map((o) => ({
    option: o.id,
    label: o.label,
    records: [],
  }));
  const none: BoardColumn = { option: null, label: null, records: [] };
  for (const r of records) {
    const value = r.values[field.id];
    const column = columns.find((c) => c.option === value) ?? none;
    if (column.records.length < limit) column.records.push(r);
  }
  if (!field.required || none.records.length > 0) columns.push(none);
  return columns;
}

/** 一张卡片可以移到哪几栏：除了它现在所在的那一栏；必填字段不能移到「未分」。 */
export function boardTargets(
  field: ChoiceField,
  columns: readonly BoardColumn[],
  from: string | null,
): BoardColumn[] {
  return columns.filter((c) => c.option !== from && (c.option !== null || !field.required));
}

/**
 * 拖到另一栏（或在「移到…」里选了一栏）：等于一个改这一行的 set（D-314），执行和撤销都走一键操作（D-300）。
 * label 是那一栏的名字（提示条上显示）。
 */
export function boardMoveAction(
  field: ChoiceField,
  option: string | null,
  label: string,
): Extract<RowAction, { do: 'set' }> {
  return { do: 'set', fieldId: field.id, value: option, label };
}
