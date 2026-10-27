import {
  formatTimestamp,
  localDate,
  round,
  type FieldValue,
  type LinkResolver,
} from './field-values';
import { t } from './messages';
import { dayNumber, evaluateFormula, parseFormula, type FormulaNode } from './formula';
import {
  FIELDS,
  fieldDefinition,
  type Collection,
  type Condition,
  type Field,
  type Locale,
  type Period,
  type SystemField,
} from './schema';

// 用户数据（记录）的纯函数：写入校验、宽容读取、筛选、排序、统计、显示格式、CSV 导出。
// 记录存在配置之外（App 的数据库里），从不进入 WorkspaceConfig，所以也从不发给 AI。
// 设计见 docs/DATA_DESIGN.md。每种字段的读取、写入、显示在 fields/<type>.ts（docs/FIELDS.md）。

export {
  formatMoney,
  formatNumber,
  formatTimestamp,
  localDate,
  type FieldValue,
  type LinkResolver,
} from './field-values';

export const RECORD_LIMITS = {
  /** 每张表的软上限：超过后不能再添加。 */
  perCollection: 10_000,
  /** 软删除的记录保留天数（D-037）。 */
  deletedRetentionDays: 30,
} as const;

export interface DataRecord {
  id: string;
  collectionId: string;
  /** 字段 ID → 值。可能包含已删除字段的值（保留，不显示）。 */
  values: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 时间段对应的本地日期范围（含两端）。一周从周一开始。 */
export function periodRange(period: Period, now: Date): [string, string] {
  const day = (offset: number) =>
    localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  const today = day(0);
  switch (period) {
    case 'today':
      return [today, today];
    case 'thisWeek': {
      const sinceMonday = (now.getDay() + 6) % 7;
      return [day(-sinceMonday), day(6 - sinceMonday)];
    }
    case 'thisMonth':
      return [
        localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
        localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      ];
    case 'thisYear':
      return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
    case 'last7days':
      return [day(-6), today];
    case 'last30days':
      return [day(-29), today];
  }
}

export const isSystemField = (ref: string): ref is SystemField =>
  ref === 'createdAt' || ref === 'updatedAt';

export function fieldOf(collection: Collection, ref: string): Field | undefined {
  return collection.fields.find((f) => f.id === ref);
}

/** 宽容读取：值和当前字段定义对不上时返回 undefined（只是不显示，绝不报错）。 */
export function readValue(field: Field, raw: unknown): FieldValue | undefined {
  return fieldDefinition(field.type).read(field, raw);
}

const formulaCache = new Map<string, FormulaNode | null>();
function formulaNode(expression: string): FormulaNode | null {
  let node = formulaCache.get(expression);
  if (node === undefined) {
    const parsed = parseFormula(expression);
    node = parsed.ok ? parsed.node : null;
    formulaCache.set(expression, node);
  }
  return node;
}

/**
 * 公式字段在一条记录上的值：引用的字段都有值时才有值，结果按字段的小数位（默认 2 位）取整。
 * 日期字段按天数算，today 是 now 那天（D-247）。
 */
function formulaValue(
  field: Extract<Field, { type: 'formula' }>,
  record: DataRecord,
  collection: Collection,
  now: Date,
): number | undefined {
  const node = formulaNode(field.expression);
  if (!node) return undefined;
  const value = evaluateFormula(
    node,
    (id) => {
      const ref = fieldOf(collection, id);
      const kind = ref && fieldDefinition(ref.type).formula;
      if (!ref || !kind) return undefined;
      const v = readValue(ref, record.values[id]);
      if (kind === 'date') return typeof v === 'string' ? dayNumber(v) : undefined;
      return typeof v === 'number' ? v : undefined;
    },
    dayNumber(localDate(now)),
  );
  return value === undefined ? undefined : round(value, field.decimals ?? 2);
}

/** 记录上某个字段（包括系统字段）的值；系统字段的值是本地日期，公式现算（用到 today 时按 now 那天）。 */
export function recordValue(
  record: DataRecord,
  collection: Collection,
  ref: string,
  now: Date = new Date(),
): FieldValue | undefined {
  if (isSystemField(ref)) return localDate(new Date(record[ref]));
  const field = fieldOf(collection, ref);
  if (field?.type === 'formula') return formulaValue(field, record, collection, now);
  return field ? readValue(field, record.values[ref]) : undefined;
}

// ---- 写入 ----

export type FieldIssue = { fieldId: string; code: 'required' | 'invalid' | 'tooLong' };

export type PreparedValues =
  { ok: true; values: Record<string, unknown> } | { ok: false; issues: FieldIssue[] };

/** 新记录的默认值：定义里的 default（日期的 today 换成今天）。 */
function defaultValue(field: Field, now: Date): FieldValue | undefined {
  const def = fieldDefinition(field.type);
  if (def.initial) return def.initial(field, now);
  return 'default' in field ? field.default : undefined;
}

const isBlank = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/**
 * 写入时严格校验：input 只包含要修改的字段（字段 ID → 表单值，空字符串表示清空）。
 * previous 为 null 表示新记录，此时套用默认值。已删除字段的旧值原样保留。
 */
export function prepareRecordValues(
  collection: Collection,
  input: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  now: Date,
): PreparedValues {
  const values: Record<string, unknown> = { ...previous };
  const issues: FieldIssue[] = [];
  for (const field of collection.fields) {
    const def = fieldDefinition(field.type);
    // 不存值的字段（公式，D-188）：输入里有也忽略。
    if (!def.write) {
      delete values[field.id];
      continue;
    }
    let raw: unknown;
    if (Object.prototype.hasOwnProperty.call(input, field.id)) raw = input[field.id];
    else if (previous !== null) raw = previous[field.id];
    else raw = defaultValue(field, now);
    // 新记录里没有值时存的值（没勾选的勾选框是 false）。
    if (def.emptyNew !== undefined && raw === undefined && previous === null) raw = def.emptyNew;

    const result = isBlank(raw) ? null : def.write(field, raw);
    if (result && 'issue' in result) {
      issues.push({ fieldId: field.id, code: result.issue });
    } else if (result === null || result.value === '') {
      delete values[field.id];
      if ('required' in field && field.required)
        issues.push({ fieldId: field.id, code: 'required' });
    } else {
      values[field.id] = result.value;
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
}

// ---- 筛选、排序、统计 ----

function compare(a: FieldValue, b: FieldValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // 附件（一组文件 ID）按个数比。
  if (Array.isArray(a) || Array.isArray(b))
    return (Array.isArray(a) ? a.length : 0) - (Array.isArray(b) ? b.length : 0);
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

export function matchesCondition(
  record: DataRecord,
  collection: Collection,
  condition: Condition,
  now: Date,
): boolean {
  const value = recordValue(record, collection, condition.field, now);
  const target = condition.value;
  // 附件（D-263）：一组文件 ID。is / isNot 看有没有这个文件，其他比较都不成立。
  if (Array.isArray(value)) {
    const has = typeof target === 'string' && value.includes(target);
    if (condition.op === 'isNotEmpty') return true;
    if (condition.op === 'is') return has;
    if (condition.op === 'isNot') return !has;
    return false;
  }
  switch (condition.op) {
    case 'isEmpty':
      return value === undefined || value === '';
    case 'isNotEmpty':
      return value !== undefined && value !== '';
    case 'is':
      return value !== undefined && target !== undefined && value === target;
    case 'isNot':
      return value === undefined || value !== target;
    case 'contains':
      return (
        typeof value === 'string' &&
        typeof target === 'string' &&
        value.toLowerCase().includes(target.toLowerCase())
      );
    case 'gt':
      return value !== undefined && target !== undefined && compare(value, target) > 0;
    case 'lt':
      return value !== undefined && target !== undefined && compare(value, target) < 0;
    case 'inPeriod': {
      if (typeof value !== 'string' || typeof target !== 'string') return false;
      const [start, end] = periodRange(target as Period, now);
      return value >= start && value <= end;
    }
  }
}

export function filterRecords(
  records: readonly DataRecord[],
  collection: Collection,
  conditions: readonly Condition[] | undefined,
  now: Date,
): DataRecord[] {
  if (!conditions?.length) return [...records];
  return records.filter((r) => conditions.every((c) => matchesCondition(r, collection, c, now)));
}

/** 排序：空值总在最后；单选按选项顺序；默认按创建时间从新到旧。 */
export function sortRecords(
  records: readonly DataRecord[],
  collection: Collection,
  sort: { field: string; direction: 'asc' | 'desc' } | undefined,
): DataRecord[] {
  const { field, direction } = sort ?? { field: 'createdAt', direction: 'desc' as const };
  const sign = direction === 'asc' ? 1 : -1;
  const def = fieldOf(collection, field);
  const sortKey = def && fieldDefinition(def.type).sort;
  const key = (r: DataRecord): FieldValue | undefined => {
    if (isSystemField(field)) return r[field];
    const v = recordValue(r, collection, field);
    // 有的字段按自己的顺序排（单选按选项顺序）。
    return def && sortKey && v !== undefined ? sortKey(def, v) : v;
  };
  return [...records].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === undefined && kb === undefined) return b.createdAt - a.createdAt;
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;
    return sign * compare(ka, kb) || b.createdAt - a.createdAt;
  });
}

export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** 统计结果；没有可用数值时返回 null。 */
export function aggregateRecords(
  records: readonly DataRecord[],
  collection: Collection,
  aggregate: Aggregate,
  fieldId: string | undefined,
): number | null {
  if (aggregate === 'count') return records.length;
  if (!fieldId) return null;
  const numbers = records
    .map((r) => recordValue(r, collection, fieldId))
    .filter((v): v is number => typeof v === 'number');
  if (numbers.length === 0) return aggregate === 'sum' ? 0 : null;
  switch (aggregate) {
    case 'sum':
      return round(
        numbers.reduce((a, b) => a + b, 0),
        4,
      );
    case 'avg':
      return round(numbers.reduce((a, b) => a + b, 0) / numbers.length, 2);
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
  }
}

export interface StatGroup {
  /** 选项 ID；null 是没选的记录。 */
  optionId: string | null;
  label: string;
  count: number;
  value: number | null;
}

/**
 * 按单选字段分组统计（D-248）：每个选项一行（按选项顺序，没有记录的选项也列出），
 * 没选的记录有的话放在最后一行（label 用 noChoice）。选项已删掉的值算作没选。
 */
export function groupedAggregate(
  records: readonly DataRecord[],
  collection: Collection,
  aggregate: Aggregate,
  fieldId: string | undefined,
  groupBy: string,
  noChoice: string,
): StatGroup[] {
  const field = fieldOf(collection, groupBy);
  if (field?.type !== 'choice') return [];
  const buckets = new Map<string | null, DataRecord[]>();
  for (const o of field.options) buckets.set(o.id, []);
  for (const r of records) {
    const v = readValue(field, r.values[groupBy]);
    const key = typeof v === 'string' ? v : null;
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  return [...buckets.entries()].flatMap(([optionId, list]) =>
    optionId === null && list.length === 0
      ? []
      : [
          {
            optionId,
            label:
              optionId === null
                ? noChoice
                : (field.options.find((o) => o.id === optionId)?.label ?? noChoice),
            count: list.length,
            value: aggregateRecords(list, collection, aggregate, fieldId),
          },
        ],
  );
}

// ---- 显示与导出 ----

/**
 * 一张表在引用里显示哪个字段：按字段定义的 titleRank（第一个文字字段，没有就是第一个长文本、单选、
 * 数字、金额或日期字段）。
 */
export function linkTitleField(collection: Collection): Field | undefined {
  const ranked = FIELDS.flatMap((d) => (d.titleRank === undefined ? [] : [d])).sort(
    (a, b) => a.titleRank! - b.titleRank!,
  );
  for (const def of ranked) {
    const f = collection.fields.find((x) => x.type === def.type);
    if (f) return f;
  }
  return undefined;
}

/** 一条记录作为被引用的一方时显示的标题（没有可显示的字段时用创建时间）。 */
export function linkTitle(record: DataRecord, collection: Collection, locale: Locale): string {
  const field = linkTitleField(collection);
  const title = field ? formatValue(field, record.values[field.id], locale) : '';
  return title || formatTimestamp(record.createdAt, locale);
}

/** 按读到的记录（表 ID → 没删的记录）查引用的标题。 */
export function makeLinkResolver(
  collections: readonly Collection[],
  records: ReadonlyMap<string, readonly DataRecord[]>,
  locale: Locale,
): LinkResolver {
  return (collectionId, recordId) => {
    const collection = collections.find((c) => c.id === collectionId);
    const record = records.get(collectionId)?.find((r) => r.id === recordId);
    return collection && record ? linkTitle(record, collection, locale) : null;
  };
}

/** 读出被引用的表的记录（listRecords 只给没删的），做成查标题的函数。列表、导出 CSV、生成 PDF 共用。 */
export async function loadLinkResolver(
  listRecords: (collectionId: string) => Promise<DataRecord[]>,
  collections: readonly Collection[],
  targets: readonly string[],
  locale: Locale,
): Promise<LinkResolver> {
  const records = new Map<string, DataRecord[]>();
  for (const id of targets) records.set(id, await listRecords(id));
  return makeLinkResolver(collections, records, locale);
}

/** 一张表的引用字段指向哪些表（读记录时要连它们一起读）。 */
export const linkedCollectionIds = (collection: Collection): string[] => [
  ...new Set(collection.fields.flatMap((f) => (f.type === 'link' ? [f.collectionId] : []))),
];

/**
 * 字段值的显示文字；值无效或为空时返回空字符串。公式字段请用 formatRef（要整条记录才能算）。
 * 引用字段要 links 才能显示标题；被引用的记录删掉了时显示「已删除的记录」（D-250）。
 */
export function formatValue(
  field: Field,
  raw: unknown,
  locale: Locale,
  links?: LinkResolver,
): string {
  const def = fieldDefinition(field.type);
  const value = (def.shown ?? def.read)(field, raw);
  return value === undefined ? '' : def.format(field, value, locale, links);
}

/** 某个字段引用（包括系统字段）在一条记录上的显示文字。 */
export function formatRef(
  record: DataRecord,
  collection: Collection,
  ref: string,
  locale: Locale,
  links?: LinkResolver,
): string {
  if (isSystemField(ref)) return formatTimestamp(record[ref], locale);
  const field = fieldOf(collection, ref);
  if (field?.type === 'formula')
    return formatValue(field, recordValue(record, collection, ref), locale);
  return field ? formatValue(field, record.values[ref], locale, links) : '';
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 导出 CSV（带 BOM，Excel 可直接打开中文）。只导出当前字段和创建时间。 */
export function recordsToCsv(
  collection: Collection,
  records: readonly DataRecord[],
  locale: Locale,
  links?: LinkResolver,
): string {
  const header = [...collection.fields.map((f) => f.name), t(locale, 'data_Created_1626a')];
  const rows = records.map((r) => [
    ...collection.fields.map((f) => {
      const v = recordValue(r, collection, f.id);
      if (v === undefined) return '';
      const csv = fieldDefinition(f.type).csv;
      return csv ? csv(f, v) : formatValue(f, v, locale, links);
    }),
    formatTimestamp(r.createdAt, locale),
  ]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
