import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { NUMERIC_FIELD_TYPES } from './components/define';
import { conditionProblems } from './conditions';
import { aggregateRecords, filterRecords, type DataRecord } from './data';
import { round } from './field-values';
import { expandCollection } from './related';
import type { Collection, Component, WorkspaceConfig } from './schema';

// 统计相减（D-337）：「这个合计 − 另一个合计」，另一个可以在别的表。例如待分配 = 收入 − 分配出去的钱、
// 余额 = 收入 − 支出、净资产 = 资产 − 负债。只有计数和求和：平均、最小、最大相减没有意义。
// 检查放在这里而不是 stat 的定义里：要用到筛选条件的检查（conditions.ts），组件定义引用它会让加载绕圈。

type StatComponent = Extract<Component, { type: 'stat' }>;
export type StatMinus = NonNullable<StatComponent['props']['minus']>;

/** stat 的 minus 的问题（文字发给 AI）。collection 是 stat 自己的表（换过查找、汇总的）。 */
export function statMinusProblems(
  c: StatComponent,
  collection: Collection,
  config: WorkspaceConfig,
  /** 组件所在页面给哪张表的一条记录用（D-342）。 */
  recordOf?: string,
): string[] {
  const minus = c.props.minus;
  if (!minus) return [];
  const problems: string[] = [];
  if (c.props.aggregate !== 'count' && c.props.aggregate !== 'sum')
    problems.push(`minus only works with aggregate count or sum, not ${c.props.aggregate}`);
  if (c.props.groupBy)
    problems.push("minus can't be used with groupBy: there is one total to subtract from");
  if (c.props.compare) problems.push("minus can't be used with compare");
  const table = config.collections.find((x) => x.id === minus.collectionId);
  if (!table) return [...problems, `minus: data table ${minus.collectionId} does not exist`];
  const other = expandCollection(config.collections, table);
  if (minus.aggregate === 'sum') {
    const f = minus.fieldId ? other.fields.find((x) => x.id === minus.fieldId) : undefined;
    if (!f || !NUMERIC_FIELD_TYPES.includes(f.type)) {
      problems.push(
        `minus: sum needs fieldId set to a number, money, rating, duration or formula field of ${other.id}`,
      );
    } else {
      const own = c.props.fieldId
        ? collection.fields.find((x) => x.id === c.props.fieldId)
        : undefined;
      if (own?.type === 'money' && f.type === 'money' && own.currency !== f.currency)
        problems.push(
          `minus: ${other.id}.${f.id} is in ${f.currency} but ${collection.id}.${own.id} is in ${own.currency}`,
        );
    }
  }
  problems.push(...conditionProblems(minus.filter, other, recordOf).map((p) => `minus: ${p}`));
  return problems;
}

/** 减去 minus 之后的值。value 为空（没有可算的）时仍为空；records 是 minus 那张表算好的记录。 */
export function minusValue(
  value: number | null,
  minus: StatMinus,
  collection: Collection,
  records: readonly DataRecord[],
  now: Date,
  cal: Calendar = DEFAULT_CALENDAR,
): number | null {
  if (value === null) return null;
  const matched = filterRecords(records, collection, minus.filter, now, cal);
  const other = aggregateRecords(matched, collection, minus.aggregate, minus.fieldId) ?? 0;
  return round(value - other, 4);
}
