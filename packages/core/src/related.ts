import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { chartDateField } from './chart';
import { conditionProblems } from './conditions';
import {
  aggregateRecords,
  fieldOf,
  isSystemField,
  matchesCondition,
  recordDay,
  recordValue,
  rollupDays,
  type DataRecord,
  type FieldValue,
} from './data';
import type { FieldCheckContext } from './fields/define';
import { dayNumber, parseFormula } from './formula';
import {
  NUMERIC_FIELD_TYPES,
  type Collection,
  type Condition,
  type Field,
  type FieldOf,
} from './schema';
import { isSequenceAggregate, sequenceValue } from './sequence';

// 查找、汇总、上一条（D-287–D-291）：这三种字段的值由别的记录算出来，不存进记录、不能填，只在本机算
// （记录从不发给 AI，D-042、D-113）。
// - expandCollection：把它们换成它们显示的那种字段（查找金额就是金额字段），显示、筛选、排序、公式、
//   统计和图表就都照那种字段的定义走，不用另写一套。
// - computeRecords：把算出来的值放进记录的副本（按表建一次索引：引用字段 → 记录，不是每条都扫整张表）。
// - relatedProblems：字段定义的检查，包括不能绕回自己、最多叠 MAX_RELATED_DEPTH 层。

/** 查找、汇总、上一条最多叠几层（D-290）：查找一个汇总算两层。 */
export const MAX_RELATED_DEPTH = 3;

type Computed = FieldOf<'lookup' | 'rollup' | 'previous'>;
const isComputed = (f: Field): f is Computed =>
  f.type === 'lookup' || f.type === 'rollup' || f.type === 'previous';

/** 一个字段：哪张表的哪个字段。 */
interface Ref {
  collectionId: string;
  fieldId: string;
}
const refKey = (r: Ref) => `${r.collectionId}.${r.fieldId}`;

const tableOf = (collections: readonly Collection[], id: string) =>
  collections.find((c) => c.id === id);

/** 引用字段指向的表。 */
function linkTarget(collections: readonly Collection[], collection: Collection, linkId: string) {
  const link = fieldOf(collection, linkId);
  return link?.type === 'link' ? tableOf(collections, link.collectionId) : undefined;
}

/** 汇总按哪个日期算（latest、按日子的聚合、period）：同统计和图表，默认第一个日期字段。 */
const rollupDate = (source: Collection, f: FieldOf<'rollup'>) => chartDateField(source, f);

/** 上一条按哪个日期排。 */
const previousDate = (collection: Collection, f: FieldOf<'previous'>) =>
  chartDateField(collection, f);

/** 汇总要满足的条件：filter 加上 period（按日期字段落在这段时间里）。 */
function rollupConditions(source: Collection, f: FieldOf<'rollup'>): Condition[] {
  const conditions = [...(f.filter ?? [])];
  if (f.period) conditions.push({ field: rollupDate(source, f), op: 'inPeriod', value: f.period });
  return conditions;
}

/**
 * 一个字段直接用到哪些字段（同一张表或别的表）：查循环、算层数、决定先算哪个都用它。
 * hop：这一步是查找、汇总或上一条（算一层）；公式用同一张表的字段，不算层。
 */
function depsOf(
  collections: readonly Collection[],
  collection: Collection,
  field: Field,
): { refs: Ref[]; hop: boolean } {
  const here = (fieldId: string): Ref => ({ collectionId: collection.id, fieldId });
  switch (field.type) {
    case 'formula': {
      const parsed = parseFormula(field.expression);
      return { refs: parsed.ok ? parsed.refs.map(here) : [], hop: false };
    }
    case 'lookup': {
      const target = linkTarget(collections, collection, field.linkField);
      const refs = [here(field.linkField)];
      if (target) refs.push({ collectionId: target.id, fieldId: field.fieldId });
      return { refs, hop: true };
    }
    case 'rollup': {
      const source = tableOf(collections, field.collectionId);
      if (!source) return { refs: [], hop: true };
      const there = (fieldId: string): Ref => ({ collectionId: source.id, fieldId });
      const ids = [
        field.linkField,
        field.fieldId,
        rollupDate(source, field),
        field.skipField,
        ...rollupConditions(source, field).map((c) => c.field),
      ];
      return {
        refs: ids.flatMap((id) => (id && !isSystemField(id) ? [there(id)] : [])),
        hop: true,
      };
    }
    case 'previous': {
      const ids = [field.fieldId, previousDate(collection, field), field.groupBy];
      return {
        refs: ids.flatMap((id) => (id && !isSystemField(id) ? [here(id)] : [])),
        hop: true,
      };
    }
    default:
      return { refs: [], hop: false };
  }
}

