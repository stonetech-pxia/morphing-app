import { z } from 'zod';

import { t } from '../messages';
import {
  boundedText,
  ConditionSchema,
  FieldRefSchema,
  IdSchema,
  SEQUENCE_AGGREGATES,
  STREAK_UNITS,
} from '../schema-base';
import { type ComponentDefinitionOf, defineComponent, NUMERIC_FIELD_TYPES } from './define';

const props = z.strictObject({
  collectionId: IdSchema,
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max', ...SEQUENCE_AGGREGATES]),
  fieldId: IdSchema.optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  label: boundedText(1, 40),
  groupBy: IdSchema.optional(),
  dateField: FieldRefSchema.optional(),
  unit: z.enum(STREAK_UNITS).optional(),
  perUnit: z.number().int().min(1).max(50).optional(),
  skipField: IdSchema.optional(),
  skipOption: IdSchema.optional(),
  /** 目标（D-307）：显示「3 / 5」和进度。 */
  goal: z.number().positive().max(1_000_000_000).optional(),
  /** 和上一段同期比（D-308）：筛选里唯一的 inPeriod 条件换成上一段。 */
  compare: z.literal('previous').optional(),
});

const SEQUENCE: readonly string[] = SEQUENCE_AGGREGATES;

/**
 * 统计：对一张表（可筛选）计数或求和、平均、最小、最大。
 * groupBy（D-248）：按一个单选字段分组，每个选项一行（没选的记录另算一行）。
 * 按顺序的聚合（D-284）：streak（当前连续，下面写最佳连续）、daysSince、avgInterval、distinctDays，
 * 按 dateField（默认第一个日期字段，没有就用创建时间）算日子；unit、perUnit、skipField + skipOption 只给 streak。
 * goal（D-307）显示「值 / 目标」和进度；compare（D-308）和上一段同期比（compare.ts）。
 */
export const statComponent: ComponentDefinitionOf<'stat', typeof props> = defineComponent({
  type: 'stat',
  props,
  refs: {
    collectionId: { to: 'collection' },
    filter: { to: 'filter' },
    groupBy: { to: 'field', types: ['choice'] },
    dateField: { to: 'field', types: ['date', 'datetime'] },
    skipField: { to: 'field', types: ['choice'] },
  },
  check: (c, { collection }) => {
    const { aggregate, fieldId, unit, perUnit, skipField, skipOption, dateField } = c.props;
    const problems: string[] = [];
    if (c.props.goal !== undefined && (aggregate === 'daysSince' || aggregate === 'avgInterval'))
      problems.push(`goal can't be used with ${aggregate}: it is a number of days, not an amount`);
    if (c.props.compare !== undefined) {
      if (aggregate === 'streak' || aggregate === 'daysSince' || aggregate === 'avgInterval')
        problems.push(`compare can't be used with ${aggregate}: it doesn't depend on a period`);
      if ((c.props.filter ?? []).filter((x) => x.op === 'inPeriod').length !== 1)
        problems.push(
          'compare needs a filter with one inPeriod condition (e.g. thisMonth): that period is compared with the previous one',
        );
    }
    if (aggregate !== 'count' && !SEQUENCE.includes(aggregate)) {
      const f = fieldId ? collection!.fields.find((x) => x.id === fieldId) : undefined;
      if (!f || !NUMERIC_FIELD_TYPES.includes(f.type))
        problems.push(`${aggregate} needs fieldId set to a number, money, rating or formula field`);
    }
    if (dateField !== undefined && !SEQUENCE.includes(aggregate))
      problems.push(`dateField only applies to aggregate ${SEQUENCE_AGGREGATES.join(', ')}`);
    if (aggregate !== 'streak') {
      if (unit !== undefined || perUnit !== undefined || skipField || skipOption)
        problems.push('unit, perUnit, skipField and skipOption only apply to aggregate "streak"');
      return problems;
    }
    if ((skipField === undefined) !== (skipOption === undefined))
      problems.push(
        'skipField and skipOption go together: a choice field and one of its option ids',
      );
    const skip = collection!.fields.find((x) => x.id === skipField);
    if (skipOption && skip?.type === 'choice' && !skip.options.some((o) => o.id === skipOption))
      problems.push(
        `skipOption must be an option id of ${skip.id}: ${skip.options.map((o) => o.id).join(', ')}`,
      );
    return problems;
  },
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_stat_c1587', { v0: c.props.label }),
  edit: { text: [], style: ['tone'], backdrop: true },
  ai: {
    doc: '{collectionId, aggregate: "count"|"sum"|"avg"|"min"|"max"|"streak"|"daysSince"|"avgInterval"|"distinctDays", fieldId? (a number, money, rating, duration or formula field; only for sum, avg, min, max), filter?, label, groupBy? (a choice field: one row per option, e.g. spending per category), dateField? (for the day-based aggregates rule 44: a date or datetime field or "createdAt"; default: the first date field), unit?: "day"|"week"|"month", perUnit? (1-50), skipField? + skipOption? (unit, perUnit and skip: streak only), goal? (a number: shows "3 / 5" and progress), compare?: "previous" (rule 52)}',
    rule: {
      n: 34,
      text: 'Totals per category ("how much per category", "每个分类花了多少", "count of tasks by status") → a stat with groupBy set to that choice field (aggregate count, sum or avg as asked); it lists every option with its own value and a "not set" row for entries without one. Grouping by anything other than a choice field is not possible in a stat.',
    },
  },
  example: {
    props: {
      collectionId: 'expenses',
      aggregate: 'sum',
      fieldId: 'amount',
      label: 'This month',
      filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
    },
  },
});
