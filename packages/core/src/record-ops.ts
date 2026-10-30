import { DEFAULT_CALENDAR, dayOf, type Calendar } from './calendar';
import { conditionProblems } from './conditions';
import {
  matchesCondition,
  prepareRecordValues,
  type DataRecord,
  type PreparedValues,
} from './data';
import { localDateTime, round } from './field-values';
import { expandCollection } from './related';
import {
  RECORD_REF,
  fieldDefinition,
  type Collection,
  type Component,
  type Field,
  type FieldType,
  type WorkspaceConfig,
} from './schema';
import type { ButtonAction, RecordAction, RecordActionValue, RowAction } from './record-ops-schema';

export * from './record-ops-schema';

// 一键记录操作（D-300–D-304，方案 P6）：检查（validate.ts 调）、执行前算出要写的值（App 调）、
// 删字段删表时找出用到它的操作（ops.ts 调）。AI 只配置操作；值在用户点了以后才在本机写进记录。

/** increment 能用的字段（D-302）。 */
export const INCREMENT_FIELD_TYPES: readonly FieldType[] = ['number', 'money', 'duration'];

/** 每种字段能预设成什么（D-301）。不在这里的类型不能预设：文字是用户的内容，算出来的字段不能写。 */
const PRESET_RULES: Partial<Record<FieldType, { expect: string; ok: (v: unknown) => boolean }>> = {
  date: { expect: '"today" or null', ok: (v) => v === 'today' },
  datetime: { expect: '"now" or null', ok: (v) => v === 'now' },
  time: { expect: '"now" or null', ok: (v) => v === 'now' },
  checkbox: { expect: 'true or false', ok: (v) => typeof v === 'boolean' },
  number: { expect: 'a number or null', ok: (v) => typeof v === 'number' },
  money: { expect: 'a number or null', ok: (v) => typeof v === 'number' },
  duration: {
    expect: 'minutes (a number ≥ 0) or null',
    ok: (v) => typeof v === 'number' && v >= 0,
  },
  rating: {
    expect: 'a whole number 1-5 or null',
    ok: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5,
  },
};

const PRESETTABLE =
  'choice, number, money, duration, rating, checkbox, date ("today"), time or datetime ("now") fields';

interface Where {
  /** 问题文字的开头，例如 `quick-log action`。 */
  label: string;
  /** 记录列表每一行的操作：这一行的表（"row" 指它）。 */
  rowOf?: Collection;
  /** 是新建（create）：null 没有意义。 */
  creating?: boolean;
  /** 组件所在页面给哪张表的一条记录用（D-332）："$record" 指那条记录。 */
  recordOf?: string;
}

function valueProblem(
  collection: Collection,
  fieldId: string,
  value: RecordActionValue,
  where: Where,
): string | null {
  const field = collection.fields.find((f) => f.id === fieldId);
  if (!field) {
    return `${where.label}: ${fieldId} is not a field of ${collection.id} (fields: ${collection.fields.map((f) => f.id).join(', ')})`;
  }
  const name = `${collection.id}.${fieldId}`;
  if (field.type === 'link') {
    const ok = where.rowOf
      ? value === 'row' && where.creating && field.collectionId === where.rowOf.id
      : false;
    // D-332：给一条记录用的页面上，新建时引用字段可以设成这条记录。
    const page =
      value === RECORD_REF &&
      where.creating === true &&
      where.recordOf !== undefined &&
      field.collectionId === where.recordOf;
    if (ok || page || (value === null && !where.creating)) return null;
    if (value === RECORD_REF)
      return where.recordOf
        ? `${where.label}: link field ${name} can be "${RECORD_REF}" only when creating and only if it points at ${where.recordOf}`
        : `${where.label}: "${RECORD_REF}" only works on a page for one entry of a table (page.recordOf)`;
    return where.rowOf && where.creating
      ? `${where.label}: link field ${name} can only be "row" (the entry of this row) and must point at ${where.rowOf.id}`
      : `${where.label}: link field ${name} can't be preset; only a row button's create can use "row"`;
  }
  if (field.type === 'checkbox' && value === null) return null;
  if (value === null) {
    return where.creating ? `${where.label}: leave ${name} out instead of null` : null;
  }
  if (field.type === 'choice') {
    if (typeof value === 'string' && field.options.some((o) => o.id === value)) return null;
    return `${where.label}: ${name} is a choice field; the value must be one of its option ids (${field.options.map((o) => o.id).join(', ')}) or null`;
  }
  const rule = PRESET_RULES[field.type];
  if (!rule) {
    return `${where.label}: ${name} is a ${field.type} field and can't be set by a button (text is the user's own; computed fields can't be written). Only ${PRESETTABLE}`;
  }
  return rule.ok(value)
    ? null
    : `${where.label}: ${name} is a ${field.type} field, so the value must be ${rule.expect}`;
}

