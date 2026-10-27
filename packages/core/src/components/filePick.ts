import { z } from 'zod';

import { t } from '../messages';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({ source: z.enum(['media', 'files']) });

/** 内核固定行为：只能选择来源，AI 不提供可执行内容。 */
export const filePickComponent: ComponentDefinitionOf<'filePick', typeof props> = defineComponent({
  type: 'filePick',
  props,
  describe: (c, _config, ctx) =>
    c.props.source === 'media'
      ? t(ctx.locale, 'describe_Open_photo_library_47a7e')
      : t(ctx.locale, 'describe_Open_files_3477c'),
  edit: { text: [], style: [] },
  ai: {
    doc: '{source: "media" | "files"}: kernel file picker entry, labeled "打开相册" / "Open photo library" for media (photos AND videos), "打开文件" / "Open files" for files. Selection opens the kernel inbox; never runs a workflow automatically. You may add, move, hide or remove it, but cannot customize its behavior. For "首页加上打开相册" / "Add a photo picker to home", add filePick {source: "media"} to home; do not create a workflow.',
    docAfter: 'button',
  },
});
