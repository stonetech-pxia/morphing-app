import { z } from 'zod';

import { t } from '../messages';
import { ToolUseSchema } from '../record-ops-schema';
import { boundedText, IconValueSchema, openTargetSchema } from '../schema-base';
import { type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z.strictObject({
    label: boundedText(1, 40),
    variant: z.enum(['filled', 'outline', 'text', 'icon']),
    icon: IconValueSchema.optional(),
  }),
  /** 一个就地的一键记录工具（D-300，原 action）：和 opens 二选一，点了在本机改记录，可以撤销。 */
  tools: z.array(ToolUseSchema).min(1).max(1).optional(),
  opens: openTargetSchema('opens must be a page, a system entry or tool:<id>', ['tool']).optional(),
};

/**
 * 按钮：点击后打开一个页面、系统入口或快捷操作（opens），或者执行一个一键记录工具（tools，D-300）。
 * icon 显示在文字前面；variant 为 icon 时只显示圆形图标，文字留给读屏（D-230）。
 */
export const buttonComponent: LookDefinitionOf<'button', typeof shape> = defineLook({
  look: 'button',
  shape,
  kind: 'container',
  layer: 'record',
  reads: 'none',
  writes: true,
  tools: { as: ['self'], do: ['create', 'setAll'], max: 1 },
  refs: { opens: { to: 'target' } },
  check: (c, ctx) => {
    const problems = [];
    if (c.show.variant === 'icon' && !c.show.icon)
      problems.push({
        code: 'schema',
        message: `icon button ${c.id} on page ${ctx.page.id} needs an icon`,
      });
    if (c.tools && c.opens !== undefined)
      problems.push(`a button either opens something or has a tool, not both`);
    return problems;
  },
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_button_d79ee', { v0: c.show.label }),
  edit: { text: [{ prop: 'label', max: 40 }], style: ['align'] },
  ai: {
    doc: 'show {label, variant: "filled"|"outline"|"text"|"icon", icon?}, opens? (a page, a system entry or "tool:<id>") or tools? [one record tool]: icon shows before the label; variant "icon" shows only a round icon (needs icon; the label is still read by screen readers). opens "tool:<id>" (a quick action in tools[] or a built-in preset id) shows that quick action and the user taps Start; it never runs by itself. Instead of opens, tools: [{do: "create", table, values?, ask?: "all"}] or [{do: "setAll", table, filter?, field, value}] changes entries when tapped (rule 44).',
  },
  example: { show: { label: 'Settings', variant: 'filled' }, opens: 'settings' },
});