function fieldAt(collections: readonly Collection[], ref: Ref) {
  const c = tableOf(collections, ref.collectionId);
  const f = c && fieldOf(c, ref.fieldId);
  return c && f ? { collection: c, field: f } : undefined;
}

// ---- 换成它显示的那种字段 ----

/** 换个 ID 和名字，去掉 required、default（算出来的值不用填）。 */
function renamed(src: Field, as: Field): Field {
  const copy: Record<string, unknown> = { ...src, id: as.id, name: as.name };
  delete copy.required;
  delete copy.default;
  return copy as Field;
}

/** 公式存不了，取到的是它算出来的数字：换成数字或金额字段。 */
function asStored(f: Field): Field {
  if (f.type !== 'formula') return f;
  return f.currency
    ? { id: f.id, name: f.name, type: 'money', currency: f.currency }
    : { id: f.id, name: f.name, type: 'number', decimals: f.decimals, unit: f.unit };
}

/**
 * 计算字段显示成哪种字段；定义对不上（引用的表或字段没了、绕回自己、太深）时为 undefined，
 * 这时保留它自己（只能看有没有值，显示为空）。
 */
function viewField(
  collections: readonly Collection[],
  collection: Collection,
  field: Computed,
  seen: readonly string[],
): Field | undefined {
  const key = refKey({ collectionId: collection.id, fieldId: field.id });
  if (seen.includes(key) || seen.length > MAX_RELATED_DEPTH) return undefined;
  const valueOf = (ref: Ref): Field | undefined => {
    const at = fieldAt(collections, ref);
    if (!at) return undefined;
    const f = isComputed(at.field)
      ? viewField(collections, at.collection, at.field, [...seen, key])
      : at.field;
    return f && asStored(f);
  };
  switch (field.type) {
    case 'lookup': {
      const target = linkTarget(collections, collection, field.linkField);
      const src = target && valueOf({ collectionId: target.id, fieldId: field.fieldId });
      return src && renamed(src, field);
    }
    case 'previous': {
      const src = valueOf({ collectionId: collection.id, fieldId: field.fieldId });
      return src && renamed(src, field);
    }
    case 'rollup': {
      const source = tableOf(collections, field.collectionId);
      if (!source) return undefined;
      if (field.aggregate === 'count' || isSequenceAggregate(field.aggregate)) return field;
      if (field.aggregate === 'latest') {
        const ref = field.fieldId ?? rollupDate(source, field);
        if (isSystemField(ref)) return { id: field.id, name: field.name, type: 'date' };
        const src = valueOf({ collectionId: source.id, fieldId: ref });
        return src && renamed(src, field);
      }
      const src = field.fieldId && valueOf({ collectionId: source.id, fieldId: field.fieldId });
      if (!src || !NUMERIC_FIELD_TYPES.includes(src.type)) return undefined;
      // 评分的合计、平均不再是 1–5 的评分。
      if (src.type === 'rating') return { id: field.id, name: field.name, type: 'number' };
      return renamed(src, field);
    }
  }
}

const expanded = new WeakMap<readonly Collection[], Map<string, Collection>>();

/**
 * 这张表的字段里，查找、汇总、上一条换成它们显示的那种字段（ID 和名字不变），给显示、筛选、排序、
 * 公式、统计和图表用。写记录（prepareRecordValues）和表单仍然用原来的表。同一份 collections 结果不变。
 */
