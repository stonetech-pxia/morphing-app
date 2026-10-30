import { z } from 'zod';

import { fieldDefinition } from '../fields';
import { t } from '../messages';
import { GROUP_BY_TYPES, GROUP_UNITS } from '../list-groups-schema';
import { RowActionSchema } from '../record-ops-schema';
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
  display: z.enum(['list', 'cards', 'checklist', 'calendar', 'tiles', 'board']),
  titleField: FieldRefSchema,
  subtitleFields: z.array(FieldRefSchema).max(2).optional(),
  /** 显示在右侧的字段，例如金额。 */
  trailingField: FieldRefSchema.optional(),
  checkField: IdSchema.optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  sort: SortSchema.optional(),
  limit: z.number().int().min(1).max(100),
  emptyText: boundedText(1, 80).optional(),
  /** 每一行右边的按钮（D-300）：第一个 when 都满足的显示出来，点了改这一行或新建一条。 */
  rowActions: z.array(RowActionSchema).min(1).max(3).optional(),
  /** 月历（D-305）按哪个日期放进格子：日期、日期时间字段或系统字段；不写同图表的默认。 */
  dateField: FieldRefSchema.optional(),
  /** 月历按这个单选字段给每天上色（这一天最后一条的选项）。 */
  colorField: IdSchema.optional(),
  trailingFormat: TrailingFormatSchema.optional(),
  /** 看板（D-313）按这个单选字段分栏：每个选项一栏，再加一栏「未分」。只给 board 用。 */
  groupField: IdSchema.optional(),
  /** 点一条打开这个页面（D-332，page.recordOf 是这张表），不是编辑页。 */
  opens: IdSchema.optional(),
  /**
   * 分段（D-337，list / cards / checklist）：单选、引用每个选项一段，日期类按 groupUnit 分，日程按下一次分。
   * 每段一个标题和条数，点标题折叠；limit 是每段最多几条。
   */
  groupBy: FieldRefSchema.optional(),
  groupUnit: z.enum(GROUP_UNITS).optional(),
  /** 单选、引用分段时没有记录的段也列出（版块）。 */
  showEmpty: z.literal(true).optional(),
  /**
   * 就地添加（D-339）：每段标题、月历选中的那天、看板每栏下面有「添加」，打开新记录的表单，预设这一段的值
   * 和列表筛选里的「等于」条件；不分段的列表在最下面有一个。
   */
  addHere: z.literal(true).optional(),
});

/**
 * 记录列表：展示某张数据表的记录；checklist 用一个 checkbox 字段直接打勾；
 * calendar（D-305）是一个月的格子，点某一天列出当天的记录（limit 条，按 sort 排）；
 * tiles（D-311）是大圆块网格，点一下执行这一块的行操作；board（D-313）是按 groupField 分栏的看板，
 * 拖到另一栏就是改这个字段。
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
      dateField: { to: 'field', types: ['date', 'datetime', 'schedule'] },
      colorField: { to: 'field', types: ['choice'] },
      groupField: { to: 'field', types: ['choice'] },
      groupBy: { to: 'field' },
    },
    check: (c, { collection, config }) => {
      const problems: string[] = [];
      if (c.props.opens !== undefined) {
        const target = config.pages.find((p) => p.id === c.props.opens);
        if (!target) problems.push(`opens ${c.props.opens} is not a page`);
        else if (target.recordOf !== c.props.collectionId)
          problems.push(
            `opens ${c.props.opens} must be a page for one entry of ${c.props.collectionId} (recordOf: "${c.props.collectionId}")`,
          );
      }
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
      if (c.props.display === 'board') {
        if (!c.props.groupField) problems.push('a board needs groupField set to a choice field');
      } else if (c.props.groupField !== undefined) {
        problems.push('groupField only applies to display "board"');
      }
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
      if (c.props.groupBy !== undefined) {
        const by = c.props.groupBy;
        const type = isSystemField(by) ? 'date' : field(by)?.type;
        if (!['list', 'cards', 'checklist'].includes(c.props.display))
          problems.push('groupBy only applies to display "list", "cards" or "checklist"');
        else if (type && !GROUP_BY_TYPES.includes(type))
          problems.push(
            `groupBy ${by} must be a ${GROUP_BY_TYPES.join(', ')} field or createdAt / updatedAt`,
          );
        const dated = type !== 'choice' && type !== 'link';
        if (c.props.groupUnit && !dated)
          problems.push('groupUnit only applies when grouping by a date or schedule field');
        if (c.props.showEmpty && dated)
          problems.push('showEmpty only applies when grouping by a choice or link field');
      } else if (c.props.groupUnit || c.props.showEmpty) {
        problems.push('groupUnit and showEmpty need groupBy');
      }
      if (c.props.addHere && c.props.display === 'tiles')
        problems.push('addHere does not apply to display "tiles"');
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
      doc: '{collectionId, display: "list"|"cards"|"checklist"|"calendar"|"tiles"|"board", titleField, subtitleFields? (≤2), trailingField? (shown on the right, e.g. an amount), trailingFormat? (rule 51), checkField? (a checkbox field; required for "checklist"), dateField? + colorField? (calendar only, rule 50), groupField? (a choice field; required for "board", board only, rule 54), groupBy? + groupUnit? ("day"|"week"|"month") + showEmpty? (list/cards/checklist sections, rule 61), addHere? (rule 63), filter?, sort? {field, direction: "asc"|"desc"}, limit (1-100; tiles show at most 24, board per column), emptyText?, rowActions? (1-3, rule 49; tiles: rule 53)}: tapping a record opens the built-in editor',
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
