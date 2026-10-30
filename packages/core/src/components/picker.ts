import { t } from '../messages';
import { z } from 'zod';

import { ToolUseSchema } from '../record-ops-schema';
import { type LookDefinitionOf, defineLook } from './define';

const shape = { tools: z.array(ToolUseSchema).min(1).max(1) };

/** 打开相册 / 打开文件（原 filePick）：内核固定行为，选完进收件页面，绝不自动运行（AI 不提供可执行内容）。 */
export const pickerComponent: LookDefinitionOf<'picker', typeof shape> = defineLook({
  look: 'picker',
  shape,
  kind: 'container',
  layer: 'file',
  reads: 'none',
  writes: false,
  tools: { as: ['self'], ref: ['pick'], max: 1 },
  describe: (c, _config, ctx) =>
    'tool' in c.tools[0]! && c.tools[0].tool === '$pick.files'
      ? t(ctx.locale, 'describe_Open_files_3477c')
      : t(ctx.locale, 'describe_Open_photo_library_47a7e'),
  edit: { text: [], style: [] },
  ai: {
    doc: 'tools: [{tool: "$pick.media"}] or [{tool: "$pick.files"}]: kernel file picker entry, labeled "打开相册" / "Open photo library" for media (photos AND videos), "打开文件" / "Open files" for files. Selection opens the kernel inbox; never runs a quick action automatically. You may add, move, hide or remove it, but cannot customize its behavior. For "首页加上打开相册" / "Add a photo picker to home", add a picker block with "$pick.media" to home; do not create a quick action.',
    docAfter: 'button',
  },
  example: { tools: [{ tool: '$pick.media' }] },
});