function createProblems(
  config: WorkspaceConfig,
  collectionId: string,
  values: Record<string, RecordActionValue> | undefined,
  where: Where,
  form?: boolean,
): string[] {
  const collection = config.collections.find((c) => c.id === collectionId);
  if (!collection) return [`${where.label}: data table ${collectionId} does not exist`];
  const problems: string[] = [];
  for (const [id, v] of Object.entries(values ?? {})) {
    const p = valueProblem(collection, id, v, { ...where, creating: true });
    if (p) problems.push(p);
  }
  // 必填、又没有默认值的字段：点一下存不进去。打开表单的（D-328）由用户填。
  if (form) return problems;
  for (const f of collection.fields) {
    const def = fieldDefinition(f.type);
    if (!('required' in f) || !f.required || !def.write || values?.[f.id] !== undefined) continue;
    const hasDefault = ('default' in f && f.default !== undefined) || def.emptyNew !== undefined;
    if (!hasDefault) {
      problems.push(
        `${where.label}: creates an entry in ${collectionId} but required field ${f.id} would be empty; preset it, make it not required, or add form: true so the user fills in the rest`,
      );
    }
  }
  return problems;
}

function fieldProblem(
  collection: Collection,
  fieldId: string,
  where: Where,
  types: readonly FieldType[],
  verb: string,
): string | null {
  const field = collection.fields.find((f) => f.id === fieldId);
  if (!field) return `${where.label}: ${fieldId} is not a field of ${collection.id}`;
  return types.includes(field.type)
    ? null
    : `${where.label}: ${verb} needs a ${types.join(' or ')} field, but ${collection.id}.${fieldId} is ${field.type}`;
}

/** 一个操作的问题（文字发给 AI）。rowOf：记录列表每一行的操作，这一行的表（原样，不是换过的）。 */
export function recordActionProblems(
  action: RecordAction,
  config: WorkspaceConfig,
  where: Where,
): string[] {
  const row = where.rowOf;
  switch (action.do) {
    case 'create':
      return createProblems(
        config,
        action.collectionId,
        action.values,
        where,
        'form' in action && action.form,
      );
    case 'open':
      if ('collectionId' in action && !config.collections.some((c) => c.id === action.collectionId))
        return [`${where.label}: data table ${action.collectionId} does not exist`];
      return [];
    case 'setAll': {
      const collection = config.collections.find((c) => c.id === action.collectionId);
      if (!collection) return [`${where.label}: data table ${action.collectionId} does not exist`];
      const p = valueProblem(collection, action.fieldId, action.value, {
        label: where.label,
      });
      return [
        ...(p ? [p] : []),
        ...conditionProblems(
          action.filter,
          expandCollection(config.collections, collection),
          where.recordOf,
        ).map((x) => `${where.label}: ${x}`),
      ];
    }
    case 'set': {
      const p = valueProblem(row!, action.fieldId, action.value, where);
      return p ? [p] : [];
    }
    case 'toggle': {
      const p = fieldProblem(row!, action.fieldId, where, ['checkbox'], 'toggle');
      return p ? [p] : [];
    }
    case 'increment': {
      const p = fieldProblem(row!, action.fieldId, where, INCREMENT_FIELD_TYPES, 'increment');
      return p ? [p] : [];
    }
  }
}