export function expandCollection(
  collections: readonly Collection[],
  collection: Collection,
): Collection {
  if (!collection.fields.some(isComputed)) return collection;
  let cache = expanded.get(collections);
  if (!cache) expanded.set(collections, (cache = new Map()));
  const hit = cache.get(collection.id);
  if (hit && cache.get(`raw:${collection.id}`) === collection) return hit;
  const result = {
    ...collection,
    fields: collection.fields.map((f) =>
      isComputed(f) ? (viewField(collections, collection, f, []) ?? f) : f,
    ),
  };
  cache.set(collection.id, result);
  cache.set(`raw:${collection.id}`, collection);
  return result;
}

/** 算这张表要读哪些表的记录（它自己在最前面）：查找指向的表、汇总的来源表，一层层往下。 */
export function relatedCollectionIds(
  collections: readonly Collection[],
  collection: Collection,
): string[] {
  const tables = new Set([collection.id]);
  const seen = new Set<string>();
  const walk = (ref: Ref) => {
    if (seen.has(refKey(ref))) return;
    seen.add(refKey(ref));
    const at = fieldAt(collections, ref);
    if (!at) return;
    tables.add(at.collection.id);
    for (const dep of depsOf(collections, at.collection, at.field).refs) walk(dep);
  };
  for (const f of collection.fields)
    if (isComputed(f) || f.type === 'formula') walk({ collectionId: collection.id, fieldId: f.id });
  return [...tables];
}

// ---- 算值 ----

/** 排序用的日期：系统字段是时间戳，日期、日期时间是文字（同一个字段之间比）。 */
function dateKey(r: DataRecord, view: Collection, ref: string, now: Date, cal: Calendar) {
  if (isSystemField(ref)) return r[ref];
  const v = recordValue(r, view, ref, now, cal);
  return typeof v === 'string' ? v : undefined;
}

const byDate = <T extends { key: number | string; record: DataRecord }>(a: T, b: T) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : a.record.createdAt - b.record.createdAt;

/**
 * 一张表的记录，查找、汇总、上一条的值算好放进去（副本，不改 records 里的记录）。records 是表 ID →
 * 没删的记录，要包括 relatedCollectionIds 列出的表。日期和「今天」按 now 和 cal（D-286）。
 * 记录里这几种字段原来存着的值（改字段类型之前留下的）一律不用。
 */
