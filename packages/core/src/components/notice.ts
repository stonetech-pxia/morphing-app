import { z } from 'zod';

import { boundedText, IconValueSchema, richText } from '../schema-base';
import { defineComponent } from './define';

/** 提示框：带底色的说明。 */
export const noticeComponent = defineComponent({
  type: 'notice',
  props: z.strictObject({
    title: boundedText(1, 60).optional(),
    text: richText(600),
    icon: IconValueSchema.optional(),
  }),
});
