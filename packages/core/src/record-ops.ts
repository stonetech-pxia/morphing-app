import { DEFAULT_CALENDAR, calendarOf, dayOf, type Calendar } from './calendar';
import { SMART_DATE_TYPES } from './components/form';
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
  recordToolOf,
  type RecordTool,
  type RecordToolUse,
  type RecordToolValue,
  type RecordToolValues,
  type ToolUse,
} from './record-ops-schema';
import {
  GROUP_REF,
  HERE_REF,
  RECORD_REF,
  ROW_REF,
  fieldDefinition,
  type Collection,
  type Field,
  type FieldType,
  type WorkspaceConfig,
} from './schema';

export * from './record-ops-schema';

// 一键记录工具（D-300–D-304，v34 NEW_FORMAT §5.2）：检查（validate.ts 调）、执行前算出要写的值（App 调）。
// 删字段删表时找出用到它的工具在 ops.ts。AI 只配置工具；值在用户点了以后才在本机写进记录。

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

/** 工具在哪、作用在什么上（检查用）。 */
export interface ToolWhere {
  /** 问题文字的开头，例如 `list l1 button "Done"`。 */
  label: string;
  /**
   * 工具作用的这一条（"$row"）是哪张表的：记录块的 source 表，提醒「完成」的 when.each.table。
   * 按钮、表单没有（它们写自己那张表，关系规则 12）。原样的表（不是换过查找的）。
   */
  rowOf?: Collection;
  /** 块所在页面给哪张表的一条记录用（D-342，page.of）："$record" 指那条记录。 */
  recordOf?: string;
  /** 表单块的提交（look form）：ask 是表单里问的字段。 */
  form?: boolean;
  /** 提醒的「完成」：在通知上点了直接做，不打开 Morph（不能 ask）。 */
  direct?: boolean;
  /** 看板的拖动：value "$group" 写进的字段（source.group.by）。 */
  dragField?: string;
}

interface ValueWhere extends ToolWhere {
  /** 是新建（create）：null 没有意义。 */
  creating?: boolean;
}

function valueProblem(
  collection: Collection,
  fieldId: string,
  value: RecordToolValue,
  where: ValueWhere,
): string | null {
  const field = collection.fields.find((f) => f.id === fieldId);
  if (!field) {
    return `${where.label}: ${fieldId} is not a field of ${collection.id} (fields: ${collection.fields.map((f) => f.id).join(', ')})`;
  }
  const name = `${collection.id}.${fieldId}`;
  // 拖到的那一栏（看板）：只给拖动，写进分栏的字段。
  if (value === GROUP_REF)
    return where.dragField === fieldId
      ? null
      : `${where.label}: "${GROUP_REF}" (the column a card is dragged to) only works in a board's {as: "drag", do: "set", field: <source.group.by>}`;
  if (field.type === 'link') {
    const row =
      value === ROW_REF &&
      where.creating === true &&
      where.rowOf !== undefined &&
      field.table === where.rowOf.id;
    // D-342：给一条记录用的页面上，新建时引用字段可以设成这条记录。
    const page =
      value === RECORD_REF &&
      where.creating === true &&
      where.recordOf !== undefined &&
      field.table === where.recordOf;
    if (row || page || (value === null && !where.creating)) return null;
    if (value === RECORD_REF)
      return where.recordOf
        ? `${where.label}: link field ${name} can be "${RECORD_REF}" only when creating and only if it points at ${where.recordOf}`
        : `${where.label}: "${RECORD_REF}" only works on a page for one entry of a table (page.of)`;
    return where.rowOf && where.creating
      ? `${where.label}: link field ${name} can only be "${ROW_REF}" (this entry) and must point at ${where.rowOf.id}`
      : `${where.label}: link field ${name} can't be preset; only a tool on each entry of a list can create with "${ROW_REF}"`;
  }
  if (value === ROW_REF || value === RECORD_REF)
    return `${where.label}: "${value}" only works on a link field, but ${name} is a ${field.type} field`;
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
  tool: Extract<RecordTool, { do: 'create' }>,
  collection: Collection,
  where: ToolWhere,
): string[] {
  const problems: string[] = [];
  const values = typeof tool.values === 'object' ? tool.values : undefined;
  for (const [id, v] of Object.entries(values ?? {})) {
    const p = valueProblem(collection, id, v, { ...where, creating: true });
    if (p) problems.push(p);
  }
  const ask = tool.ask;
  if (where.direct && ask !== undefined)
    problems.push(
      `${where.label}: runs right from the notification without opening Morph, so it can't ask; leave ask out`,
    );
  if (Array.isArray(ask) && !where.form)
    problems.push(
      `${where.label}: ask: [fields] only works in a form block; use ask: "all" to open the full form`,
    );
  if (tool.smartDate) problems.push(...smartDateProblems(tool, collection, where));
  // 必填、又没有默认值的字段：点一下存不进去。打开表单的（D-338）由用户填。
  if (ask !== undefined) return problems;
  for (const f of collection.fields) {
    const def = fieldDefinition(f.type);
    if (!('required' in f) || !f.required || !def.write || values?.[f.id] !== undefined) continue;
    const hasDefault = ('default' in f && f.default !== undefined) || def.emptyNew !== undefined;
    if (!hasDefault) {
      problems.push(
        `${where.label}: creates an entry in ${collection.id} but required field ${f.id} would be empty; preset it, make it not required, or add ask: "all" so the user fills in the rest`,
      );
    }
  }
  return problems;
}

