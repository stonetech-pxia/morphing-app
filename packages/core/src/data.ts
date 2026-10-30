import {
  formatTimestamp,
  localDate,
  round,
  type FieldValue,
  type LinkResolver,
} from './field-values';
import {
  DEFAULT_CALENDAR,
  dateOfDayNumber,
  dayOf,
  todayNumber,
  twoWeekStartOf,
  weekStartOf,
  type Calendar,
} from './calendar';
import { t } from './messages';
import {
  scheduleDue,
  scheduleStatus,
  scheduleStatusText,
  type ScheduleDue,
  type ScheduleStatus,
} from './schedule';
import {
  dayNumber,
  evaluateFormula,
  minuteNumber,
  minuteOfDay,
  parseFormula,
  type FormulaNode,
} from './formula';
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
  MAX_ATTACHMENTS,
  attachmentIds,
  formatDuration,
  formatMoney,
  formatNumber,
  formatTimestamp,
  localDate,
  localDateTime,
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

/**
 * 时间段对应的本地日期范围（含两端）。「今天」和一周的第一天按 cal（D-286，默认 0 点、周一）。
 */
export function periodRange(
  period: Period,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): [string, string] {
  const today = todayNumber(now, cal);
  const span = (start: number, days: number): [string, string] => [
    dateOfDayNumber(start),
    dateOfDayNumber(start + days - 1),
  ];
  const [y, m, d] = dateOfDayNumber(today).split('-').map(Number) as [number, number, number];
  const monthEnd = localDate(new Date(y, m, 0));
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  switch (period) {
    case 'today':
      return span(today, 1);
    case 'thisWeek':
      return span(weekStartOf(today, cal), 7);
    case 'thisTwoWeeks':
      return span(twoWeekStartOf(today, cal), 14);
    case 'thisHalfMonth':
      return d <= 15 ? [`${ym}-01`, `${ym}-15`] : [`${ym}-16`, monthEnd];
    case 'thisMonth':
      return [`${ym}-01`, monthEnd];
    case 'thisYear':
      return [`${y}-01-01`, `${y}-12-31`];
    case 'last7days':
      return span(today - 6, 7);
    case 'last14days':
      return span(today - 13, 14);
    case 'last30days':
      return span(today - 29, 30);
    case 'last90days':
      return span(today - 89, 90);
    case 'last365days':
      return span(today - 364, 365);
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
 * 日期字段按天数算，today 是 now 那天（D-247；一天从几点开始按 cal，D-286）；时间、日期时间按分钟数算（D-280）。
 * 引用的公式（D-281）用它取整以后的值；绕回自己的（校验会挡住，旧数据里可能有）没有值。
 */
function formulaValue(
  field: Extract<Field, { type: 'formula' }>,
  record: DataRecord,
  collection: Collection,
  now: Date,
  cal: Calendar,
  using: readonly string[] = [],
): number | undefined {
  const node = formulaNode(field.expression);
  if (!node || using.includes(field.id)) return undefined;
  const kindOf = (id: string) => {
    const ref = fieldOf(collection, id);
    return (ref && fieldDefinition(ref.type).formula) ?? null;
  };
  const value = evaluateFormula(
    node,
    (id) => {
      const ref = fieldOf(collection, id);
      const kind = kindOf(id);
      if (!ref || !kind) return undefined;
      if (ref.type === 'formula')
        return formulaValue(ref, record, collection, now, cal, [...using, field.id]);
      // 日程（D-295）在公式里是它的下一次。
      if (ref.type === 'schedule') return scheduleStatusOf(record, collection, ref, now, cal)?.next;
      const v = readValue(ref, record.values[id]);
      if (typeof v === 'number') return kind === 'number' ? v : undefined;
      if (typeof v !== 'string') return undefined;
      if (kind === 'date') return dayNumber(v);
      if (kind === 'time') return minuteOfDay(v);
      return kind === 'datetime' ? minuteNumber(v) : undefined;
    },
    todayNumber(now, cal),
    kindOf,
  );
  return value === undefined ? undefined : round(value, field.decimals ?? 2);
}

/**
 * 记录上某个日期类字段落在哪一天（本地日期 YYYY-MM-DD）：系统字段、日期是它自己，日期时间是它那一天
 * （D-279），钟点早于一天开始的钟点时算前一天（D-286）；别的字段没有。筛选的 inPeriod、日期比较、
 * 图表的按时间分组和按日子的统计（D-284）都用它。
 */
export function recordDay(
  record: DataRecord,
  collection: Collection,
  ref: string,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): string | undefined {
  const field = fieldOf(collection, ref);
  // 日程（D-295）落在它的下一次那天。
  if (field?.type === 'schedule') {
    const status = scheduleStatusOf(record, collection, field, now, cal);
    return status && dateOfDayNumber(status.next);
  }
  const value = recordValue(record, collection, ref, now, cal);
  const day = field && fieldDefinition(field.type).day;
  if (value === undefined || !day) return typeof value === 'string' ? value : undefined;
  const date = day(field, value);
  const hour = Number(String(value).slice(11, 13));
  return hour < cal.dayStartHour ? dateOfDayNumber(dayNumber(date)! - 1) : date;
}

/**
 * 一条记录上日程字段的状态（D-292、D-293）：规则读不出来时没有。做过的日子来自 lastDone 指向的日期或
 * 日期时间字段（按一天从几点开始归到哪一天），或者汇总字段被汇总的那些记录的日子（rollupDays）；
 * 没有 lastDone 或它没有值时只按规则本身算。
 */
/**
 * 汇总字段（D-288）在每条算好的记录上留下被汇总的那些记录各在哪一天（天数），日程的 lastDone 指向汇总时
 * 用它（D-293）：「每周 3 次」要知道这周做了几天，只看最近一次不够。只在内存里，不进数据库。
 */
export const rollupDays = new WeakMap<DataRecord, Map<string, readonly number[]>>();

export function scheduleStatusOf(
  record: DataRecord,
  collection: Collection,
  field: Extract<Field, { type: 'schedule' }>,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): ScheduleStatus | undefined {
  const rule = readValue(field, record.values[field.id]);
  if (rule === undefined) return undefined;
  return scheduleStatus(
    rule as Parameters<typeof scheduleStatus>[0],
    scheduleDoneDays(record, collection, field, now, cal),
    todayNumber(now, cal),
    cal,
  );
}

/** 一条记录上日程字段做过的日子（天数）：来自 lastDone 指向的字段或汇总（见 scheduleStatusOf）。 */
export function scheduleDoneDays(
  record: DataRecord,
  collection: Collection,
  field: Extract<Field, { type: 'schedule' }>,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): readonly number[] {
  const fromRollup = field.lastDone ? rollupDays.get(record)?.get(field.lastDone) : undefined;
  if (fromRollup) return fromRollup;
  const last = field.lastDone && recordDay(record, collection, field.lastDone, now, cal);
  const day = last ? dayNumber(last) : undefined;
  return day === undefined ? [] : [day];
}

/**
 * 记录上某个字段（包括系统字段）的值；系统字段的值是本地日期（一天开始的钟点之前算前一天，D-286），
 * 公式现算（用到 today 时按 now 那天）。
 */
export function recordValue(
  record: DataRecord,
  collection: Collection,
  ref: string,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): FieldValue | undefined {
  if (isSystemField(ref)) return dayOf(new Date(record[ref]), cal);
  const field = fieldOf(collection, ref);
  if (field?.type === 'formula') return formulaValue(field, record, collection, now, cal);
  return field ? readValue(field, record.values[ref]) : undefined;
}

// ---- 写入 ----

export type FieldIssue = { fieldId: string; code: 'required' | 'invalid' | 'tooLong' };

export type PreparedValues =
  { ok: true; values: Record<string, unknown> } | { ok: false; issues: FieldIssue[] };

/** 新记录的默认值：定义里的 default（日期的 today 换成今天）。 */
function defaultValue(field: Field, now: Date, cal: Calendar): FieldValue | undefined {
  const def = fieldDefinition(field.type);
  if (def.initial) return def.initial(field, now, dayOf(now, cal));
  return 'default' in field ? field.default : undefined;
}

const isBlank = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/**
 * 写入时严格校验：input 只包含要修改的字段（字段 ID → 表单值，空字符串表示清空）。
 * previous 为 null 表示新记录，此时套用默认值（今天按 cal 算）。已删除字段的旧值原样保留。
 */
export function prepareRecordValues(
  collection: Collection,
  input: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
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
    else raw = defaultValue(field, now, cal);
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
  cal: Calendar = DEFAULT_CALENDAR,
): boolean {
  const field = fieldOf(collection, condition.field);
  const target = condition.value;
  // 日期时间（D-279）按它那一天筛选：时间段、日期比较，以及 is / isNot 一个日期。
  if (condition.op === 'due') {
    const status =
      field?.type === 'schedule' && scheduleStatusOf(record, collection, field, now, cal);
    return !!status && scheduleDue(status, target as ScheduleDue, todayNumber(now, cal), cal);
  }
  // 日程（D-295）按它的下一次筛选。
  const byDay =
    field !== undefined &&
    (fieldDefinition(field.type).day !== undefined || field.type === 'schedule') &&
    (condition.op === 'inPeriod' ||
      condition.op === 'gt' ||
      condition.op === 'lt' ||
      (typeof target === 'string' && target.length === 10));
  const value = byDay
    ? recordDay(record, collection, condition.field, now, cal)
    : recordValue(record, collection, condition.field, now, cal);
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
      const [start, end] = periodRange(target as Period, now, cal);
      return value >= start && value <= end;
    }
  }
}

