import { boardColumns, boardField, MAX_TILES, type BoardColumn } from './board-view';
import { calendarOf, dateOfDayNumber, type Calendar } from './calendar';
import { chartSeries, type ChartPoint } from './chart';
import { previousFilter } from './compare';
import type { ChartSource } from './components/chart';
import type { NumberSource } from './components/number';
import type { RecordLook, RecordSource } from './components/records';
import {
  aggregateRecords,
  fieldOf,
  filterRecords,
  groupRecords,
  matchesCondition,
  sortRecords,
  type Aggregate as ValueAggregate,
  type DataRecord,
  type LinkedGroups,
} from './data';
import { FILES_COLLECTION, FILES_TABLE, fileKindOf } from './files-table';
import { filterPresets, listGroups } from './list-groups';
import { t } from './messages';
import { currentMonth, monthDays, type MonthDay } from './month-view';
import { computeRecords, expandCollection, relatedCollectionIds } from './related';
import {
  RECORD_REF,
  type Collection,
  type Condition,
  type Locale,
  type Period,
  type WorkspaceConfig,
} from './schema';
import { dateFieldOf, isSequenceAggregate, sequenceValue } from './sequence';
import { minusValue } from './stat-minus';

// 共用的读法（v34 NEW_FORMAT §2.4、§3.3）：块的 source 读出什么。记录块的 6 种外观、数字、图表、文件列表
// 都从这里读，App 只负责画（以前每个组件各写一遍筛选、排序、分组）。筛选、排序、分组（Grouping）、
// 按日子算（Days）都只有一份实现：这里把 source 交给 data.ts、list-groups.ts、board-view.ts、month-view.ts、
// chart.ts、compare.ts、sequence.ts、stat-minus.ts 里的算法。查找、汇总、上一条的值按 related.ts 算好（只读）。
// 纯函数：记录从调用方来（App 的数据库里没删的记录），从不进入配置，也不发给 AI（D-042）。

export interface SourceContext {
  config: WorkspaceConfig;
  /** 表 ID → 存着的、没删的记录（要包括 sourceTableIds 列出的表）。查找、汇总、上一条在这里算。 */
  records: ReadonlyMap<string, readonly DataRecord[]>;
  now: Date;
  /** 不写用配置里的设置（calendarOf）。 */
  cal?: Calendar;
  locale: Locale;
  /** 给一条记录用的页面（page.of，D-342）打开的那一条：筛选里的 "$record" 换成它。 */
  recordId?: string;
}

/** 一张表读出来的样子：存的表（改记录用）、显示用的表（查找、汇总换成它们显示的字段）、算好的记录。 */
export interface TableRead {
  table: Collection;
  view: Collection;
  records: DataRecord[];
}

const tableCache = new WeakMap<SourceContext, Map<string, TableRead | undefined>>();

const calOf = (ctx: SourceContext): Calendar => ctx.cal ?? calendarOf(ctx.config);

/** 一张表算好的记录（同一个 ctx 只算一次）；表不存在时为 undefined。 */
export function readTable(ctx: SourceContext, tableId: string): TableRead | undefined {
  let cache = tableCache.get(ctx);
  if (!cache) tableCache.set(ctx, (cache = new Map()));
  if (cache.has(tableId)) return cache.get(tableId);
  const tables = ctx.config.data.tables;
  const table = tables.find((c) => c.id === tableId);
  const read = table && {
    table,
    view: expandCollection(tables, table),
    records: computeRecords(tables, tableId, ctx.records, ctx.now, calOf(ctx)),
  };
  cache.set(tableId, read);
  return read;
}

/** 筛选里的 "$record" 换成打开的那一条（没有打开的那一条时不换，条件什么都不满足）。 */
function bind(filter: readonly Condition[] | undefined, ctx: SourceContext): Condition[] {
  return (filter ?? []).map((c) =>
    c.value === RECORD_REF && ctx.recordId !== undefined ? { ...c, value: ctx.recordId } : c,
  );
}