export function computeRecords(
  collections: readonly Collection[],
  collectionId: string,
  records: ReadonlyMap<string, readonly DataRecord[]>,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): DataRecord[] {
  const collection = tableOf(collections, collectionId);
  const own = records.get(collectionId) ?? [];
  if (!collection?.fields.some(isComputed)) return [...own];

  const work = new Map<string, DataRecord[]>();
  const byId = new Map<string, Map<string, DataRecord>>();
  const indexes = new Map<string, Map<string, DataRecord[]>>();
  const done = new Set<string>();
  const active = new Set<string>();
  const view = (c: Collection) => expandCollection(collections, c);

  const rows = (id: string): DataRecord[] => {
    let list = work.get(id);
    if (!list) {
      const c = tableOf(collections, id);
      const computedIds = c ? c.fields.filter(isComputed).map((f) => f.id) : [];
      list = (records.get(id) ?? []).map((r) => {
        const values = { ...r.values };
        for (const f of computedIds) delete values[f];
        return { ...r, values };
      });
      work.set(id, list);
    }
    return list;
  };
  const recordById = (id: string, recordId: string) => {
    let map = byId.get(id);
    if (!map) byId.set(id, (map = new Map(rows(id).map((r) => [r.id, r]))));
    return map.get(recordId);
  };
  /** 引用字段 → 指向每条记录的那些记录（每张表、每个引用字段建一次）。 */
  const linkIndex = (id: string, linkId: string) => {
    const key = `${id}.${linkId}`;
    let index = indexes.get(key);
    if (!index) {
      index = new Map();
      for (const r of rows(id)) {
        const to = r.values[linkId];
        if (typeof to !== 'string') continue;
        const list = index.get(to);
        if (list) list.push(r);
        else index.set(to, [r]);
      }
      indexes.set(key, index);
    }
    return index;
  };
  const put = (r: DataRecord, fieldId: string, v: FieldValue | null | undefined) => {
    if (v === undefined || v === null) delete r.values[fieldId];
    else r.values[fieldId] = v;
  };

  const fill = (c: Collection, f: Computed) => {
    const list = rows(c.id);
    switch (f.type) {
      case 'lookup': {
        const target = linkTarget(collections, c, f.linkField);
        for (const r of list) {
          const to = r.values[f.linkField];
          const linked = target && typeof to === 'string' ? recordById(target.id, to) : undefined;
          put(r, f.id, linked && recordValue(linked, view(target!), f.fieldId, now, cal));
        }
        return;
      }
      case 'rollup': {
        const source = tableOf(collections, f.collectionId);
        if (!source) return list.forEach((r) => put(r, f.id, undefined));
        const sv = view(source);
        const index = linkIndex(source.id, f.linkField);
        const conditions = rollupConditions(source, f);
        const dateRef = rollupDate(source, f);
        for (const r of list) {
          let linked = index.get(r.id) ?? [];
          if (conditions.length > 0)
            linked = linked.filter((x) =>
              conditions.every((cond) => matchesCondition(x, sv, cond, now, cal)),
            );
          put(r, f.id, rollupValue(f, linked, sv, dateRef, now, cal));
          // 日程的「上次完成」指向这个汇总时要用全部日子（D-293）。
          const days = linked.flatMap((x) => {
            const day = recordDay(x, sv, dateRef, now, cal);
            const n = day === undefined ? undefined : dayNumber(day);
            return n === undefined ? [] : [n];
          });
          let byField = rollupDays.get(r);
          if (!byField) rollupDays.set(r, (byField = new Map()));
          byField.set(f.id, days);
        }
        return;
      }
      case 'previous': {
        const cv = view(c);
        const dateRef = previousDate(c, f);
        const groups = new Map<unknown, { key: number | string; record: DataRecord }[]>();
        for (const r of list) {
          put(r, f.id, undefined);
          const key = dateKey(r, cv, dateRef, now, cal);
          if (key === undefined) continue;
          const g = f.groupBy ? r.values[f.groupBy] : '';
          const group = typeof g === 'string' ? g : '';
          const items = groups.get(group);
          if (items) items.push({ key, record: r });
          else groups.set(group, [{ key, record: r }]);
        }
        for (const items of groups.values()) {
          let last: FieldValue | undefined;
          for (const { record } of items.sort(byDate)) {
            const own = recordValue(record, cv, f.fieldId, now, cal);
            put(record, f.id, last);
            if (own !== undefined) last = own;
          }
        }
        return;
      }
    }
  };

  /** 先算它用到的，再算它自己；绕回来的（校验挡住了，旧数据里可能有）不再往下走，值为空。 */
  const ensure = (ref: Ref) => {
    const key = refKey(ref);
    if (done.has(key) || active.has(key)) return;
    const at = fieldAt(collections, ref);
    if (!at) return;
    active.add(key);
    for (const dep of depsOf(collections, at.collection, at.field).refs) ensure(dep);
    if (isComputed(at.field)) fill(at.collection, at.field);
    active.delete(key);
    done.add(key);
  };
  for (const f of collection.fields) ensure({ collectionId, fieldId: f.id });
  return rows(collectionId);
}

/**
 * 读出要用到的那些表的记录（listRecords 只给没删的），算好这张表的记录，连同显示用的表（D-291）。
 * App 的列表、统计、图表、记录页、导出 CSV 和快捷操作「读记录」共用。
 */
export async function loadComputedRecords(
  listRecords: (collectionId: string) => Promise<DataRecord[]>,
  collections: readonly Collection[],
  collection: Collection,
  now: Date = new Date(),
  cal: Calendar = DEFAULT_CALENDAR,
): Promise<{ view: Collection; records: DataRecord[] }> {
  const records = new Map<string, DataRecord[]>();
  for (const id of relatedCollectionIds(collections, collection))
    records.set(id, await listRecords(id));
  return {
    view: expandCollection(collections, collection),
    records: computeRecords(collections, collection.id, records, now, cal),
  };
}

