import { z } from 'zod';

import { t } from '../messages';
import { type LookDefinitionOf, defineLook } from './define';

const shape = { show: z.strictObject({}).optional() };

export const dividerComponent: LookDefinitionOf<'divider', typeof shape> = defineLook({
  look: 'divider',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_divider_7fe10'),
  edit: { text: [], style: [] },
  ai: { doc: 'no show' },
  example: {},
});
