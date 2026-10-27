import { z } from 'zod';

import { t } from '../messages';
import { boundedText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  title: boundedText(1, 60),
  subtitle: boundedText(1, 120).optional(),
});

export const headerComponent: ComponentDefinitionOf<'header', typeof props> = defineComponent({
  type: 'header',
  props,
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_header_455aa', { v0: c.props.title }),
});
