import {
  RECORD_LIMITS,
  allComponents,
  createInput,
  prepareRecordValues,
  rowUpdateInput,
  type ButtonAction,
  type Calendar,
  type Collection,
  type Component,
  type DataRecord,
  type RecordActionValue,
  type RowAction,
  type WorkspaceConfig,
} from '@morph/core';

import type { WidgetOpRef } from './types';

// 小组件上能点的操作（D-323）：按钮上的「新建一条」和 tiles 每一块的行操作（新建、设值、勾选、加减）。
// 筛出来一起改（setAll）要先确认，「打开表单」要看界面，这两种在小组件上点了打开 App。
// 同一份算法既用来预先算「点了以后」的画面（在内存里的记录上），也用来真正执行（App 取走队列时）。

/** 记录按表分好（只读）。 */
export type RecordsByTable = ReadonlyMap<string, readonly DataRecord[]>;

/** 操作定义的指纹：页面改过（操作换了）以后，之前点的不再执行。 */
export function actionHash(action: ButtonAction | RowAction): string {
  const text = JSON.stringify(action);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function findComponent(config: WorkspaceConfig, id: string): Component | undefined {
  for (const page of config.pages) {
    const c = allComponents(page).find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

/** 按钮的操作能不能在小组件上直接执行。 */
export function widgetButtonAction(c: Component): Extract<ButtonAction, { do: 'create' }> | null {
  if (c.type !== 'button' || !c.props.action) return null;
  return c.props.action.do === 'create' ? c.props.action : null;
}

/** 行操作能不能在小组件上直接执行（open 打开 App）。 */
export function widgetRowAction(
  a: RowAction | undefined,
): Exclude<RowAction, { do: 'open' }> | undefined {
  return a !== undefined && a.do !== 'open' ? a : undefined;
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
  if (!c) return null;
  const insert = (
    action: { collectionId: string; values?: Record<string, RecordActionValue> },
    rowId?: string,
  ): PlannedWrite | null => {
    const collection = config.collections.find((x) => x.id === action.collectionId);
    if (!collection) return null;
    if ((records.get(collection.id)?.length ?? 0) >= RECORD_LIMITS.perCollection) return null;
    const input = createInput(collection, action.values, { now: at, cal, rowId });
    const prepared = prepareRecordValues(collection, input, null, at, cal);
    return prepared.ok ? { kind: 'insert', collection, values: prepared.values } : null;
  };
  if (ref.record === undefined) {
    const action = widgetButtonAction(c);
    return action && actionHash(action) === ref.hash ? insert(action) : null;
  }
  if (c.type !== 'recordList') return null;
  const collection = config.collections.find((x) => x.id === c.props.collectionId);
  const stored = collection && records.get(collection.id)?.find((r) => r.id === ref.record);
  if (!collection || !stored) return null;
  // 按点的时候显示的那个按钮：hash 对得上的那个（条件可能已经变了，例如上班后显示「下班」）。
  const action = widgetRowAction(
    (c.props.rowActions ?? []).find((a) => actionHash(a) === ref.hash),
  );
  if (!action) return null;
  if (action.do === 'create') return insert(action, stored.id);
  const input = rowUpdateInput(action, collection, stored.values, { now: at, cal });
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
