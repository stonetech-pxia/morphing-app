import { z } from 'zod';

import { IdSchema } from '../schema-base';
import { defineComponent } from './define';

export const workflowRunnerComponent = defineComponent({
  type: 'workflowRunner',
  props: z.strictObject({
    workflowId: IdSchema,
    /** card = 卡片加「运行」按钮，row = 一行、右边 ▶，tile = 宫格小块；不写时按位置自动选（D-230）。 */
    look: z.enum(['card', 'row', 'tile']).optional(),
  }),
  refs: { workflowId: { to: 'workflow' } },
});
