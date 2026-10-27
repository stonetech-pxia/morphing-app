import { z } from 'zod';

import { boundedText, IconValueSchema, NavTargetSchema } from '../schema-base';
import { defineComponent, EntryLookSchema } from './define';

/** 快捷入口卡片：图标 + 标题，点击后打开一个页面或系统入口。 */
export const shortcutComponent = defineComponent({
  type: 'shortcut',
  props: z.strictObject({
    title: boundedText(1, 40),
    subtitle: boundedText(1, 80).optional(),
    icon: IconValueSchema,
    target: NavTargetSchema,
    /** 不写时是 row（D-230）。 */
    look: EntryLookSchema.optional(),
  }),
  refs: { target: { to: 'target' } },
});