/** 一条记录的汇总值：没有可用的值时为 undefined（求和是 0、计数是 0、连续是 0）。 */
function rollupValue(
  f: FieldOf<'rollup'>,
  linked: readonly DataRecord[],
  source: Collection,
  dateRef: string,
  now: Date,
  cal: Calendar,
): FieldValue | undefined {
  switch (f.aggregate) {
    case 'count':
      return linked.length;
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
      return aggregateRecords(linked, source, f.aggregate, f.fieldId) ?? undefined;
    case 'latest': {
      const ref = f.fieldId ?? dateRef;
      let best: { key: number | string; record: DataRecord; value: FieldValue } | undefined;
      for (const record of linked) {
        const key = dateKey(record, source, dateRef, now, cal);
        const value = recordValue(record, source, ref, now, cal);
        if (key === undefined || value === undefined) continue;
        const item = { key, record, value };
        if (!best || byDate(best, item) < 0) best = item;
      }
      return best?.value;
    }
    default: {
      const spec = {
        aggregate: f.aggregate,
        unit: f.unit,
        perUnit: f.perUnit,
        skip:
          f.skipField && f.skipOption
            ? { fieldId: f.skipField, optionId: f.skipOption }
            : undefined,
      };
      return (
        sequenceValue(linked, source, spec, { dateField: dateRef, now, cal }).value ?? undefined
      );
    }
  }
}

// ---- 检查（D-290）----

const DATE_TYPES: readonly string[] = ['date', 'datetime'];

/** 字段定义的问题（文字会发给 AI）：先看定义本身，没问题再看会不会绕回自己、叠得太深。 */
export function relatedProblems(
  field: Field,
  { config, collection }: FieldCheckContext,
): { code: string; message: string }[] {
  if (!isComputed(field)) return [];
  const collections = config.collections;
  const problems = shapeProblems(collections, collection, field);
  if (problems.length === 0) {
    const start = { collectionId: collection.id, fieldId: field.id };
    const loop = loopOf(collections, start);
    if (loop)
      problems.push(
        `uses itself through ${loop.join(' → ')}; a lookup, rollup or previous field can never come back to itself`,
      );
    else {
      const chain = chainOf(collections, start, new Map(), new Set());
      if (chain.length > MAX_RELATED_DEPTH)
        problems.push(
          `lookups, rollups and previous fields can build on each other at most ${MAX_RELATED_DEPTH} levels deep; here it is ${chain.length} (${chain.join(' → ')}); look the value up from a table closer to it`,
        );
    }
  }
  return problems.map((p) => ({ code: 'data', message: `${collection.id}.${field.id}: ${p}` }));
}

function shapeProblems(
  collections: readonly Collection[],
  collection: Collection,
  field: Computed,
): string[] {
  const missing = (c: Collection, id: string) =>
    `${id} is not a field of ${c.id} (fields: ${c.fields.map((f) => f.id).join(', ')})`;
  const dateProblem = (c: Collection, id: string | undefined) => {
    if (id === undefined || isSystemField(id)) return [];
    const f = fieldOf(expandCollection(collections, c), id);
    return f && DATE_TYPES.includes(f.type)
      ? []
      : [`dateField ${id} must be a date or datetime field of ${c.id} or "createdAt"`];
  };
  switch (field.type) {
    case 'lookup': {
      const link = fieldOf(collection, field.linkField);
      if (link?.type !== 'link')
        return [`linkField ${field.linkField} must be a link field of ${collection.id}`];
      const target = tableOf(collections, link.collectionId);
      // 引用的表不存在：引用字段自己会报。
      if (!target) return [];
      return fieldOf(target, field.fieldId) ? [] : [missing(target, field.fieldId)];
    }
    case 'previous': {
      const problems: string[] = [];
      if (!fieldOf(collection, field.fieldId)) problems.push(missing(collection, field.fieldId));
      problems.push(...dateProblem(collection, field.dateField));
      if (field.groupBy !== undefined) {
        const g = fieldOf(collection, field.groupBy);
        if (g?.type !== 'choice' && g?.type !== 'link')
          problems.push(
            `groupBy ${field.groupBy} must be a choice or link field of ${collection.id}`,
          );
      }
      return problems;
    }
    case 'rollup':
      return rollupProblems(collections, collection, field, missing, dateProblem);
  }
}