/** 按钮和记录列表上的操作的问题（validate.ts 对每个组件调）。 */
export function componentActionProblems(
  c: Component,
  config: WorkspaceConfig,
  /** 组件所在页面给哪张表的一条记录用（D-332）。 */
  recordOf?: string,
): string[] {
  if (c.type === 'button') {
    const { target, action } = c.props;
    if ((target === undefined) === (action === undefined))
      return [
        `button ${c.id} needs exactly one of target (open something) or action (change entries)`,
      ];
    return action
      ? recordActionProblems(action, config, {
          label: `button ${c.id} action`,
          ...(recordOf ? { recordOf } : {}),
        })
      : [];
  }
  // D-333：快速添加表单的预设值和新建一样检查（用户填其余的，所以必填不管）。
  if (c.type === 'recordForm')
    return c.props.values
      ? recordActionProblems(
          { do: 'create', collectionId: c.props.collectionId, values: c.props.values, form: true },
          config,
          { label: `form ${c.id} values`, ...(recordOf ? { recordOf } : {}) },
        )
      : [];
  if (c.type !== 'recordList' || !c.props.rowActions) return [];
  const table = config.collections.find((x) => x.id === c.props.collectionId);
  if (!table) return [];
  const view = expandCollection(config.collections, table);
  return c.props.rowActions.flatMap((a) => {
    const where = {
      label: `list ${c.id} row button "${a.label}"`,
      rowOf: table,
      ...(recordOf ? { recordOf } : {}),
    };
    return [
      ...recordActionProblems(a, config, where),
      ...conditionProblems(a.when, view, recordOf).map((x) => `${where.label} when: ${x}`),
    ];
  });
}

// ---- 删字段、删表时（ops.ts）----

/** 被删掉的表或字段。 */
export interface Gone {
  collectionId: string;
  /** 不写：整张表。 */
  fieldId?: string;
}

const usesValues = (values: Record<string, unknown> | undefined, id: string) =>
  values !== undefined && Object.prototype.hasOwnProperty.call(values, id);

/** 按钮的操作用到了被删掉的表或字段：按钮跟着移除。 */
export function buttonActionUses(action: ButtonAction, gone: Gone): boolean {
  if (action.collectionId !== gone.collectionId) return false;
  if (gone.fieldId === undefined) return true;
  const id = gone.fieldId;
  if (action.do === 'create') return usesValues(action.values, id);
  if (action.do === 'setAll')
    return action.fieldId === id || (action.filter ?? []).some((c) => c.field === id);
  return false;
}

/** 列表（表 listOf）每一行的操作用到了被删掉的表或字段：这个按钮从列表里去掉。 */
export function rowActionUses(action: RowAction, listOf: string, gone: Gone): boolean {
  if (action.do === 'create') {
    if (action.collectionId !== gone.collectionId) return false;
    return gone.fieldId === undefined || usesValues(action.values, gone.fieldId);
  }
  if (listOf !== gone.collectionId || gone.fieldId === undefined) return false;
  const id = gone.fieldId;
  if ((action.when ?? []).some((c) => c.field === id)) return true;
  return 'fieldId' in action && action.fieldId === id;
}

// ---- 执行（App 在用户点了以后调）----

