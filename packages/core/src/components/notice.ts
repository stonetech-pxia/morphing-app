import { z } from 'zod';

import { t } from '../messages';
import { boundedText, IconValueSchema, richText } from '../schema-base';
import { ALL_STYLES, type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z.strictObject({
    title: boundedText(1, 60).optional(),
    text: richText(600),
    icon: IconValueSchema.optional(),
  }),
};

/** 提示框：带底色的说明。 */
export const noticeComponent: LookDefinitionOf<'notice', typeof shape> = defineLook({
  look: 'notice',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_notice_f50d5'),
  edit: {
    text: [
      { prop: 'title', max: 60, optional: true },
      { prop: 'text', max: 600, multiline: true, rich: true },
    ],
    style: ALL_STYLES,
    backdrop: true,
  },
  ai: {
    doc: 'show {title?, text, icon?}: a tinted callout; text is rich text, up to 600 characters',
  },
  example: { show: { title: 'Tip', text: 'Long-press to edit.', icon: 'lightbulb' } },
});
