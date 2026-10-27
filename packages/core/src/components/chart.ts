import { z } from 'zod';

import { t } from '../messages';
import { boundedText, ConditionSchema, FieldRefSchema, IdSchema } from '../schema-base';
import {
  type ComponentDefinitionOf,
  defineComponent,
  isSystemField,
  NUMERIC_FIELD_TYPES,
} from './define';

const props = z.strictObject({
  collectionId: IdSchema,
  kind: z.enum(['bar', 'line', 'pie']),
  aggregate: z.enum(['count', 'sum', 'avg']),
  fieldId: IdSchema.optional(),
  group: z.enum(['day', 'week', 'month', 'choice']),
  dateField: FieldRefSchema.optional(),
  choiceField: IdSchema.optional(),
  periods: z.number().int().min(2).max(31).optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  title: boundedText(1, 60),
});

/**
 * 图表（D-249）：一张表的记录按时间段（最近几天 / 周 / 月）或单选字段分组，柱状、折线或饼图。
 * 饼图只能按单选字段分。只有固定几种画法和聚合，没有表达式；记录只在本机读取。
 */
export const chartComponent: ComponentDefinitionOf<'chart', typeof props> = defineComponent({
  type: 'chart',
  props,
  refs: { collectionId: { to: 'collection' }, filter: { to: 'filter' } },
  // D-249：求和、平均要数字字段；按单选分时要单选字段；按时间分时用日期字段；饼图只能按单选分。
  check: (c, { collection }) => {
    const problems: string[] = [];
    const field = (id: string) => collection!.fields.find((f) => f.id === id);
    if (c.props.aggregate !== 'count') {
      const f = c.props.fieldId ? field(c.props.fieldId) : undefined;
      if (!f || !NUMERIC_FIELD_TYPES.includes(f.type))
        problems.push(
          `${c.props.aggregate} needs fieldId set to a number, money, rating or formula field`,
        );
    }
    if (c.props.group === 'choice') {
      if (!c.props.choiceField || field(c.props.choiceField)?.type !== 'choice')
        problems.push('grouping by choice needs choiceField set to a choice field');
    } else {
      if (c.props.kind === 'pie')
        problems.push('a pie chart can only be grouped by a choice field');
      const d = c.props.dateField;
      if (d !== undefined && !isSystemField(d) && field(d)?.type !== 'date')
        problems.push(`dateField ${d} must be a date field of ${collection!.id}`);
    }
    return problems;
  },
  describe: (c, _config, ctx) => t(ctx.locale, 'describeChart', { v0: c.props.title }),
  edit: { text: [{ prop: 'title', max: 60 }], style: ['tone'] },
  ai: {
    doc: '{collectionId, kind: "bar"|"line"|"pie", aggregate: "count"|"sum"|"avg", fieldId? (number, money, rating or formula; not for count), group: "day"|"week"|"month"|"choice", dateField? (a date field or "createdAt"; default: the first date field), choiceField? (a choice field; required for group "choice"), periods? (2-31; default 7 days, 8 weeks, 6 months), filter?, title}: a pie chart needs group "choice"',
    rule: {
      n: 35,
      text: 'Charts ("a chart of spending per month", "每天花了多少的柱状图", "pie chart by category", "trend over the last weeks") → a chart component on the page that shows the table: amounts over time are kind "bar" or "line" with group "day" / "week" / "month" (periods = how many recent days / weeks / months, e.g. 12 for "the last year by month"); shares of a whole are kind "pie" with group "choice". Use aggregate "sum" with the money field for spending, "count" for how many entries. A single total or a per-category list without a picture is a stat (rule 34). You only choose how the chart is built; you never see the values.',
    },
  },
  example: {
    props: {
      collectionId: 'expenses',
      kind: 'bar',
      aggregate: 'sum',
      fieldId: 'amount',
      group: 'month',
      dateField: 'date',
      title: 'Spending by month',
    },
  },
});