export interface ActionContext {
  now: Date;
  cal?: Calendar;
  /** 列表每一行的 create："row" 指这条记录。 */
  rowId?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 操作里的值 → 表单输入（prepareRecordValues 再按字段严格检查）。null = 清空（勾选框是不勾）。 */
export function actionInput(field: Field, value: RecordActionValue, ctx: ActionContext): unknown {
  if (value === null) return field.type === 'checkbox' ? false : '';
  if (value === 'today' && field.type === 'date')
    return dayOf(ctx.now, ctx.cal ?? DEFAULT_CALENDAR);
  if (value === 'now' && field.type === 'datetime') return localDateTime(ctx.now);
  if (value === 'now' && field.type === 'time')
    return `${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())}`;
  if (value === 'row' && field.type === 'link') return ctx.rowId ?? '';
  return value;
}

/** create：新记录的表单输入（只含预设的字段，其余由 prepareRecordValues 套默认值）。 */
export function createInput(
  collection: Collection,
  values: Record<string, RecordActionValue> | undefined,
  ctx: ActionContext,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(values ?? {})) {
    const field = collection.fields.find((f) => f.id === id);
    if (field) input[id] = actionInput(field, v, ctx);
  }
  return input;
}

/**
 * set / toggle / increment：这一条记录（存着的值）要改成什么。字段已经不在了（旧配置）返回 null。
 * 结果再交给 prepareRecordValues。
 */
export function rowUpdateInput(
  action: Extract<RowAction, { do: 'set' | 'toggle' | 'increment' }>,
  collection: Collection,
  values: Record<string, unknown>,
  ctx: ActionContext,
): Record<string, unknown> | null {
  const field = collection.fields.find((f) => f.id === action.fieldId);
  if (!field) return null;
  if (action.do === 'set') return { [field.id]: actionInput(field, action.value, ctx) };
  if (action.do === 'toggle') return { [field.id]: values[field.id] !== true };
  const raw = values[field.id];
  const current = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  const decimals = field.type === 'money' ? 2 : field.type === 'number' ? (field.decimals ?? 4) : 0;
  let next = round(current + action.by, decimals);
  // 时长不能是负数：减到 0 为止。
  if (field.type === 'duration') next = Math.max(0, next);
  return { [field.id]: next };
}

/** 这一行显示哪个按钮：第一个条件都满足的（没有条件就总是）。view 是换过的表（条件可以用查找来的值）。 */
export function shownRowAction(
  actions: readonly RowAction[] | undefined,
  record: DataRecord,
  view: Collection,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): RowAction | undefined {
  return actions?.find((a) =>
    (a.when ?? []).every((cond) => matchesCondition(record, view, cond, now, cal)),
  );
}

export interface SetAllChange {
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * setAll：筛出来、值真的会变的记录，连同改前改后存的值（撤销用改前的）。records 是算好的记录
 * （筛选可以用查找来的值）；写的时候算出来的值会被 prepareRecordValues 去掉。存不进去的记录跳过。
 */
export function setAllChanges(
  action: Extract<ButtonAction, { do: 'setAll' }>,
  collection: Collection,
  view: Collection,
  records: readonly DataRecord[],
  ctx: ActionContext,
): SetAllChange[] {
  const field = collection.fields.find((f) => f.id === action.fieldId);
  if (!field) return [];
  const cal = ctx.cal ?? DEFAULT_CALENDAR;
  const input = { [field.id]: actionInput(field, action.value, ctx) };
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? (field.type === 'checkbox' ? false : null)) ===
    JSON.stringify(b ?? (field.type === 'checkbox' ? false : null));
  const changes: SetAllChange[] = [];
  for (const r of records) {
    if (!(action.filter ?? []).every((c) => matchesCondition(r, view, c, ctx.now, cal))) continue;
    const prepared: PreparedValues = prepareRecordValues(collection, input, r.values, ctx.now, cal);
    if (!prepared.ok || same(prepared.values[field.id], r.values[field.id])) continue;
    changes.push({ id: r.id, before: storedValues(collection, r.values), after: prepared.values });
  }
  return changes;
}

/** 记录里存着的值（去掉算出来的字段：算好的记录副本里有它们）。 */
export function storedValues(
  collection: Collection,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...values };
  for (const f of collection.fields) if (!fieldDefinition(f.type).write) delete out[f.id];
  return out;
}
