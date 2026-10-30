import { z } from 'zod';

import { t } from '../messages';
import {
  AGGREGATES,
  boundedText,
  DaysSchema,
  filterSchema,
  GroupingSchema,
  IdSchema,
  SEQUENCE_AGGREGATES,
} from '../schema-base';
import { type LookDefinitionOf, defineLook, NUMERIC_FIELD_TYPES } from './define';

/** 汇总读法（数字块、图表共用）：一张表筛出来的记录算一个数，或者按组每组一个数。 */
export const NumberSourceSchema = z.strictObject({
  table: IdSchema,
  aggregate: z.enum(AGGREGATES),
  field: IdSchema.optional(),
  filter: filterSchema().optional(),
  /** 按日子算的聚合（D-284）用哪个日期、怎么算连续。 */
  days: DaysSchema.optional(),
  /** 按单选或引用字段每组一行（D-248、D-336）。 */
  group: GroupingSchema.optional(),
  /** 目标（D-307）：显示「3 / 5」和进度。 */
  goal: z.number().positive().max(1_000_000_000).optional(),
  /** 和上一段同期比（D-308）：筛选里唯一的 inPeriod 条件换成上一段。 */
  compare: z.literal('previous').optional(),
  /** 减去另一个合计（D-337）：可以是另一张表，例如收入 − 分配出去的钱。检查在 stat-minus.ts。 */
  minus: z
    .strictObject({
      table: IdSchema,
      aggregate: z.enum(['count', 'sum']),
      field: IdSchema.optional(),
      filter: filterSchema().optional(),
    })
    .optional(),
});
export type NumberSource = z.infer<typeof NumberSourceSchema>;

const shape = { show: z.strictObject({ label: boundedText(1, 40) }), source: NumberSourceSchema };

const SEQUENCE: readonly string[] = SEQUENCE_AGGREGATES;

/**
 * 数字（原 stat）：对一张表（可筛选）计数或求和、平均、最小、最大。
 * group.by（D-248）：按一个单选或引用字段分组，每个选项一行（没选的记录另算一行）。
 * 按顺序的聚合（D-284）：streak（当前连续，下面写最佳连续）、daysSince、avgInterval、distinctDays，
 * 按 days.date（默认第一个日期字段，没有就用创建时间）算日子；days.unit、perUnit、skip 只给 streak。
 * goal（D-307）显示「值 / 目标」和进度；compare（D-308）和上一段同期比（compare.ts）。
 * minus（D-337）：显示「这个合计 − 另一个合计」，只有计数和求和（stat-minus.ts）。
 */
