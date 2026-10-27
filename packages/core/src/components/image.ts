import { z } from 'zod';

import { t } from '../messages';
import { AssetIdSchema, boundedText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  assetId: AssetIdSchema.nullable().optional(),
  aspect: z.enum(['wide', 'landscape', 'square', 'portrait']),
  fit: z.enum(['cover', 'contain']),
  caption: boundedText(1, 120).optional(),
  /** 还没选照片时显示的提示。 */
  placeholder: boundedText(1, 60).optional(),
});

/**
 * 图片：AI 只能放一个图片位并设置版式；用哪张照片由用户在页面上选择（D-045）。
 * assetId 指向用户文件，AI 看不到图片内容和文件名。
 */
export const imageComponent: ComponentDefinitionOf<'image', typeof props> = defineComponent({
  type: 'image',
  props,
  describe: (c, _config, ctx) =>
    c.props.caption
      ? t(ctx.locale, 'describe_image_d5072', { v0: c.props.caption })
      : t(ctx.locale, 'describe_image_df755'),
});
