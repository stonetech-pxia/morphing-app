import { z } from 'zod';

import { localize } from '../localization';
import { t } from '../messages';
import { QUICK_ACTION_CATEGORIES, QUICK_ACTION_KINDS } from '../quick-actions';
import { boundedText } from '../schema-base';
import { type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z.strictObject({ title: boundedText(1, 60).optional() }).optional(),
  /** 读快捷操作目录（我的 + 内设 + 工具包带的）；运行、编辑、「＋ 添加」是内核工具，不进配置。 */
  source: z.strictObject({
    catalog: z.literal('quickActions'),
    kind: z.enum(QUICK_ACTION_KINDS).optional(),
  }),
};

/** 快捷操作库放进页面（原 quickActionList）。 */
export const libraryComponent: LookDefinitionOf<'library', typeof shape> = defineLook({
  look: 'library',
  shape,
  kind: 'container',
  layer: 'config',
  reads: 'catalog',
  writes: false,
  describe: (c, _config, ctx) =>
    c.source.kind
      ? t(ctx.locale, 'describe_quick_action_list_kind', {
          v0: localize(QUICK_ACTION_CATEGORIES[c.source.kind].name, ctx.locale) ?? c.source.kind,
        })
      : t(ctx.locale, 'describe_quick_action_list'),
  edit: { text: [{ prop: 'title', max: 60, optional: true }], style: [] },
  ai: {
    doc: 'show? {title?}, source {catalog: "quickActions", kind?: "image"|"video"|"audio"|"document"|"other"}: the kernel\'s quick-action library placed on a page. Without kind: the category entries (Photos, Videos, Audio, Documents, Other); with kind: that category\'s own quick actions (run, edit), the ready-made ones (add) and those from tools. You choose where it goes and its title, not its content. For "put the photo quick actions on home" add a library block with kind "image"; for "show what Morph can do on the home page" add it without kind.',
  },
  example: { source: { catalog: 'quickActions', kind: 'image' } },
});