function rollupProblems(
  collections: readonly Collection[],
  collection: Collection,
  f: FieldOf<'rollup'>,
  missing: (c: Collection, id: string) => string,
  dateProblem: (c: Collection, id: string | undefined) => string[],
): string[] {
  const source = tableOf(collections, f.collectionId);
  if (!source) return [`collectionId ${f.collectionId} is not a data table`];
  const link = fieldOf(source, f.linkField);
  if (link?.type !== 'link')
    return [`linkField ${f.linkField} must be a link field of ${source.id}`];
  if (link.collectionId !== collection.id)
    return [
      `${source.id}.${f.linkField} links to ${link.collectionId}, not to ${collection.id}; a rollup counts the entries of ${source.id} whose link field points at this table`,
    ];
  const sv = expandCollection(collections, source);
  const problems: string[] = [];
  const numeric =
    f.aggregate === 'sum' ||
    f.aggregate === 'avg' ||
    f.aggregate === 'min' ||
    f.aggregate === 'max';
  if (numeric) {
    const target = f.fieldId ? fieldOf(sv, f.fieldId) : undefined;
    if (!target || !NUMERIC_FIELD_TYPES.includes(target.type))
      problems.push(
        `${f.aggregate} needs fieldId set to a number, money, rating, duration or formula field of ${source.id}`,
      );
  } else if (f.aggregate === 'latest') {
    if (f.fieldId && !fieldOf(sv, f.fieldId)) problems.push(missing(source, f.fieldId));
  } else if (f.fieldId !== undefined)
    problems.push('fieldId only applies to aggregate sum, avg, min, max and latest');
  problems.push(...dateProblem(source, f.dateField));
  if (f.aggregate !== 'streak') {
    if (f.unit !== undefined || f.perUnit !== undefined || f.skipField || f.skipOption)
      problems.push('unit, perUnit, skipField and skipOption only apply to aggregate "streak"');
  } else {
    if ((f.skipField === undefined) !== (f.skipOption === undefined))
      problems.push(
        'skipField and skipOption go together: a choice field and one of its option ids',
      );
    const skip = f.skipField ? fieldOf(source, f.skipField) : undefined;
    if (f.skipField && skip?.type !== 'choice')
      problems.push(`skipField ${f.skipField} must be a choice field of ${source.id}`);
    else if (
      skip?.type === 'choice' &&
      f.skipOption &&
      !skip.options.some((o) => o.id === f.skipOption)
    )
      problems.push(
        `skipOption must be an option id of ${skip.id}: ${skip.options.map((o) => o.id).join(', ')}`,
      );
  }
  problems.push(...conditionProblems(f.filter, sv));
  return problems;
}

/** 从 start 出发沿着用到的字段走，能回到自己时返回那一圈（表.字段），否则 null。 */
function loopOf(collections: readonly Collection[], start: Ref): string[] | null {
  const seen = new Set<string>();
  const walk = (ref: Ref, path: string[]): string[] | null => {
    const at = fieldAt(collections, ref);
    if (!at) return null;
    for (const next of depsOf(collections, at.collection, at.field).refs) {
      const key = refKey(next);
      if (key === refKey(start)) return [...path, key];
      if (seen.has(key)) continue;
      seen.add(key);
      const found = walk(next, [...path, key]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [refKey(start)]);
}

/** 叠得最深的一串查找、汇总、上一条（表.字段，从 ref 开始）。 */
function chainOf(
  collections: readonly Collection[],
  ref: Ref,
  memo: Map<string, string[]>,
  visiting: Set<string>,
): string[] {
  const key = refKey(ref);
  const hit = memo.get(key);
  if (hit) return hit;
  const at = fieldAt(collections, ref);
  if (!at || visiting.has(key)) return [];
  visiting.add(key);
  const { refs, hop } = depsOf(collections, at.collection, at.field);
  let deepest: string[] = [];
  for (const dep of refs) {
    const chain = chainOf(collections, dep, memo, visiting);
    if (chain.length > deepest.length) deepest = chain;
  }
  visiting.delete(key);
  const result = hop ? [key, ...deepest] : deepest;
  memo.set(key, result);
  return result;
}