/** smartDate（D-344，原 recordForm.smartDate）：只给表单，从问的一个文字字段认出日期，填进日期类字段。 */
function smartDateProblems(
  tool: Extract<RecordTool, { do: 'create' }>,
  collection: Collection,
  where: ToolWhere,
): string[] {
  const smart = tool.smartDate!;
  const problems: string[] = [];
  const ask = Array.isArray(tool.ask) ? tool.ask : [];
  if (!where.form || !Array.isArray(tool.ask))
    problems.push(`${where.label}: smartDate only works in a form block (ask: [fields])`);
  const from = collection.fields.find((x) => x.id === smart.from);
  const to = collection.fields.find((x) => x.id === smart.to);
  if (from?.type !== 'text' || !ask.includes(smart.from))
    problems.push(
      `${where.label}: smartDate.from ${smart.from} must be a text field listed in ask`,
    );
  if (!to || !SMART_DATE_TYPES.includes(to.type))
    problems.push(
      `${where.label}: smartDate.to ${smart.to} must be a date, datetime or schedule field of ${collection.id}`,
    );
  return problems;
}

function fieldProblem(
  collection: Collection,
  fieldId: string,
  where: ToolWhere,
  types: readonly FieldType[],
  verb: string,
): string | null {
  const field = collection.fields.find((f) => f.id === fieldId);
  if (!field) return `${where.label}: ${fieldId} is not a field of ${collection.id}`;
  return types.includes(field.type)
    ? null
    : `${where.label}: ${verb} needs a ${types.join(' or ')} field, but ${collection.id}.${fieldId} is ${field.type}`;
}

/**
 * 关系规则 12：块上的工具只能写块读的那张表（"$row" 是它的一条），或者在另一张表里新建一条、用引用字段
 * 连回这一条（"$row"）或记录页的那一条（"$record"）。按钮、表单没有 source，写自己那张表。
 */
function scopeProblem(tool: RecordTool, collection: Collection, where: ToolWhere): string | null {
  const row = where.rowOf;
  if (!row || tool.table === row.id) return null;
  if (tool.do !== 'create')
    return `${where.label}: ${tool.do} changes this entry ("${ROW_REF}", an entry of ${row.id}), so table must be ${row.id}, not ${tool.table}`;
  const values = typeof tool.values === 'object' ? tool.values : {};
  const linked = Object.entries(values).some(
    ([id, v]) =>
      (v === ROW_REF || v === RECORD_REF) &&
      collection.fields.find((f) => f.id === id)?.type === 'link',
  );
  return linked
    ? null
    : `${where.label}: creates an entry in ${tool.table}, but this block shows ${row.id}; a tool here can only add to ${row.id}, or add to another table with a link field set to "${ROW_REF}" (this entry)`;
}

