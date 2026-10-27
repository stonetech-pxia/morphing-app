import { z } from 'zod';

import { boundedText } from '../schema-base';
import { defineComponent } from './define';

export const headerComponent = defineComponent({
  type: 'header',
  props: z.strictObject({ title: boundedText(1, 60), subtitle: boundedText(1, 120).optional() }),
});