/** 按引用字段分组时被引用的那张表和它算好的记录（D-336）；不是引用字段时为 undefined。 */
function linkedOf(
  ctx: SourceContext,
  view: Collection,
  by: string | undefined,
  filter?: readonly Condition[],
): LinkedGroups | undefined {
  const field = by === undefined ? undefined : fieldOf(view, by);
  if (field?.type !== 'link') return undefined;
  const target = readTable(ctx, field.table);
  if (!target) return undefined;
  const records = filter?.length
    ? filterRecords(target.records, target.table, filter, ctx.now, calOf(ctx))
    : target.records;
  return { collection: target.table, records, locale: ctx.locale };
}

/**
 * 读这个 source 要哪些表的记录（App 先读它们再调用这里的函数）：这张表和它的查找、汇总要的表，
 * 按引用字段分组时被引用的表，minus 的表。
 */
export function sourceTableIds(
  source: { table: string; group?: { by?: string }; minus?: { table: string } },
  config: WorkspaceConfig,
): string[] {
  const tables = config.data.tables;
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    const c = id === undefined ? undefined : tables.find((x) => x.id === id);
    if (c) for (const x of relatedCollectionIds(tables, c)) ids.add(x);
  };
  add(source.table);
  const own = tables.find((x) => x.id === source.table);
  const by = source.group?.by;
  const link = own && by !== undefined ? fieldOf(own, by) : undefined;
  if (link?.type === 'link') add(link.table);
  add(source.minus?.table);
  return [...ids];
}

// ---- 记录块（list cards checklist tiles board calendar）----

/** 列表的一段（source.group）：count 是这一段一共几条，records 最多 limit 条。 */
export interface SourceGroup {
  key: string;
  label: string;
  /** 在这一段添加时分组字段预设成什么（list-groups.ts 的 preset）。 */
  preset?: unknown;
  count: number;
  records: DataRecord[];
}

/** 月历一个月：每天的记录（不截 limit，选中那天用 dayShown），记录最多的那天有几条。 */
export interface MonthRead {
  month: string;
  days: Map<number, MonthDay>;
  max: number;
}

export interface RecordsRead {
  table: Collection;
  view: Collection;
  /** 换好 "$record" 的筛选（就地添加时带上它的等于条件，hereValues）。 */
  filter: Condition[];
  /** 分组用的字段：分段、看板的 group.by，月历的日期（不写 by 时是默认的日期字段）。 */
  by?: string;
  /** 筛选、排好序的全部记录。 */
  rows: DataRecord[];
  /** 不分组时显示的：最多 limit 条（大圆块最多 MAX_TILES 个）。 */
  shown: DataRecord[];
  /** list / cards / checklist 有 source.group 时：每段。 */
  groups?: SourceGroup[];
  /** board：每栏（每栏最多 limit 条）；分栏字段不对时没有。 */
  columns?: BoardColumn[];
  /** calendar：这个月（options.month，默认今天所在的月）。 */
  days?: MonthRead;
}

/** 一个记录块读出来的东西；表不存在时为 undefined。 */
export function readRecords(
  block: { look: RecordLook; source: RecordSource; show?: { color?: string | undefined } },
  ctx: SourceContext,
  options: { month?: string } = {},
): RecordsRead | undefined {
  const { source, look } = block;
  const read = readTable(ctx, source.table);
  if (!read) return undefined;
  const { table, view, records } = read;
  const { now, locale } = ctx;
  const cal = calOf(ctx);
  const filter = bind(source.filter, ctx);
  const filtered = filterRecords(records, view, filter, now, cal);
  const rows = sortRecords(filtered, view, source.sort, now, cal);
  const limit = look === 'tiles' ? Math.min(source.limit, MAX_TILES) : source.limit;
  const base: RecordsRead = { table, view, filter, rows, shown: rows.slice(0, limit) };
  const group = source.group;
  if (look === 'tiles' || !group) return base;
  if (look === 'board') {
    const field = boardField(view, group.by);
    if (!field) return base;
    const linked = linkedOf(ctx, view, field.id, bind(group.filter, ctx));
    return { ...base, by: field.id, columns: boardColumns(field, rows, source.limit, linked) };
  }
  if (look === 'calendar') {
    const date = dateFieldOf(view, group.by);
    const month = options.month ?? currentMonth(now, cal);
    // 同一天的先后由 monthDays 定（不跟着排序）。
    const { days, max } = monthDays(
      filtered,
      view,
      { date, color: block.show?.color },
      month,
      now,
      cal,
    );
    return { ...base, by: date, days: { month, days, max } };
  }
  const by = dateFieldOf(view, group.by);
  const groups = listGroups(rows, view, group, {
    locale,
    now,
    cal,
    linked: linkedOf(ctx, view, by),
  }).map((g) => ({ ...g, count: g.records.length, records: g.records.slice(0, source.limit) }));
  return { ...base, by, groups };
}