/** 一个一键记录工具的问题（文字发给 AI）。 */
export function recordToolProblems(
  tool: RecordTool,
  config: WorkspaceConfig,
  where: ToolWhere,
): string[] {
  const collection = config.data.tables.find((c) => c.id === tool.table);
  if (!collection) return [`${where.label}: data table ${tool.table} does not exist`];
  const scope = scopeProblem(tool, collection, where);
  if (scope) return [scope];
  if (tool.do !== 'create' && tool.do !== 'setAll' && !where.rowOf)
    return [
      `${where.label}: ${tool.do} changes one entry, so it only works on each entry of a list (or a reminder's done)`,
    ];
  switch (tool.do) {
    case 'create':
      return createProblems(tool, collection, where);
    case 'setAll': {
      if (where.direct)
        return [
          `${where.label}: done acts on this entry ("${ROW_REF}"); use create, set, toggle or increment, not setAll`,
        ];
      const p = valueProblem(collection, tool.field, tool.value, { label: where.label });
      return [
        ...(p ? [p] : []),
        ...conditionProblems(
          tool.filter,
          expandCollection(config.data.tables, collection),
          where.recordOf,
        ).map((x) => `${where.label}: ${x}`),
      ];
    }
    case 'set': {
      const p = valueProblem(collection, tool.field, tool.value, where);
      return p ? [p] : [];
    }
    case 'toggle': {
      const p = fieldProblem(collection, tool.field, where, ['checkbox'], 'toggle');
      return p ? [p] : [];
    }
    case 'increment': {
      const p = fieldProblem(collection, tool.field, where, INCREMENT_FIELD_TYPES, 'increment');
      return p ? [p] : [];
    }
  }
}

/** 按钮上的字最长几个字（表单的提交 30，其余 20）。 */
export const toolLabelMax = (as: ToolUse['as']) => (as === 'submit' ? 30 : 20);

/**
 * 块上一个就地工具的问题：按出现方式（as）的要求、按钮上的字、when 条件，再加工具本身（recordToolProblems）。
 * 外观允许哪些 as、do、几个，在 validate.ts 按登记表查。
 */
export function recordToolUseProblems(
  use: RecordToolUse,
  config: WorkspaceConfig,
  where: ToolWhere,
): string[] {
  const problems: string[] = [];
  const tool = recordToolOf(use);
  const row = where.rowOf;
  if (use.label !== undefined && use.label.length > toolLabelMax(use.as))
    problems.push(`${where.label}: label can be at most ${toolLabelMax(use.as)} characters`);
  if ((use.as === 'button' || use.as === 'tap') && use.label === undefined)
    problems.push(`${where.label}: needs a label (shown on the button and read by screen readers)`);
  // $here：就地添加（这一段的值 + 列表筛选里的等于条件）。
  const here = tool.do === 'create' && tool.values === HERE_REF;
  if (use.as === 'addHere' && (tool.do !== 'create' || !here || (row && tool.table !== row.id)))
    problems.push(
      `${where.label}: addHere adds an entry right in this section: {as: "addHere", do: "create", table: ${row?.id ?? '<the block table>'}, ask?: "all", values: "${HERE_REF}"}`,
    );
  else if (here && use.as !== 'addHere')
    problems.push(`${where.label}: values "${HERE_REF}" only works with as: "addHere"`);
  if (use.when) {
    if (use.as !== 'button' && use.as !== 'tap')
      problems.push(`${where.label}: when only applies to a button or tap on each entry`);
    else if (row) {
      const view = expandCollection(config.data.tables, row);
      problems.push(
        ...conditionProblems(use.when, view, where.recordOf).map(
          (x) => `${where.label} when: ${x}`,
        ),
      );
      // 写的是日程的「上次完成」时，「为空才显示」会让按钮做过一次就消失，重复的事下次没法完成。
      const written = tool.do === 'set' ? tool.field : undefined;
      const schedule =
        written !== undefined && use.when.some((w) => w.field === written && w.op === 'isEmpty')
          ? row.fields.find((f) => f.type === 'schedule' && f.lastDone === written)
          : undefined;
      if (schedule)
        problems.push(
          `${where.label}: ${written} is the last-done date of ${schedule.id}, so "when ${written} is empty" hides the button for good after the first time and a repeating entry can never be done again; drop the when (the schedule already shows what is due)`,
        );
    }
  }
  return [...problems, ...recordToolProblems(tool, config, where)];
}

// ---- 执行（App 在用户点了以后调）----

