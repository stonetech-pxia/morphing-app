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
  edit: { text: [{ prop: 'title', max: 60, optional: true }], style: ['align'] },
  ai: {
    doc: '{title?, toolIds?}: tool icons, three per row, under an optional small title; tapping one opens the tool (a tool that isn\'t added yet is added first, shown faded with a "+"). toolIds lists catalog tool ids in order; without toolIds the grid shows every catalog tool that no other toolGrid on the same page lists (a catch-all "more tools" grid that disappears when it is empty). To move a tool from one grid to another, change both grids\' toolIds with setComponentProps.',
  },
  example: { props: { title: 'Documents', toolIds: ['pdf', 'image'] } },
});
