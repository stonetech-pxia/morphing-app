import {
  COMPONENTS,
  type ComponentEdit,
  type ComponentType,
  type EditableText,
  type StyleKey,
} from '@morph/core';

// 直接编辑（D-052）：每种组件在长按菜单里能改什么。写在 core 的组件定义里（components/<type>.ts 的 edit）。

export type TextField = EditableText;
export type { StyleKey };

export const CAPABILITIES = Object.fromEntries(COMPONENTS.map((d) => [d.type, d.edit])) as Record<
  ComponentType,
  ComponentEdit
>;
