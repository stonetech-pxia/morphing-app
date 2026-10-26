import { localeTag } from './localization';
import { t } from './messages';
import { dayNumber, evaluateFormula, parseFormula, type FormulaNode } from './formula';
import type { Collection, Condition, Field, Locale, Period, SystemField } from './schema';

// 用户数据（记录）的纯函数：写入校验、宽容读取、筛选、排序、统计、显示格式、CSV 导出。
// 记录存在配置之外（App 的数据库里），从不进入 WorkspaceConfig，所以也从不发给 AI。
// 设计见 docs/DATA_DESIGN.md。

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

export type FieldValue = string | number | boolean;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** 设备本地日期 YYYY-MM-DD。 */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(s: string): boolean {
  if (!DATE_PATTERN.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
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

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** 宽容读取：值和当前字段定义对不上时返回 undefined（只是不显示，绝不报错）。 */
export function readValue(field: Field, raw: unknown): FieldValue | undefined {
  switch (field.type) {
    case 'text':
    case 'note':
      return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    case 'number':
    case 'money':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    case 'rating':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5
        ? raw
        : undefined;
    case 'checkbox':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'date':
      return typeof raw === 'string' && isValidDate(raw) ? raw : undefined;
    case 'choice':
      return typeof raw === 'string' && field.options.some((o) => o.id === raw) ? raw : undefined;
    case 'file':
    case 'link':
      return typeof raw === 'string' && FILE_ID.test(raw) ? raw : undefined;
    case 'formula':
      // 公式不存值（D-188），由 recordValue 现算。
      return undefined;
  }
}

/** 附件的值：文件 ID（和配置里的 ID 一样的写法）。 */
const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

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
      if (!ref || ref.type === 'formula') return undefined;
      const v = readValue(ref, record.values[id]);
      if (ref.type === 'date') return typeof v === 'string' ? dayNumber(v) : undefined;
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

type Coerced = { value: FieldValue } | { issue: FieldIssue['code'] };

/** 把表单输入转换成某个字段的值。 */
function coerce(field: Field, input: unknown): Coerced {
  switch (field.type) {
    case 'text':
    case 'note': {
      if (typeof input !== 'string') return { issue: 'invalid' };
      const s = field.type === 'text' ? input.trim() : input.replace(/\s+$/, '');
      return s.length > (field.type === 'text' ? 200 : 5000) ? { issue: 'tooLong' } : { value: s };
    }
    case 'number':
    case 'money': {
      const n = typeof input === 'number' ? input : Number(String(input).trim().replace(/,/g, ''));
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { issue: 'invalid' };
      return { value: round(n, field.type === 'money' ? 2 : (field.decimals ?? 4)) };
    }
    case 'rating': {
      const n = typeof input === 'number' ? input : Number(input);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? { value: n } : { issue: 'invalid' };
    }
    case 'checkbox':
      return typeof input === 'boolean' ? { value: input } : { issue: 'invalid' };
    case 'date': {
      const s = typeof input === 'string' ? input.trim() : '';
      return isValidDate(s) ? { value: s } : { issue: 'invalid' };
    }
    case 'choice':
      return typeof input === 'string' && field.options.some((o) => o.id === input)
        ? { value: input }
        : { issue: 'invalid' };
    case 'file':
    case 'link':
      return typeof input === 'string' && FILE_ID.test(input)
        ? { value: input }
        : { issue: 'invalid' };
    case 'formula':
      return { issue: 'invalid' };
  }
}

function defaultValue(field: Field, now: Date): FieldValue | undefined {
  if (!('default' in field) || field.default === undefined) return undefined;
  if (field.type === 'date') return localDate(now);
  return field.default;
}

const isBlank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

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
    // 公式不存值（D-188）：输入里有也忽略。
    if (field.type === 'formula') {
      delete values[field.id];
      continue;
    }
    let raw: unknown;
    if (Object.prototype.hasOwnProperty.call(input, field.id)) raw = input[field.id];
    else if (previous !== null) raw = previous[field.id];
    else raw = defaultValue(field, now);
    // 新记录里没勾选的勾选框就是 false。
    if (field.type === 'checkbox' && raw === undefined && previous === null) raw = false;

    const result = isBlank(raw) ? null : coerce(field, raw);
    if (result && 'issue' in result) {
      issues.push({ fieldId: field.id, code: result.issue });
    } else if (result === null || result.value === '') {
      delete values[field.id];
      if (field.required) issues.push({ fieldId: field.id, code: 'required' });
    } else {
      values[field.id] = result.value;
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
}

// ---- 筛选、排序、统计 ----

function compare(a: FieldValue, b: FieldValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
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
  const key = (r: DataRecord): FieldValue | undefined => {
    if (isSystemField(field)) return r[field];
    const v = recordValue(r, collection, field);
    if (def?.type === 'choice' && typeof v === 'string') {
      return def.options.findIndex((o) => o.id === v);
    }
    return v;
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

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  HKD: 'HK$',
  TWD: 'NT$',
  KRW: '₩',
};

function groupThousands(n: number, decimals: number): string {
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.') as [string, string | undefined];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatMoney(n: number, currency: string, locale: Locale = 'en'): string {
  if (locale === 'fr')
    return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency }).format(n);
  const symbol = CURRENCY_SYMBOLS[currency];
  const amount = groupThousands(n, 2);
  return symbol
    ? `${n < 0 ? '-' : ''}${symbol}${amount.replace('-', '')}`
    : `${currency} ${amount}`;
}

export function formatNumber(n: number, decimals?: number, locale: Locale = 'en'): string {
  if (locale === 'fr')
    return new Intl.NumberFormat(localeTag(locale), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals ?? 4,
    }).format(n);
  if (decimals !== undefined) return groupThousands(n, decimals);
  return groupThousands(n, Number.isInteger(n) ? 0 : Math.min(4, String(n).split('.')[1]!.length));
}