export const numberComponent: LookDefinitionOf<'number', typeof shape> = defineLook({
  look: 'number',
  shape,
  kind: 'container',
  layer: 'table',
  reads: 'table',
  writes: false,
  refs: {
    'source.table': { to: 'table' },
    'source.filter': { to: 'filter' },
    'source.group.by': { to: 'field', role: 'groupBy', types: ['choice', 'link'] },
    'source.days.date': { to: 'field', role: 'dateField', types: ['date', 'datetime'] },
    'source.days.skip.field': { to: 'field', role: 'skipField', types: ['choice'] },
  },
  check: (c, { collection }) => {
    const { aggregate, field, days, group } = c.source;
    const problems: string[] = [];
    if (aggregate === 'latest') problems.push('latest only applies to a rollup field');
    if (c.source.goal !== undefined && (aggregate === 'daysSince' || aggregate === 'avgInterval'))
      problems.push(`goal can't be used with ${aggregate}: it is a number of days, not an amount`);
    if (c.source.compare !== undefined) {
      if (aggregate === 'streak' || aggregate === 'daysSince' || aggregate === 'avgInterval')
        problems.push(`compare can't be used with ${aggregate}: it doesn't depend on a period`);
      if ((c.source.filter ?? []).filter((x) => x.op === 'inPeriod').length !== 1)
        problems.push(
          'compare needs a filter with one inPeriod condition (e.g. thisMonth): that period is compared with the previous one',
        );
    }
    if (group && (group.unit || group.last || group.showEmpty || group.filter || !group.by))
      problems.push('a number groups by a choice or link field only: source.group {by}');
    if (aggregate !== 'count' && aggregate !== 'latest' && !SEQUENCE.includes(aggregate)) {
      const f = field ? collection!.fields.find((x) => x.id === field) : undefined;
      if (!f || !NUMERIC_FIELD_TYPES.includes(f.type))
        problems.push(`${aggregate} needs field set to a number, money, rating or formula field`);
    }
    if (days?.date !== undefined && !SEQUENCE.includes(aggregate))
      problems.push(`days.date only applies to aggregate ${SEQUENCE_AGGREGATES.join(', ')}`);
    if (aggregate !== 'streak') {
      if (days && (days.unit !== undefined || days.perUnit !== undefined || days.skip))
        problems.push('days.unit, perUnit and skip only apply to aggregate "streak"');
      return problems;
    }
    const skip = collection!.fields.find((x) => x.id === days?.skip?.field);
    if (
      days?.skip &&
      skip?.type === 'choice' &&
      !skip.options.some((o) => o.id === days.skip!.option)
    )
      problems.push(
        `days.skip.option must be an option id of ${skip.id}: ${skip.options.map((o) => o.id).join(', ')}`,
      );
    return problems;
  },
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_stat_c1587', { v0: c.show.label }),
  edit: { text: [], style: ['tone'], backdrop: true },
  ai: {
    doc: 'show {label}, source {table, aggregate: "count"|"sum"|"avg"|"min"|"max"|"streak"|"daysSince"|"avgInterval"|"distinctDays", field? (a number, money, rating, duration or formula field; only for sum, avg, min, max), filter?, group? {by: a choice or link field} (one row per option, e.g. spending per category), days? {date? (for the day-based aggregates: a date or datetime field or "createdAt"; default: the first date field), unit?: "day"|"week"|"month", perUnit? (1-50), skip? {field, option}} (unit, perUnit and skip: streak only), goal? (a number: shows "3 / 5" and progress), compare?: "previous", minus? ({table, aggregate: "count"|"sum", field?, filter?}: shows this total minus that one)} (rule 33)',
    rule: {
      n: 33,
      text: 'Summaries of a table are number and chart blocks: one source {table, aggregate, field?, filter?, group?, days?} read the same way in both; you only choose how it is built and never see the values. Totals per category ("how much per category", "每个分类花了多少", "count of tasks by status") → a number block with source.group {by: that choice field} (aggregate count, sum or avg as asked); it lists every option with its own value and a "not set" row for entries without one. A link field works too (D-336): one row per entry of the linked table, e.g. spending per category when categories are their own table, as a summary block of its own. When the value belongs on each entry of that linked table instead ("for each habit show …", "每个客户显示…", a streak on each habit when habits are their own table), it is a rollup field on that table, shown in its list (rule 42), not a number block grouped by the link. A number block can\'t be grouped by other fields. Charts ("a chart of spending per month", "每天花了多少的柱状图", "pie chart by category", "trend over the last weeks") → a chart block on the page that shows the table: amounts over time are kind "bar" or "line" with source.group {unit: "day" / "week" / "month", last: how many recent days / weeks / months, e.g. 12 for "the last year by month"}; shares of a whole are kind "pie" with source.group {by: a choice field}. Use aggregate "sum" with the money field for spending, "count" for how many entries; a single total or a per-category list without a picture is a number block. Habits and "how long since" ("给每个习惯显示连续天数", "show my streak", "days since I last watered each plant", "average cycle length", "how many days I exercised this month") → a number block with a day-based aggregate: "streak" (current run of days in a row, with the best run under it; today not logged yet does not break it), "daysSince" (days since the latest entry), "avgInterval" (average days between entry days), "distinctDays" (days with at least one entry). One row per habit / plant / car → source.group {by: the choice field that names it} (when they are their own table: the rollup above). "3 times a week" → days {unit: "week", perUnit: 3}. An option meaning "skipped" or "rest day" → days.skip {field: that choice field, option: its option id}: such days neither break nor add. A chart can only use "distinctDays" (e.g. days exercised per week); the others are number blocks. A goal or a comparison: source.goal (a positive number) shows "value / goal" with progress ("喝水显示今天的进度，目标 8 杯" → aggregate sum or count, filter inPeriod "today", goal 8); compare: "previous" compares with the previous period ("本月支出和上月比", "vs last week"): the filter must have exactly one inPeriod condition; it shows the previous value for the same days so far (this month to date vs the same days of last month; last30days vs the 30 days before) and ↑/↓ with the percent; not for streak, daysSince or avgInterval. One total minus another ("还剩多少钱可以分配", "ready to assign = income minus everything assigned", "balance = income − spending", "net worth = assets − debts", "stock = in − out") → source.minus {table, aggregate: "count" or "sum", field?, filter?}: it shows the block\'s own total minus that one, which may come from another table; the block\'s aggregate must be count or sum too, both amounts in the same currency, and no group or compare with minus. Without a period filter both totals cover all entries, so money not spent stays counted month after month (a zero-based budget: categories with assignments and spending as linked tables, "available" = a rollup of everything assigned minus a rollup of everything spent, rule 42).',
    },
  },
  example: {
    show: { label: 'This month' },
    source: {
      table: 'expenses',
      aggregate: 'sum',
      field: 'amount',
      filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
    },
  },
});
