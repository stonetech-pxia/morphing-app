import { z } from 'zod';

import { t } from '../messages';
import { boundedText, ConditionSchema, FieldRefSchema, IdSchema, SortSchema } from '../schema-base';
import {
  collectionName,
  type ComponentDefinitionOf,
  defineComponent,
  isSystemField,
} from './define';

const props = z.strictObject({
  collectionId: IdSchema,
  display: z.enum(['list', 'cards', 'checklist']),
  titleField: FieldRefSchema,
  subtitleFields: z.array(FieldRefSchema).max(2).optional(),
  /** 显示在右侧的字段，例如金额。 */
  trailingField: FieldRefSchema.optional(),
  checkField: IdSchema.optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  sort: SortSchema.optional(),
  limit: z.number().int().min(1).max(100),
  emptyText: boundedText(1, 80).optional(),
});

/** 记录列表：展示某张数据表的记录；checklist 用一个 checkbox 字段直接打勾。 */
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
      if (c.props.sort) {
        ref(c.props.sort.field, 'sort field');
        if (field(c.props.sort.field)?.type === 'link')
          problems.push(`can't sort by the link field ${c.props.sort.field}`);
      }
      return problems;
    },
    describe: (c, config, ctx) =>
      t(ctx.locale, 'describe_list_0b528', { v0: collectionName(c.props.collectionId, config) }),
    edit: { text: [], style: ['tone'] },
    ai: {
      doc: '{collectionId, display: "list"|"cards"|"checklist", titleField, subtitleFields? (≤2), trailingField? (shown on the right, e.g. an amount), checkField? (a checkbox field; required for "checklist"), filter?, sort? {field, direction: "asc"|"desc"}, limit (1-100), emptyText?}: tapping a record opens the built-in editor',
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
