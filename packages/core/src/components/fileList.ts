import { z } from 'zod';

import { boundedText } from '../schema-base';
import { defineComponent } from './define';

export const fileListComponent = defineComponent({
  type: 'fileList',
  props: z.strictObject({
    title: boundedText(1, 60),
    limit: z.number().int().min(1).max(50),
    /** 只列出这一类文件：PDF，或者某一大类（image/*、video/*、audio/*，D-140）。 */
    mimeType: z.enum(['application/pdf', 'image/*', 'video/*', 'audio/*']).optional(),
  }),
});
