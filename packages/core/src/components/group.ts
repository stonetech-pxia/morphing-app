import { z } from 'zod';

import { t } from '../messages';
import { boundedText } from '../schema-base';
import { type LookDefinitionOf, defineLook, lookSchema } from './define';
import { LeafComponentSchema } from './leaves';

/** 分组最多容纳的子块数。 */
export const GROUP_MAX_CHILDREN = 12;

const show = z.strictObject({
  title: boundedText(1, 60).optional(),
  layout: z.enum(['stack', 'row', 'grid']),
  columns: z.union([z.literal(2), z.literal(3)]).optional(),
});

/** 分组里面的那层分组（Q3：允许再多一层，里面那层不能再放分组）。 */
export const InnerGroupSchema = lookSchema('group', {
  show,
  children: z.array(LeafComponentSchema).max(GROUP_MAX_CHILDREN),
});

/** 分组的子块：可以放进分组的块，或者一层分组。 */
export const GroupChildSchema = z.discriminatedUnion('look', [
  ...LeafComponentSchema.options,
  InnerGroupSchema,
]);

const shape = { show, children: z.array(GroupChildSchema).max(GROUP_MAX_CHILDREN) };

/** 分组：把若干块排成竖排、横排或网格（摆放式嵌套，NEW_FORMAT §4）。分组里还能放一层分组。 */
export const groupComponent: LookDefinitionOf<'group', typeof shape> = defineLook({
  look: 'group',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  describe: (c, _config, ctx) => {
    const layout = {
      stack: t(ctx.locale, 'describe_stacked_00ce0'),
      row: t(ctx.locale, 'describe_row_be7f8'),
      grid: t(ctx.locale, 'describe_grid_3f0e7'),
    }[c.show.layout];
    const name = c.show.title ? t(ctx.locale, 'describe__5caf2', { v0: c.show.title }) : '';
    return t(ctx.locale, 'describe_group_86cab', { v0: layout, v1: name });
  },
  edit: { text: [{ prop: 'title', max: 60, optional: true }], style: ['tone', 'align'] },
  ai: {
    doc: 'show {title?, layout: "stack"|"row"|"grid", columns?: 2|3} with children: [block] (max 12). A group may hold one more group (e.g. a card with two numbers side by side and a button below), but that inner group cannot hold another group. Use it to put things side by side (row) or in a grid.',
  },
  example: { show: { layout: 'row' }, children: [] },
});
