import { z } from 'zod';

import { localize } from '../localization';
import { t } from '../messages';
import {
  boundedText,
  IconValueSchema,
  isFileTarget,
  openTargetSchema,
  packageTargetId,
} from '../schema-base';
import { ALL_STYLES, EntryLookSchema, type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z
    .strictObject({
      /** 原 shortcut ≤40、catalogLink ≤60：取大的；工具包的入口不写（按工具包现取，跟着语言变）。 */
      title: boundedText(1, 60).optional(),
      subtitle: boundedText(1, 80).optional(),
      icon: IconValueSchema.optional(),
      /** 文件位还没选文件时显示的提示。 */
      hint: boundedText(1, 80).optional(),
      /** 不写时是 row（D-230）。 */
      shape: EntryLookSchema.optional(),
      /** 标题用主色（原 catalogLink「添加工具」的样子，M7）。 */
      accent: z.literal(true).optional(),
    })
    .optional(),
  opens: openTargetSchema(
    'opens must be a page, a system entry, tool:<id>, package:<id> or {file}',
  ),
};

type EntryKind = 'shortcut' | 'link' | 'package' | 'file';

/** 入口是哪一种（说明文字、编辑项按它分）：文件位、工具包的入口、「添加工具」那种主色入口、普通快捷入口。 */
export function entryKind(c: {
  show?: { accent?: true | undefined } | undefined;
  opens: unknown;
}): EntryKind {
  const opens = c.opens as Parameters<typeof isFileTarget>[0];
  if (isFileTarget(opens)) return 'file';
  if (packageTargetId(opens) !== null) return 'package';
  return c.show?.accent ? 'link' : 'shortcut';
}

/**
 * 入口卡片（v34 合并 shortcut、catalogLink、toolCard、fileSlot）：图标 + 标题，点了打开 opens。
 * opens 是 package:<id> 时标题、图标、说明按工具包现取；是 {file} 时是一个文件位：AI 只写标题和提示，
 * 用户点空位自己选文件（照片或「文件」里的文件，复制一份存成用户文件，原件不动），之后点一下用系统预览打开。
 */
export const entryComponent: LookDefinitionOf<'entry', typeof shape> = defineLook({
  look: 'entry',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  refs: { opens: { to: 'target' } },
  check: (c) => {
    const kind = entryKind(c);
    const problems: string[] = [];
    if (kind === 'package' && (c.show?.title || c.show?.icon || c.show?.subtitle))
      problems.push('an entry that opens package:<id> takes its title and icon from the tool');
    if (kind !== 'package' && !c.show?.title) problems.push('an entry needs show.title');
    if (kind === 'shortcut' && !c.show?.icon) problems.push('an entry needs show.icon');
    if (kind !== 'file' && c.show?.hint) problems.push('show.hint only applies to a file slot');
    if (kind !== 'link' && (c.show?.title?.length ?? 0) > 40)
      problems.push('show.title can be at most 40 characters');
    return problems;
  },
  describe: (c, _config, ctx) => {
    const title = c.show?.title ?? '';
    switch (entryKind(c)) {
      case 'file':
        return t(ctx.locale, 'describeFileSlot', { v0: title });
      case 'link':
        return t(ctx.locale, 'describe_link_941e3', { v0: title });
      case 'package': {
        const id = packageTargetId(c.opens)!;
        const name = localize(ctx.registry.tools.get(id)?.name, ctx.locale) ?? id;
        return t(ctx.locale, 'describe_tool_card_80198', { v0: name });
      }
      default:
        return t(ctx.locale, 'describe_shortcut_b2616', { v0: title });
    }
  },
  edit: {
    text: [
      { prop: 'title', max: 60 },
      { prop: 'subtitle', max: 80, optional: true },
      { prop: 'hint', max: 80, optional: true },
    ],
    style: ALL_STYLES,
    asset: 'file',
    backdrop: true,
  },
  ai: {
    doc: 'show? {title, subtitle?, icon, shape?: "row"|"tile", hint?}, opens: a card with an icon that opens a page, a system entry, "tool:<id>" (like button) or "package:<id>" (an added tool\'s page; then leave show.title and icon out, they come from the tool). row (default) = a settings-style row with a light icon background and an arrow on the right; tile = a big card with a solid icon block, no arrow. In a grid or row group, or centered, it is always stacked. A slot for one file the user wants at hand (a contract, a ticket, a manual, a scan) is an entry with opens {file: null}: you set only the title, hint and shape; never choose a file — the user taps the empty slot to pick a photo or a file, Morph keeps a copy, and later a tap opens it in the system viewer. You never see which file it is.',
  },
  example: { show: { title: 'Tools', icon: 'apps' }, opens: 'tools' },
});

/** 长按编辑里这个入口能改的文字（工具包的入口没有，文件位多一个提示）。 */
export function entryEditableText(c: {
  show?: { accent?: true | undefined } | undefined;
  opens: unknown;
}) {
  const kind = entryKind(c);
  if (kind === 'package') return [];
  const max = kind === 'link' ? 60 : 40;
  return [
    { prop: 'title', max },
    ...(kind === 'file'
      ? [{ prop: 'hint', max: 80, optional: true }]
      : kind === 'shortcut'
        ? [{ prop: 'subtitle', max: 80, optional: true }]
        : []),
  ];
}
