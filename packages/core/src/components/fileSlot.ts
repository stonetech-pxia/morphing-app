import { z } from 'zod';

import { t } from '../messages';
import { AssetIdSchema, boundedText, IconValueSchema } from '../schema-base';
import { ALL_STYLES, type ComponentDefinitionOf, defineComponent, EntryLookSchema } from './define';

const props = z.strictObject({
  /** 用户选的文件复制进 App 后的用户文件 ID；AI 不写。 */
  assetId: AssetIdSchema.nullable().optional(),
  title: boundedText(1, 40),
  /** 还没选文件时显示的提示。 */
  hint: boundedText(1, 80).optional(),
  icon: IconValueSchema.optional(),
  /** 不写时是 row（D-230）。 */
  look: EntryLookSchema.optional(),
});

/**
 * 文件入口（D-257）：AI 只能放一个空位并设标题、提示和外观；用哪个文件由用户点空位自己选
 * （照片或「文件」里的文件），选的文件复制一份存成用户文件，原件不动。之后点一下用系统预览打开。
 * assetId 和图片组件一样只指向用户文件，文件名不进配置，AI 看不到文件名和内容。
 */
export const fileSlotComponent: ComponentDefinitionOf<'fileSlot', typeof props> = defineComponent({
  type: 'fileSlot',
  props,
  describe: (c, _config, ctx) => t(ctx.locale, 'describeFileSlot', { v0: c.props.title }),
  edit: {
    text: [
      { prop: 'title', max: 40 },
      { prop: 'hint', max: 80, optional: true },
    ],
    style: ALL_STYLES,
    asset: 'file',
  },
  ai: {
    doc: '{title, hint?, icon?, look?: "row"|"tile", assetId?}: a slot for one file the user wants at hand (a contract, a ticket, a manual, a scan). You set only the title, hint and look; never choose a file or write assetId — the user taps the empty slot to pick a photo or a file, Morph keeps a copy, and later a tap opens it in the system viewer. You never see which file it is. When the user asks for a place, entry or button for one particular document of theirs ("放一个租房合同的入口", "a spot for my boarding pass"), add an empty fileSlot titled after it; do not use fileList, filePick or a notice instead.',
  },
  example: { props: { title: 'Lease contract', hint: 'Tap to choose the file', icon: 'document' } },
});
