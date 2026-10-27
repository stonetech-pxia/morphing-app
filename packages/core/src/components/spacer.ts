import { z } from 'zod';

import { t } from '../messages';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({ size: z.enum(['small', 'medium', 'large']) });

export const spacerComponent: ComponentDefinitionOf<'spacer', typeof props> = defineComponent({
  type: 'spacer',
  props,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_spacer_9a646'),
});
