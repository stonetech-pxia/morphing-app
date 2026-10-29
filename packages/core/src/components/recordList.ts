import { z } from 'zod';

import { fieldDefinition } from '../fields';
import { t } from '../messages';
import { boundedText, ConditionSchema, FieldRefSchema, IdSchema, SortSchema } from '../schema-base';
import {
  collectionName,
  type ComponentDefinitionOf,
  defineComponent,
  isSystemField,
  NUMERIC_FIELD_TYPES,
} from './define';

/**
 * 右侧字段的显示格式（D-306）：elapsed = 从这个日期时间（或创建时间）到现在、或到 until，没有 until 的值时每秒在走；
 * progress = 这个数值和目标（固定数或这条记录的另一个数字类字段）的比例，画成环（默认）或条。
 */
const TrailingFormatSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('elapsed'), until: IdSchema.optional() }),
  z.strictObject({
    kind: z.literal('progress'),
    goal: z.union([z.number().positive().max(1_000_000_000), IdSchema]),
    style: z.enum(['ring', 'bar']).optional(),
  }),
]);

const props = z.strictObject({
  collectionId: IdSchema,
  display: z.enum(['list', 'cards', 'checklist', 'calendar']),
  titleField: FieldRefSchema,
  subtitleFields: z.array(FieldRefSchema).max(2).optional(),
  /** 显示在右侧的字段，例如金额。 */
  trailingField: FieldRefSchema.optional(),
  checkField: IdSchema.optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  sort: SortSchema.optional(),
  limit: z.number().int().min(1).max(100),
  emptyText: boundedText(1, 80).optional(),
  /** 月历（D-305）按哪个日期放进格子：日期、日期时间字段或系统字段；不写同图表的默认。 */
  dateField: FieldRefSchema.optional(),
  /** 月历按这个单选字段给每天上色（这一天最后一条的选项）。 */
  colorField: IdSchema.optional(),
  trailingFormat: TrailingFormatSchema.optional(),
});

/**
 * 记录列表：展示某张数据表的记录；checklist 用一个 checkbox 字段直接打勾；
 * calendar（D-305）是一个月的格子，点某一天列出当天的记录（limit 条，按 sort 排）。
 */
export const recordListComponent: ComponentDefinitionOf<'recordList', typeof props> =
  defineComponent({
    type: 'recordList',
    props,
    refs: {
      collectionId: { to: 'collection' },
      titleField: { to: 'field' },
      subtitleFields: { to: 'field', role: 'subtitleField' },
      trailingField: { to: 'field' },
      filter: { to: 'filter' },
      dateField: { to: 'field', types: ['date', 'datetime'] },
      colorField: { to: 'field', types: ['choice'] },
    },
    check: (c, { collection }) => {
      const problems: string[] = [];
      const field = (id: string) => collection!.fields.find((f) => f.id === id);
      const ref = (id: string, role: string) => {
        if (!isSystemField(id) && !field(id))
          problems.push(`${role} ${id} is not a field of ${collection!.id}`);
      };
      if (c.props.display === 'checklist') {
        const check = c.props.checkField ? field(c.props.checkField) : undefined;
        if (check?.type !== 'checkbox')
          problems.push('a checklist needs checkField set to a checkbox field');
      } else if (c.props.checkField !== undefined) {
        ref(c.props.checkField, 'checkField');
      }
      if (c.props.display !== 'calendar' && (c.props.dateField || c.props.colorField))
        problems.push('dateField and colorField only apply to display "calendar"');
      const format = c.props.trailingFormat;
      const trailing = c.props.trailingField;
      const trailingType = trailing
        ? isSystemField(trailing)
          ? 'datetime'
          : field(trailing)?.type
        : undefined;
      if (format && !trailing) problems.push(`trailingFormat ${format.kind} needs trailingField`);
      else if (format?.kind === 'elapsed') {
        if (trailingType !== 'datetime')
          problems.push(
            'trailingFormat elapsed needs trailingField set to a datetime field or "createdAt" (the start)',
          );
        if (format.until !== undefined && field(format.until)?.type !== 'datetime')
          problems.push(
            `trailingFormat until must be a datetime field of ${collection!.id} (the end)`,
          );
      } else if (format?.kind === 'progress') {
        if (!trailingType || !NUMERIC_FIELD_TYPES.includes(trailingType))
          problems.push(
            'trailingFormat progress needs trailingField set to a number, money, rating, duration, formula or rollup field',
          );
        const goal = typeof format.goal === 'string' ? field(format.goal) : undefined;
        if (typeof format.goal === 'string' && (!goal || !NUMERIC_FIELD_TYPES.includes(goal.type)))
          problems.push(
            `trailingFormat goal ${format.goal} must be a number or a number field of ${collection!.id}`,
          );
      }
      if (c.props.sort) {
        ref(c.props.sort.field, 'sort field');
        const sorted = field(c.props.sort.field);
        if (sorted && fieldDefinition(sorted.type).sort === false)
          problems.push(`can't sort by the ${sorted.type} field ${c.props.sort.field}`);
      }
      return problems;
    },
    describe: (c, config, ctx) =>
      t(ctx.locale, 'describe_list_0b528', { v0: collectionName(c.props.collectionId, config) }),
    edit: { text: [], style: ['tone'] },
    ai: {
      doc: '{collectionId, display: "list"|"cards"|"checklist"|"calendar", titleField, subtitleFields? (≤2), trailingField? (shown on the right, e.g. an amount), trailingFormat? (rule 50), checkField? (a checkbox field; required for "checklist"), dateField? + colorField? (calendar only, rule 49), filter?, sort? {field, direction: "asc"|"desc"}, limit (1-100), emptyText?}: tapping a record opens the built-in editor',
    },
    example: {
      props: {
        collectionId: 'expenses',
        display: 'list',
        titleField: 'category',
        subtitleFields: ['note', 'date'],
        trailingField: 'amount',
        sort: { field: 'date', direction: 'desc' },
        limit: 30,
      },
    },
  });
