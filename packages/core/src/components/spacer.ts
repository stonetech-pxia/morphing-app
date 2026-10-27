import { z } from 'zod';

import { defineComponent } from './define';

export const spacerComponent = defineComponent({
  type: 'spacer',
  props: z.strictObject({ size: z.enum(['small', 'medium', 'large']) }),
});
