import { z } from 'zod';

import { boundedText, IdSchema } from '../schema-base';
import { defineComponent } from './define';

/** 快速添加表单：inline 直接在页面上填，button 打开完整的记录编辑页。 */
export const recordFormComponent = defineComponent({
  type: 'recordForm',
  props: z.strictObject({
    collectionId: IdSchema,
    fieldIds: z.array(IdSchema).min(1).max(10),
    submitLabel: boundedText(1, 30),
    mode: z.enum(['inline', 'button']),
  }),
  refs: { collectionId: { to: 'collection' } },
});
