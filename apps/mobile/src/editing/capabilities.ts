import {
  COMPONENTS,
  entryEditableText,
  entryKind,
  type ComponentEdit,
  type KnownComponent,
  type ComponentType,
  type EditableText,
  type StyleKey,
} from '@morph/core';

// 直接编辑（D-052）：每种组件在长按菜单里能改什么。写在 core 的组件定义里（components/<type>.ts 的 edit）。

export type TextField = EditableText;
export type { StyleKey };

export const CAPABILITIES = Object.fromEntries(COMPONENTS.map((d) => [d.look, d.edit])) as Record<
  ComponentType,
  ComponentEdit
>;

/**
 * 这个块能改什么。入口（v34 合并了快捷入口、「添加工具」、工具卡片、文件位）按 opens 分：
 * 工具包的入口没有文字，只有文件位能选文件（entryEditableText、entryKind）。
 */
export function capabilitiesOf(c: KnownComponent): ComponentEdit {
  const edit = CAPABILITIES[c.look];
  if (c.look !== 'entry') return edit;
  const { asset: _asset, ...rest } = edit;
  return {
    ...rest,
    text: entryEditableText(c) as EditableText[],
    ...(entryKind(c) === 'file' ? { asset: 'file' as const } : {}),
  };
}