/** 月历选中的那天列出的记录：有 source.sort 时按它排，最多 limit 条。 */
export function dayShown(
  read: RecordsRead,
  source: RecordSource,
  day: number,
  ctx: SourceContext,
): DataRecord[] {
  const list = read.days?.days.get(day)?.records ?? [];
  return (
    source.sort ? sortRecords(list, read.view, source.sort, ctx.now, calOf(ctx)) : list
  ).slice(0, source.limit);
}

/** 月历在某天添加时日期字段预设成什么：日期字段是这一天，日程是「一次，这一天」，日期时间、系统字段不预设。 */
export function dayValue(read: RecordsRead, day: number): unknown {
  const type = read.by === undefined ? undefined : fieldOf(read.view, read.by)?.type;
  const date = dateOfDayNumber(day);
  return type === 'date' ? date : type === 'schedule' ? { repeat: 'once', date } : undefined;
}

/**
 * "$here"（就地添加，D-349）：列表筛选里的等于条件（filterPresets）加上这一段、这一栏、这一天的值
 * （groupValue：段的 preset、栏的 option、dayValue；undefined / null 不预设）。
 */
export function hereValues(read: RecordsRead, groupValue?: unknown): Record<string, unknown> {
  const values = filterPresets(read.view, read.filter);
  if (read.by !== undefined && groupValue !== undefined && groupValue !== null)
    values[read.by] = groupValue;
  return values;
}

// ---- 数字（number）----

export interface NumberGroup {
  /** 选项 ID（引用字段是被引用的那条的 ID）；null 是「未选」。 */
  optionId: string | null;
  label: string;
  count: number;
  value: number | null;
  best?: number;
  /** compare：这一组上一段同期的值。 */
  previous?: number | null;
}

export interface NumberRead {
  view: Collection;
  /** 减过 minus 的值；没有可算的为 null。 */
  value: number | null;
  /** streak 的最佳连续。 */
  best?: number;
  /** compare：上一段同期（筛选里唯一的 inPeriod 换成上一段）的值。 */
  previous?: { period: Period; value: number | null };
  /** source.group：每个选项一行（D-248、D-336）。 */
  groups?: NumberGroup[];
}

