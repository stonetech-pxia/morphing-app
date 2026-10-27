import { z } from 'zod';

import { t } from '../messages';
import { boundedText, IconValueSchema, NavTargetSchema } from '../schema-base';
import { ALL_STYLES, type ComponentDefinitionOf, defineComponent, EntryLookSchema } from './define';

const props = z.strictObject({
  title: boundedText(1, 40),
  subtitle: boundedText(1, 80).optional(),
  icon: IconValueSchema,
  target: NavTargetSchema,
  /** 不写时是 row（D-230）。 */
  look: EntryLookSchema.optional(),
});

/** 快捷入口卡片：图标 + 标题，点击后打开一个页面或系统入口。 */
export const shortcutComponent: ComponentDefinitionOf<'shortcut', typeof props> = defineComponent({
  type: 'shortcut',
  props,
  refs: { target: { to: 'target' } },
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_shortcut_b2616', { v0: c.props.title }),
  edit: {
    text: [
      { prop: 'title', max: 40 },
      { prop: 'subtitle', max: 80, optional: true },
    ],
    style: ALL_STYLES,
  },
});
