import { z } from 'zod';

import { t } from '../messages';
import { boundedText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';
import { LeafComponentSchema } from './leaves';

/** 分组最多容纳的子组件数。 */
export const GROUP_MAX_CHILDREN = 12;

const props = z.strictObject({
  title: boundedText(1, 60).optional(),
  layout: z.enum(['stack', 'row', 'grid']),
  columns: z.union([z.literal(2), z.literal(3)]).optional(),
});
const extra = { children: z.array(LeafComponentSchema).max(GROUP_MAX_CHILDREN) };

/** 分组：把若干组件排成竖排、横排或网格。分组不能再嵌套分组。 */
export const groupComponent: ComponentDefinitionOf<'group', typeof props, typeof extra> =
  defineComponent({
    type: 'group',
    props,
    extra,
    describe: (c, _config, ctx) => {
      const layout = {
        stack: t(ctx.locale, 'describe_stacked_00ce0'),
        row: t(ctx.locale, 'describe_row_be7f8'),
        grid: t(ctx.locale, 'describe_grid_3f0e7'),
      }[c.props.layout];
      const name = c.props.title ? t(ctx.locale, 'describe__5caf2', { v0: c.props.title }) : '';
      return t(ctx.locale, 'describe_group_86cab', { v0: layout, v1: name });
    },
    edit: { text: [{ prop: 'title', max: 60, optional: true }], style: ['tone', 'align'] },
  });