/** 数字块的值（D-248、D-284、D-307、D-308、D-337）；表不存在时为 undefined。 */
export function readNumber(source: NumberSource, ctx: SourceContext): NumberRead | undefined {
  const read = readTable(ctx, source.table);
  if (!read) return undefined;
  const { view, records } = read;
  const { now } = ctx;
  const cal = calOf(ctx);
  const filter = bind(source.filter, ctx);
  const valueOf = (list: DataRecord[]): { value: number | null; best?: number } =>
    isSequenceAggregate(source.aggregate)
      ? sequenceValue(list, view, source.aggregate, source.days, now, cal)
      : source.aggregate === 'latest'
        ? { value: null }
        : {
            value: aggregateRecords(list, view, source.aggregate as ValueAggregate, source.field),
          };
  const matched = filterRecords(records, view, filter, now, cal);
  const own = valueOf(matched);
  const out: NumberRead = { view, value: own.value };
  if (own.best !== undefined) out.best = own.best;
  const minus = source.minus;
  const other = minus && readTable(ctx, minus.table);
  if (minus && other) {
    out.value = minusValue(
      own.value,
      { ...minus, filter: bind(minus.filter, ctx) },
      other.view,
      other.records,
      now,
      cal,
    );
  }
  const previous = source.compare ? previousFilter(filter, now, cal) : null;
  const before = previous && filterRecords(records, view, previous.filter, now, cal);
  if (previous && before) out.previous = { period: previous.period, value: valueOf(before).value };
  const by = source.group?.by;
  if (by !== undefined) {
    const noChoice = t(ctx.locale, 'statNoChoice');
    const linked = linkedOf(ctx, view, by);
    const earlier =
      before &&
      new Map(
        groupRecords(before, view, by, noChoice, linked).map((g) => [
          g.optionId,
          valueOf(g.records).value,
        ]),
      );
    out.groups = groupRecords(matched, view, by, noChoice, linked).map((g) => {
      const v = valueOf(g.records);
      return {
        optionId: g.optionId,
        label: g.label,
        count: g.count,
        value: v.value,
        ...(v.best === undefined ? {} : { best: v.best }),
        ...(earlier ? { previous: earlier.get(g.optionId) ?? null } : {}),
      };
    });
  }
  return out;
}

// ---- 图表（chart）----

/** 图表的点（饼图再交给 pieSlices）；表不存在时为 undefined。 */
export function readChart(
  source: ChartSource,
  ctx: SourceContext,
): { view: Collection; points: ChartPoint[] } | undefined {
  const read = readTable(ctx, source.table);
  if (!read) return undefined;
  const { view, records } = read;
  const cal = calOf(ctx);
  const matched = filterRecords(records, view, bind(source.filter, ctx), ctx.now, cal);
  const linked = source.group.unit ? undefined : linkedOf(ctx, view, source.group.by);
  const points = chartSeries(
    matched,
    view,
    source,
    ctx.now,
    t(ctx.locale, 'statNoChoice'),
    cal,
    linked,
  );
  return { view, points };
}

// ---- 文件列表（files，读 $files）----

/** 文件列表要用到的文件信息（App 的文件记录有这几项）。 */
export interface FileMeta {
  mimeType: string;
  name: string;
  size: number;
  createdAt: number;
  source: 'picked' | 'generated';
}

interface FilesSource {
  table?: typeof FILES_TABLE;
  filter?: readonly Condition[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

/** 一份文件当成 $files 的一条记录（kind 按 MIME 类型认，fileKindOf）。 */
const fileRecord = (f: FileMeta): DataRecord => ({
  id: '',
  collectionId: FILES_TABLE,
  values: { name: f.name, kind: fileKindOf(f.mimeType), size: f.size, source: f.source },
  createdAt: f.createdAt,
  updatedAt: f.createdAt,
});

/** 文件列表的筛选（source.filter，条件之间是「并且」）。 */
export function filesFilter(
  source: FilesSource,
  now: Date = new Date(),
  cal?: Calendar,
): (file: FileMeta) => boolean {
  const filter = source.filter ?? [];
  return (file) => {
    const r = fileRecord(file);
    return filter.every((c) => matchesCondition(r, FILES_COLLECTION, c, now, cal));
  };
}

/** 文件列表显示哪些：筛选，排序（不写是创建时间从新到旧），最多 limit 个。 */
export function readFiles<T extends FileMeta>(
  source: FilesSource,
  files: readonly T[],
  now: Date = new Date(),
  cal?: Calendar,
): T[] {
  const keep = filesFilter(source, now, cal);
  const kept = files.filter(keep);
  const byRecord = new Map(kept.map((f) => [fileRecord(f), f]));
  const sorted = sortRecords([...byRecord.keys()], FILES_COLLECTION, source.sort, now, cal);
  return sorted.slice(0, source.limit ?? sorted.length).map((r) => byRecord.get(r)!);
}
