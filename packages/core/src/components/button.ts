import { z } from 'zod';

import { boundedText, IconValueSchema, NavTargetSchema } from '../schema-base';
import { defineComponent } from './define';

/** 按钮：点击后打开一个页面或系统入口。icon 显示在文字前面；variant 为 icon 时只显示圆形图标，文字留给读屏（D-230）。 */
export const buttonComponent = defineComponent({
  type: 'button',
  props: z.strictObject({
    label: boundedText(1, 40),
    target: NavTargetSchema,
    variant: z.enum(['filled', 'outline', 'text', 'icon']),
    icon: IconValueSchema.optional(),
  }),
  refs: { target: { to: 'target' } },
});
