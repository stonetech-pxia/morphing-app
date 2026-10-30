import { z } from 'zod';

import { t } from '../messages';
import { ToolUseSchema } from '../record-ops-schema';
import { quickActionsOf } from '../schema';
import { findWorkflowTarget } from '../workflows/presets';
import { type LookDefinitionOf, defineLook } from './define';

const shape = {
  /** card = 卡片加「运行」按钮，row = 一行、右边 ▶，tile = 宫格小块；不写时按位置自动选（D-230）。 */
  show: z.strictObject({ shape: z.enum(['card', 'row', 'tile']).optional() }).optional(),
  /** 一个快捷操作：tools[] 里的，或者内设快捷操作的预设 ID（D-236、D-259，不用添加）。 */
  tools: z.array(ToolUseSchema).min(1).max(1),
};

/** 显示一个快捷操作的块（原 workflowRunner）：点了运行（用户触发）。 */
export const actionComponent: LookDefinitionOf<'action', typeof shape> = defineLook({
  look: 'action',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  tools: { as: ['self'], ref: ['quickAction'], max: 1 },
  describe: (c, config, ctx) => {
    const use = c.tools[0]!;
    const id = 'tool' in use ? use.tool : '';
    const wf = findWorkflowTarget(quickActionsOf(config), id, ctx.locale);
    return t(ctx.locale, 'describe_quick_action_1fb38', { v0: wf?.name ?? id });
  },
  edit: { text: [], style: [], backdrop: true },
  ai: {
    doc: 'show? {shape?: "card"|"row"|"tile"}, tools: [{tool: <quick action id>}]: runs a quick action; the id may also be a preset id (the built-in quick action, nothing to add; once the user changes it, their copy runs). card = steps and a Run button, row = one line with a play icon on the right, tile = a small square (side by side two per row). Without shape: tile when it sits next to other action blocks or in a grid/row group, card otherwise.',
  },
  example: { tools: [{ tool: 'pdf-merge' }] },
});
