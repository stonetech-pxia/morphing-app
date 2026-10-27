import { z } from 'zod';

import { IdSchema } from '../schema-base';
import { defineComponent, EntryLookSchema } from './define';

export const toolCardComponent = defineComponent({
  type: 'toolCard',
  props: z.strictObject({ toolId: IdSchema, look: EntryLookSchema.optional() }),
  refs: { toolId: { to: 'tool', in: 'installed' } },
});
