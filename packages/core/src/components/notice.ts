import { z } from 'zod';

import { t } from '../messages';
import { boundedText, IconValueSchema, richText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  title: boundedText(1, 60).optional(),
  text: richText(600),
  icon: IconValueSchema.optional(),
});

/** 提示框：带底色的说明。 */
export const noticeComponent: ComponentDefinitionOf<'notice', typeof props> = defineComponent({
  type: 'notice',
  props,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_notice_f50d5'),
});