/**
 * 引用字段（D-250）指向的那条记录的标题；那条记录已经删掉（或那张表的记录还没读出来）时为 null。
 * 由 App 按已经读到的记录提供（makeLinkResolver）；没有时引用字段显示为空。
 */
export type LinkResolver = (collectionId: string, recordId: string) => string | null;

/** 一张表在引用里显示哪个字段：第一个文字字段，没有就是第一个长文本、单选、数字、金额或日期字段。 */
export function linkTitleField(collection: Collection): Field | undefined {
  const order = ['text', 'note', 'choice', 'number', 'money', 'date'];
  for (const type of order) {
    const f = collection.fields.find((x) => x.type === type);
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
  const value =
    field.type === 'formula' ? (typeof raw === 'number' ? raw : undefined) : readValue(field, raw);
  if (value === undefined) return '';
  switch (field.type) {
    case 'formula':
      return field.currency
        ? formatMoney(value as number, field.currency, locale)
        : `${formatNumber(value as number, field.decimals, locale)}${field.unit ? ` ${field.unit}` : ''}`;
    case 'file':
      return t(locale, 'data_Attachment_6f6cf');
    case 'link':
      return links ? (links(field.collectionId, value as string) ?? t(locale, 'linkDeleted')) : '';
    case 'money':
      return formatMoney(value as number, field.currency, locale);
    case 'number':
      return `${formatNumber(value as number, field.decimals, locale)}${field.unit ? ` ${field.unit}` : ''}`;
    case 'rating':
      return '★'.repeat(value as number) + '☆'.repeat(5 - (value as number));
    case 'checkbox':
      return value ? t(locale, 'data_Yes_1f54e') : t(locale, 'data_No_04a4b');
    case 'date':
      return locale === 'fr'
        ? new Intl.DateTimeFormat(localeTag(locale)).format(new Date(`${value}T12:00:00`))
        : String(value);
    case 'choice':
      return field.options.find((o) => o.id === value)?.label ?? '';
    default:
      return String(value);
  }
}

export function formatTimestamp(ms: number, locale: Locale = 'en'): string {
  const d = new Date(ms);
  if (locale === 'fr')
    return new Intl.DateTimeFormat(localeTag(locale), {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
      if (f.type === 'money') return (v as number).toFixed(2);
      if (f.type === 'number' || f.type === 'rating' || f.type === 'formula') return String(v);
      return formatValue(f, v, locale, links);
    }),
    formatTimestamp(r.createdAt, locale),
  ]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
