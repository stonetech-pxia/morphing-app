import { z } from 'zod';

import { richText } from '../schema-base';
import { defineComponent } from './define';

export const textComponent = defineComponent({
  type: 'text',
  /** 支持粗体、斜体、链接和列表（richtext.ts）。 */
  props: z.strictObject({ text: richText(1500) }),
});