export function filterRecords(
  records: readonly DataRecord[],
  collection: Collection,
  conditions: readonly Condition[] | undefined,
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): DataRecord[] {
  if (!conditions?.length) return [...records];
  return records.filter((r) =>
    conditions.every((c) => matchesCondition(r, collection, c, now, cal)),
  );
}

/** 排序：空值总在最后；单选按选项顺序；日程按下一次（D-295）；默认按创建时间从新到旧。 */
export function sortRecords(
  records: readonly DataRecord[],
  collection: Collection,
  sort: { field: string; direction: 'asc' | 'desc' } | undefined,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): DataRecord[] {
  const { field, direction } = sort ?? { field: 'createdAt', direction: 'desc' as const };
  const sign = direction === 'asc' ? 1 : -1;
  const def = fieldOf(collection, field);
  const sortKey = def && fieldDefinition(def.type).sort;
  const key = (r: DataRecord): FieldValue | undefined => {
    if (isSystemField(field)) return r[field];
    if (def?.type === 'schedule') return scheduleStatusOf(r, collection, def, now, cal)?.next;
    const v = recordValue(r, collection, field, now, cal);
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
  linked?: LinkedGroups,
): StatGroup[] {
  return groupRecords(records, collection, groupBy, noChoice, linked).map(
    ({ records: list, ...g }) => ({
      ...g,
      value: aggregateRecords(list, collection, aggregate, fieldId),
    }),
  );
}

/** 按引用字段分组（D-326）时，被引用的那张表和它的记录：每条一组，标题同引用里显示的。 */
export interface LinkedGroups {
  collection: Collection;
  records: readonly DataRecord[];
  locale: Locale;
}

/**
 * 按单选或引用字段分组（groupedAggregate 的分组部分）：每组自己算值，例如每个习惯的连续天数（D-284）。
 * 顺序和「未选」一行同 groupedAggregate。引用字段（D-326）要 linked：被引用的表里每条记录一组
 * （按创建时间从旧到新，没有记录的也列出），没选的、指向已删除记录的算「未选」；没有 linked 时没有组。
 */
export function groupRecords(
  records: readonly DataRecord[],
  collection: Collection,
  groupBy: string,
  noChoice: string,
  linked?: LinkedGroups,
): (Omit<StatGroup, 'value'> & { records: DataRecord[] })[] {
  const field = fieldOf(collection, groupBy);
  const labels = new Map<string, string>();
  if (field?.type === 'choice') for (const o of field.options) labels.set(o.id, o.label);
  else if (field?.type === 'link' && linked) {
    for (const r of [...linked.records].sort((a, b) => a.createdAt - b.createdAt))
      labels.set(r.id, linkTitle(r, linked.collection, linked.locale));
  } else return [];
  const buckets = new Map<string | null, DataRecord[]>();
  for (const id of labels.keys()) buckets.set(id, []);
  for (const r of records) {
    const v = readValue(field, r.values[groupBy]);
    const key = typeof v === 'string' && labels.has(v) ? v : null;
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  return [...buckets.entries()].flatMap(([optionId, list]) =>
    optionId === null && list.length === 0
      ? []
      : [
          {
            optionId,
            label: optionId === null ? noChoice : labels.get(optionId)!,
            count: list.length,
            records: list,
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
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): string {
  if (isSystemField(ref)) return formatTimestamp(record[ref], locale);
  const field = fieldOf(collection, ref);
  if (field?.type === 'formula')
    return formatValue(field, recordValue(record, collection, ref, now, cal), locale);
  // 日程（D-292）：规则 · 下一次（今天、明天、过期几天或日期）。
  if (field?.type === 'schedule') {
    const status = scheduleStatusOf(record, collection, field, now, cal);
    const rule = formatValue(field, record.values[ref], locale);
    return status ? `${rule} · ${scheduleStatusText(status, todayNumber(now, cal), locale)}` : rule;
  }
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
