import { z } from 'zod';

import { t } from '../messages';
import { ButtonActionSchema } from '../record-ops-schema';
import { boundedText, IconValueSchema, openTargetSchema } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  label: boundedText(1, 40),
  target: openTargetSchema('target must be a page, a system entry or workflow:<id>').optional(),
  /** 一键记录操作（D-297）：和 target 二选一，点了在本机改记录，可以撤销。 */
  action: ButtonActionSchema.optional(),
  variant: z.enum(['filled', 'outline', 'text', 'icon']),
  icon: IconValueSchema.optional(),
});

/** 按钮：点击后打开一个页面或系统入口，或者执行一个记录操作（action，D-297）。icon 显示在文字前面；variant 为 icon 时只显示圆形图标，文字留给读屏（D-230）。 */
export const buttonComponent: ComponentDefinitionOf<'button', typeof props> = defineComponent({
  type: 'button',
  props,
  refs: { target: { to: 'target' } },
  check: (c, ctx) =>
    c.props.variant === 'icon' && !c.props.icon
      ? [{ code: 'schema', message: `icon button ${c.id} on page ${ctx.page.id} needs an icon` }]
      : [],
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_button_d79ee', { v0: c.props.label }),
  edit: { text: [{ prop: 'label', max: 40 }], style: ['align'] },
  ai: {
    doc: '{label, target, variant: "filled"|"outline"|"text"|"icon", icon?}: opens target. icon shows before the label; variant "icon" shows only a round icon (needs icon; the label is still read by screen readers). target may also be "workflow:<id>" (a quick action in workflows[] or a built-in preset id) for "a button that opens my receipt quick action": tapping shows that quick action and the user taps Start; it never runs by itself. Or, instead of target, action (rule 49) changes entries when tapped.',
  },
  example: { props: { label: 'Settings', target: 'settings', variant: 'filled' } },
});
