import { z } from 'zod';

import { t } from '../messages';
import { richText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

/** 支持粗体、斜体、链接和列表（richtext.ts）。 */
const props = z.strictObject({ text: richText(1500) });

export const textComponent: ComponentDefinitionOf<'text', typeof props> = defineComponent({
  type: 'text',
  props,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_description_text_fccd4'),
});
