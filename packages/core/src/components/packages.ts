import { z } from 'zod';

import { t } from '../messages';
import { boundedText, IdSchema } from '../schema-base';
import { duplicates, type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z.strictObject({ title: boundedText(1, 60).optional() }).optional(),
  /** 读工具包目录；点没添加的先添加（内核工具），再打开。不写 ids = 同一页其他宫格没列出的。 */
  source: z.strictObject({
    catalog: z.literal('packages'),
    ids: z.array(IdSchema).min(1).max(30).optional(),
  }),
};

/** 工具宫格（原 toolGrid，D-181）。 */
export const packagesComponent: LookDefinitionOf<'packages', typeof shape> = defineLook({
  look: 'packages',
  shape,
  kind: 'container',
  layer: 'config',
  reads: 'catalog',
  writes: false,
  refs: { 'source.ids': { to: 'package', in: 'catalog' } },
  check: (c) =>
    duplicates(c.source.ids ?? []).map((toolId) => ({
      code: 'duplicate',
      message: `tool ${toolId} in component ${c.id}`,
    })),
  describe: (c, _config, ctx) =>
    c.show?.title
      ? t(ctx.locale, 'describe_tool_grid_e987a', { v0: c.show.title })
      : t(ctx.locale, 'describe_tool_grid_1c74f'),
  edit: { text: [{ prop: 'title', max: 60, optional: true }], style: ['align'] },
  ai: {
    doc: 'show? {title?}, source {catalog: "packages", ids?}: tool icons, three per row, under an optional small title; tapping one opens the tool (a tool that isn\'t added yet is added first, shown faded with a "+"). ids lists catalog tool ids in order; without ids the grid shows every catalog tool that no other packages block on the same page lists (a catch-all "more tools" grid that disappears when it is empty). To move a tool from one grid to another, change both blocks\' source.ids with updateContainer.',
  },
  example: { show: { title: 'Documents' }, source: { catalog: 'packages', ids: ['pdf', 'image'] } },
});
