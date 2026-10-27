import { z } from 'zod';

import { t } from '../messages';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({});

export const dividerComponent: ComponentDefinitionOf<'divider', typeof props> = defineComponent({
  type: 'divider',
  props,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_divider_7fe10'),
});
