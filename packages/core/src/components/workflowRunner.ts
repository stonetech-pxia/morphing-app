import { z } from 'zod';

import { t } from '../messages';
import { IdSchema } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  workflowId: IdSchema,
  /** card = 卡片加「运行」按钮，row = 一行、右边 ▶，tile = 宫格小块；不写时按位置自动选（D-230）。 */
  look: z.enum(['card', 'row', 'tile']).optional(),
});

export const workflowRunnerComponent: ComponentDefinitionOf<'workflowRunner', typeof props> =
  defineComponent({
    type: 'workflowRunner',
    props,
    refs: { workflowId: { to: 'workflow' } },
    describe: (c, config, ctx) => {
      const wf = config.workflows.find((w) => w.id === c.props.workflowId);
      return t(ctx.locale, 'describe_quick_action_1fb38', { v0: wf?.name ?? c.props.workflowId });
    },
    edit: { text: [], style: [], backdrop: true },
    ai: {
      doc: '{workflowId, look?: "card"|"row"|"tile"}: runs a workflow. card = steps and a Run button, row = one line with a play icon on the right, tile = a small square (side by side two per row). Without look: tile when it sits next to other workflowRunners or in a grid/row group, card otherwise.',
    },
    example: { props: { workflowId: 'pdf-merge' } },
  });
