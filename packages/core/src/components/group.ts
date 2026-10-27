import { z } from 'zod';

import { boundedText } from '../schema-base';
import { defineComponent } from './define';
import { LeafComponentSchema } from './leaves';

/** 分组最多容纳的子组件数。 */
export const GROUP_MAX_CHILDREN = 12;

/** 分组：把若干组件排成竖排、横排或网格。分组不能再嵌套分组。 */
export const groupComponent = defineComponent({
  type: 'group',
  props: z.strictObject({
    title: boundedText(1, 60).optional(),
    layout: z.enum(['stack', 'row', 'grid']),
    columns: z.union([z.literal(2), z.literal(3)]).optional(),
  }),
  extra: { children: z.array(LeafComponentSchema).max(GROUP_MAX_CHILDREN) },
});
