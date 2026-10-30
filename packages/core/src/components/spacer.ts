import { z } from 'zod';

import { t } from '../messages';
import { type LookDefinitionOf, defineLook } from './define';

const shape = { show: z.strictObject({ size: z.enum(['small', 'medium', 'large']) }) };

export const spacerComponent: LookDefinitionOf<'spacer', typeof shape> = defineLook({
  look: 'spacer',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_spacer_9a646'),
  edit: { text: [], style: [] },
  ai: { doc: 'show {size: "small"|"medium"|"large"}' },
  example: { show: { size: 'medium' } },
});
