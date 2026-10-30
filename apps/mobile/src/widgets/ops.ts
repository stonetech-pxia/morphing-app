import {
  RECORD_LIMITS,
  allComponents,
  createInput,
  isKnownComponent,
  isRecordToolUse,
  prepareRecordValues,
  recordToolOf,
  rowUpdateInput,
  type Calendar,
  type Collection,
  type Component,
  type DataRecord,
  type RecordTool,
  type RecordToolUse,
  type ToolUse,
  type WorkspaceConfig,
} from '@morph/core';

import type { WidgetOpRef } from './types';

// 小组件上能点的工具（D-323）：按钮上的「新建一条」和 tiles 每一块的点一下（新建、设值、勾选、加减）。
// 筛出来一起改（setAll）要先确认，「打开表单」要看界面，这两种在小组件上点了打开 App。
// 同一份算法既用来预先算「点了以后」的画面（在内存里的记录上），也用来真正执行（App 取走队列时）。

/** 记录按表分好（只读）。 */
export type RecordsByTable = ReadonlyMap<string, readonly DataRecord[]>;

/** 小组件上能直接执行的一键记录工具：直接存的新建、设值、勾选、加减。 */
type WidgetTool = Exclude<RecordTool, { do: 'setAll' }>;

/** 工具定义的指纹：页面改过（工具换了）以后，之前点的不再执行。 */
export function actionHash(action: ToolUse): string {
  const text = JSON.stringify(action);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function findComponent(config: WorkspaceConfig, id: string): Component | undefined {
  for (const page of config.containers.pages) {
    const c = allComponents(page).find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

/** 能在小组件上直接执行的工具（打开表单的新建要用户填，setAll 要确认，「打开」要看界面）。 */
function widgetTool(use: ToolUse | undefined): WidgetTool | undefined {
  if (!use || !isRecordToolUse(use)) return undefined;
  const tool = recordToolOf(use);
  if (tool.do === 'setAll' || (tool.do === 'create' && tool.ask !== undefined)) return undefined;
  return tool;
}

/** 按钮的工具能不能在小组件上直接执行：能的话返回它（带出现方式，算指纹用）。 */
export function widgetButtonAction(c: Component): RecordToolUse | null {
  if (!isKnownComponent(c) || c.look !== 'button') return null;
  const use = c.tools?.[0];
  return use && widgetTool(use) && isRecordToolUse(use) ? use : null;
}

/** 一条上的工具（tap）能不能在小组件上直接执行。 */
export function widgetRowAction(use: ToolUse | undefined): RecordToolUse | undefined {
  return use && widgetTool(use) && isRecordToolUse(use) ? use : undefined;
}

export const buttonOpKey = (componentId: string) => `b:${componentId}`;
export const rowOpKey = (componentId: string, recordId: string) => `r:${componentId}:${recordId}`;

export type PlannedWrite =
  | { kind: 'insert'; collection: Collection; values: Record<string, unknown> }
  | {
      kind: 'update';
      collection: Collection;
      id: string;
      values: Record<string, unknown>;
      before: Record<string, unknown>;
    };

/**
 * 一次点按要写什么。null：不执行（组件删了、操作改了、记录不在了、表满了、值存不进去）。
 * records 是存着的记录（不是算好的）；时间用点的时间：「今天」是点的那天（D-323）。
 */
export function planWidgetOp(
  config: WorkspaceConfig,
  ref: WidgetOpRef,
  records: RecordsByTable,
  at: Date,
  cal: Calendar,
): PlannedWrite | null {
  const c = findComponent(config, ref.component);
  if (!c || !isKnownComponent(c)) return null;
  const insert = (
    tool: Extract<RecordTool, { do: 'create' }>,
    rowId?: string,
  ): PlannedWrite | null => {
    const collection = config.data.tables.find((x) => x.id === tool.table);
    if (!collection) return null;
    if ((records.get(collection.id)?.length ?? 0) >= RECORD_LIMITS.perCollection) return null;
    const input = createInput(collection, tool.values, { now: at, cal, rowId });
    const prepared = prepareRecordValues(collection, input, null, at, cal);
    return prepared.ok ? { kind: 'insert', collection, values: prepared.values } : null;
  };
  if (ref.record === undefined) {
    const use = widgetButtonAction(c);
    const tool = use && actionHash(use) === ref.hash ? widgetTool(use) : undefined;
    return tool?.do === 'create' ? insert(tool) : null;
  }
  if (c.look !== 'tiles') return null;
  // 按点的时候显示的那个工具：hash 对得上的那个（条件可能已经变了，例如上班后显示「下班」）。
  const tool = widgetTool((c.tools ?? []).find((u) => actionHash(u) === ref.hash));
  if (!tool) return null;
  const listed = records.get(c.source.table)?.find((r) => r.id === ref.record);
  if (!listed) return null;
  if (tool.do === 'create') return insert(tool, listed.id);
  // 改的是工具自己的表里的这一条（关系规则 12）。
  const collection = config.data.tables.find((x) => x.id === tool.table);
  const stored = collection && records.get(collection.id)?.find((r) => r.id === ref.record);
  if (!collection || !stored) return null;
  const input = rowUpdateInput(tool, collection, stored.values, { now: at, cal, rowId: stored.id });
  if (!input) return null;
  const prepared = prepareRecordValues(collection, input, stored.values, at, cal);
  return prepared.ok
    ? {
        kind: 'update',
        collection,
        id: stored.id,
        values: prepared.values,
        before: stored.values,
      }
    : null;
}

/** 在内存里的记录上执行（预先算「点了以后」的画面用）。 */
export function applyInMemory(
  records: RecordsByTable,
  write: PlannedWrite,
  at: Date,
  id: string,
): Map<string, DataRecord[]> {
  const next = new Map(Array.from(records, ([k, v]) => [k, [...v]]));
  const list = next.get(write.collection.id) ?? [];
  const time = at.getTime();
  if (write.kind === 'insert') {
    list.push({
      id,
      collectionId: write.collection.id,
      values: write.values,
      createdAt: time,
      updatedAt: time,
    });
  } else {
    const i = list.findIndex((r) => r.id === write.id);
    if (i >= 0) list[i] = { ...list[i]!, values: write.values, updatedAt: time };
  }
  next.set(write.collection.id, list);
  return next;
}