export interface ActionContext {
  now: Date;
  cal?: Calendar;
  /** 工具作用的这一条（"$row"）的 ID。 */
  rowId?: string;
  /** 记录页打开的那一条（"$record"）的 ID。 */
  recordId?: string;
  /** 拖到的那一栏（"$group"）：选项 ID、被引用的那条的 ID，null 是「未分」。 */
  group?: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 工具里的值 → 表单输入（prepareRecordValues 再按字段严格检查）。null = 清空（勾选框是不勾）。 */
export function actionInput(field: Field, value: RecordToolValue, ctx: ActionContext): unknown {
  if (value === null) return field.type === 'checkbox' ? false : '';
  if (value === 'today' && field.type === 'date')
    return dayOf(ctx.now, ctx.cal ?? DEFAULT_CALENDAR);
  if (value === 'now' && field.type === 'datetime') return localDateTime(ctx.now);
  if (value === 'now' && field.type === 'time')
    return `${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())}`;
  if (value === ROW_REF && field.type === 'link') return ctx.rowId ?? '';
  if (value === RECORD_REF && field.type === 'link') return ctx.recordId ?? '';
  if (value === GROUP_REF) return ctx.group ?? (field.type === 'checkbox' ? false : '');
  return value;
}

/**
 * create：新记录的表单输入（只含预设的字段，其余由 prepareRecordValues 套默认值）。
 * values 是 "$here"（就地添加）时由 App 按这一段算，这里没有。
 */
export function createInput(
  collection: Collection,
  values: RecordToolValues | typeof HERE_REF | undefined,
  ctx: ActionContext,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (typeof values !== 'object') return input;
  for (const [id, v] of Object.entries(values)) {
    const field = collection.fields.find((f) => f.id === id);
    if (field) input[id] = actionInput(field, v, ctx);
  }
  return input;
}

/**
 * {do: "create", ask: "all", values}：打开的新记录表单里先填好的值（Q6：v33 的「添加」按钮忽略预设值，
 * v34 预填）。表已经不在了时为空。
 */
export function createPrefill(
  tool: Extract<RecordTool, { do: 'create' }>,
  ctx: ActionContext & { config: Pick<WorkspaceConfig, 'data'> },
): Record<string, unknown> {
  const collection = ctx.config.data.tables.find((c) => c.id === tool.table);
  if (!collection) return {};
  return createInput(collection, tool.values, { ...ctx, cal: ctx.cal ?? calendarOf(ctx.config) });
}

/**
 * set / toggle / increment：这一条记录（存着的值）要改成什么。字段已经不在了（旧配置）返回 null。
 * 结果再交给 prepareRecordValues。
 */
export function rowUpdateInput(
  tool: Extract<RecordTool, { do: 'set' | 'toggle' | 'increment' }>,
  collection: Collection,
  values: Record<string, unknown>,
  ctx: ActionContext,
): Record<string, unknown> | null {
  const field = collection.fields.find((f) => f.id === tool.field);
  if (!field) return null;
  if (tool.do === 'set') return { [field.id]: actionInput(field, tool.value, ctx) };
  if (tool.do === 'toggle') return { [field.id]: values[field.id] !== true };
  const raw = values[field.id];
  const current = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  const decimals = field.type === 'money' ? 2 : field.type === 'number' ? (field.decimals ?? 4) : 0;
  let next = round(current + tool.by, decimals);
  // 时长不能是负数：减到 0 为止。
  if (field.type === 'duration') next = Math.max(0, next);
  return { [field.id]: next };
}

/**
 * 这一条显示哪个按钮（as button，大圆块是 tap）：第一个条件都满足的（没有条件就总是）。
 * view 是换过的表（条件可以用查找来的值）。
 */
export function shownRowAction(
  uses: readonly ToolUse[] | undefined,
  record: DataRecord,
  view: Collection,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): ToolUse | undefined {
  return uses?.find(
    (u) =>
      (u.as === 'button' || u.as === 'tap') &&
      (u.when ?? []).every((cond) => matchesCondition(record, view, cond, now, cal)),
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
  tool: Extract<RecordTool, { do: 'setAll' }>,
  collection: Collection,
  view: Collection,
  records: readonly DataRecord[],
  ctx: ActionContext,
): SetAllChange[] {
  const field = collection.fields.find((f) => f.id === tool.field);
  if (!field) return [];
  const cal = ctx.cal ?? DEFAULT_CALENDAR;
  const input = { [field.id]: actionInput(field, tool.value, ctx) };
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? (field.type === 'checkbox' ? false : null)) ===
    JSON.stringify(b ?? (field.type === 'checkbox' ? false : null));
  const changes: SetAllChange[] = [];
  for (const r of records) {
    if (!(tool.filter ?? []).every((c) => matchesCondition(r, view, c, ctx.now, cal))) continue;
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
