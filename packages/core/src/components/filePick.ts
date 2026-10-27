import { z } from 'zod';

import { defineComponent } from './define';

/** 内核固定行为：只能选择来源，AI 不提供可执行内容。 */
export const filePickComponent = defineComponent({
  type: 'filePick',
  props: z.strictObject({ source: z.enum(['media', 'files']) }),
});
