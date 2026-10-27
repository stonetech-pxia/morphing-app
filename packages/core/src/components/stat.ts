import { z } from 'zod';

import { t } from '../messages';
import { boundedText, ConditionSchema, IdSchema } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent, NUMERIC_FIELD_TYPES } from './define';

const props = z.strictObject({
  collectionId: IdSchema,
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  fieldId: IdSchema.optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  label: boundedText(1, 40),
  groupBy: IdSchema.optional(),
});

/**
 * 统计：对一张表（可筛选）计数或求和、平均、最小、最大。
 * groupBy（D-248）：按一个单选字段分组，每个选项一行（没选的记录另算一行）。
 */
export const statComponent: ComponentDefinitionOf<'stat', typeof props> = defineComponent({
  type: 'stat',
  props,
  refs: {
    collectionId: { to: 'collection' },
    filter: { to: 'filter' },
    groupBy: { to: 'field', types: ['choice'] },
  },
  check: (c, { collection }) => {
    if (c.props.aggregate === 'count') return [];
    const f = c.props.fieldId
      ? collection!.fields.find((x) => x.id === c.props.fieldId)
      : undefined;
    return !f || !NUMERIC_FIELD_TYPES.includes(f.type)
      ? [`${c.props.aggregate} needs fieldId set to a number, money, rating or formula field`]
      : [];
  },
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_stat_c1587', { v0: c.props.label }),
  edit: { text: [], style: ['tone'] },
});
