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
  edit: {
    text: [
      { prop: 'caption', max: 120, optional: true },
      { prop: 'placeholder', max: 60, optional: true },
    ],
    style: ['align'],
  },
  ai: {
    doc: '{assetId?, aspect: "wide"|"landscape"|"square"|"portrait", fit: "cover"|"contain", caption?, placeholder?}: a picture the user chooses. You can add an image slot and set its layout, caption and placeholder hint, but never choose or invent a picture: leave assetId out (the user taps the slot to pick a photo). You never see the pictures. Whenever the user asks for a photo, picture, image, banner image, cover, 图片, 照片, 头图, 封面, 横幅图片 or 配图, add an image component as an empty slot (the user fills it by tapping it) — do this even though you can\'t choose the picture yourself, and never substitute a notice or text for it.',
  },
});
