import { z } from 'zod';

import { defineComponent } from './define';

export const dividerComponent = defineComponent({
  type: 'divider',
  props: z.strictObject({}),
});
