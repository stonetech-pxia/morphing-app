import { z } from 'zod';

import { t } from '../messages';
import { boundedText } from '../schema-base';
import { ALL_STYLES, type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z.strictObject({
    title: boundedText(1, 60),
    subtitle: boundedText(1, 120).optional(),
  }),
};

export const headerComponent: LookDefinitionOf<'header', typeof shape> = defineLook({
  look: 'header',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_header_455aa', { v0: c.show.title }),
  edit: {
    text: [
      { prop: 'title', max: 60 },
      { prop: 'subtitle', max: 120, optional: true },
    ],
    style: ALL_STYLES,
  },
  ai: { doc: 'show {title, subtitle?}' },
  example: { show: { title: 'Budget', subtitle: 'This month' } },
});
