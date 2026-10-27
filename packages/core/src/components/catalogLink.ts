import { z } from 'zod';

import { boundedText } from '../schema-base';
import { defineComponent, EntryLookSchema } from './define';

export const catalogLinkComponent = defineComponent({
  type: 'catalogLink',
  props: z.strictObject({ title: boundedText(1, 60), look: EntryLookSchema.optional() }),
});
