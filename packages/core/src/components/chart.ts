import { z } from 'zod';

import { t } from '../messages';
import { boundedText, DaysSchema, filterSchema, GroupingSchema, IdSchema } from '../schema-base';
import { type LookDefinitionOf, defineLook, isSystemField, NUMERIC_FIELD_TYPES } from './define';

/** 图表读什么：一张表，按时间段或单选 / 引用字段分组（group 必填），每组一个数。 */
export const ChartSourceSchema = z.strictObject({
  table: IdSchema,
  // v33 结构里的 streak / daysSince / avgInterval 在合法配置里不可能出现（E3），v34 去掉。
  aggregate: z.enum(['count', 'sum', 'avg', 'distinctDays']),
  field: IdSchema.optional(),
  filter: filterSchema().optional(),
  /** distinctDays 按哪个日期算（按单选分组时）；按时间分组时就是 group.by。 */
  days: z.strictObject({ date: DaysSchema.shape.date }).optional(),
  group: GroupingSchema,
});
export type ChartSource = z.infer<typeof ChartSourceSchema>;

const shape = {
  show: z.strictObject({ kind: z.enum(['bar', 'line', 'pie']), title: boundedText(1, 60) }),
  source: ChartSourceSchema,
};

/**
 * 图表（D-249）：一张表的记录按时间段（最近几天 / 周 / 月，group.unit）或单选字段（group.by）分组，
 * 柱状、折线或饼图。饼图只能按单选分。D-336：也可以是引用字段，被引用的表里每条记录一个点。
 * 只有固定几种画法和聚合，没有表达式；记录只在本机读取。
 */
export const chartComponent: LookDefinitionOf<'chart', typeof shape> = defineLook({
  look: 'chart',
  shape,
  kind: 'container',
  layer: 'table',
  reads: 'table',
  writes: false,
  refs: { 'source.table': { to: 'table' }, 'source.filter': { to: 'filter' } },
  // D-249：求和、平均要数字字段；按单选分时要单选字段；按时间分时用日期字段；饼图只能按单选分。
  check: (c, { collection }) => {
    const problems: string[] = [];
    const field = (id: string) => collection!.fields.find((f) => f.id === id);
    const { aggregate, group } = c.source;
    if (aggregate !== 'count' && aggregate !== 'distinctDays') {
      const f = c.source.field ? field(c.source.field) : undefined;
      if (!f || !NUMERIC_FIELD_TYPES.includes(f.type))
        problems.push(`${aggregate} needs field set to a number, money, rating or formula field`);
    }
    if (group.showEmpty || group.filter)
      problems.push('a chart groups by time (unit) or by a choice or link field (by)');
    if (group.unit === undefined) {
      const type = group.by ? field(group.by)?.type : undefined;
      if (type !== 'choice' && type !== 'link')
        problems.push(
          'a chart needs source.group {unit: "day"|"week"|"month", by?: a date field} or {by: a choice or link field} (a link field: one point per entry of the linked table)',
        );
      if (group.last !== undefined) problems.push('source.group.last only applies to time groups');
    } else {
      if (c.show.kind === 'pie')
        problems.push('a pie chart can only be grouped by a choice or link field');
      const d = group.by;
      const dType = d === undefined ? undefined : field(d)?.type;
      if (d !== undefined && !isSystemField(d) && dType !== 'date' && dType !== 'datetime')
        problems.push(`source.group.by ${d} must be a date field of ${collection!.id}`);
      if (c.source.days) problems.push('days.date only applies when grouping by a choice field');
    }
    const date = c.source.days?.date;
    const dateType = date === undefined ? undefined : field(date)?.type;
    if (
      date !== undefined &&
      !isSystemField(date) &&
      dateType !== 'date' &&
      dateType !== 'datetime'
    )
      problems.push(`days.date ${date} must be a date field of ${collection!.id}`);
    return problems;
  },
  describe: (c, _config, ctx) => t(ctx.locale, 'describeChart', { v0: c.show.title }),
  edit: { text: [{ prop: 'title', max: 60 }], style: ['tone'] },
  ai: {
    doc: 'show {kind: "bar"|"line"|"pie", title}, source {table, aggregate: "count"|"sum"|"avg"|"distinctDays" (days with at least one entry), field? (number, money, rating, duration or formula; only for sum and avg), filter?, group: {unit: "day"|"week"|"month", by? (a date or datetime field or "createdAt"; default: the first date field), last? (2-31; default 7 days, 8 weeks, 6 months)} or {by: a choice field, or a link field for one point per entry of the linked table}}: a pie chart needs group {by: a choice or link field}',
    rule: {
      n: 35,
      text: 'Charts ("a chart of spending per month", "每天花了多少的柱状图", "pie chart by category", "trend over the last weeks") → a chart block on the page that shows the table: amounts over time are kind "bar" or "line" with source.group {unit: "day" / "week" / "month", last: how many recent days / weeks / months, e.g. 12 for "the last year by month"}; shares of a whole are kind "pie" with source.group {by: a choice field}. Use aggregate "sum" with the money field for spending, "count" for how many entries. A single total or a per-category list without a picture is a number block (rule 34). You only choose how the chart is built; you never see the values.',
    },
  },
  example: {
    show: { kind: 'bar', title: 'Spending by month' },
    source: {
      table: 'expenses',
      aggregate: 'sum',
      field: 'amount',
      group: { unit: 'month', by: 'date' },
    },
  },
});
