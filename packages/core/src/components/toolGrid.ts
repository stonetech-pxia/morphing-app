import { z } from 'zod';

import { t } from '../messages';
import { boundedText, IdSchema } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent, duplicates } from './define';

const props = z.strictObject({
  title: boundedText(1, 60).optional(),
  toolIds: z.array(IdSchema).min(1).max(30).optional(),
});

/**
 * 工具宫格（D-181）：一组工具的小图标，每行三个；点一下打开工具，还没添加的先添加再打开。
 * toolIds 按顺序列出工具；不写 toolIds 时显示目录里同一页面上其他工具宫格没列出的全部工具（「更多工具」，没有就不显示）。
 */
export const toolGridComponent: ComponentDefinitionOf<'toolGrid', typeof props> = defineComponent({
  type: 'toolGrid',
  props,
  refs: { toolIds: { to: 'tool', in: 'catalog' } },
  check: (c) =>
    duplicates(c.props.toolIds ?? []).map((toolId) => ({
      code: 'duplicate',
      message: `tool ${toolId} in component ${c.id}`,
    })),
  describe: (c, _config, ctx) =>
    c.props.title
      ? t(ctx.locale, 'describe_tool_grid_e987a', { v0: c.props.title })
      : t(ctx.locale, 'describe_tool_grid_1c74f'),
});
