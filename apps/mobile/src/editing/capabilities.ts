import type { ComponentType } from '@morph/core';

// 直接编辑（D-052）：每种组件在长按菜单里能改什么。
// 只列渲染器真正会显示出来的外观；数据组件不能改文字（只调整位置、颜色、隐藏和删除）。

export interface TextField {
  prop: string;
  /** 与 core schema 的长度上限一致；超出时校验器也会拦截。 */
  max: number;
  optional?: boolean;
  multiline?: boolean;
  /** 支持粗体、斜体、链接和列表（richtext.ts）。 */
  rich?: boolean;
}

export type StyleKey = 'tone' | 'align' | 'size';

interface Capability {
  text: TextField[];
  style: StyleKey[];
}

const ALL_STYLES: StyleKey[] = ['tone', 'align', 'size'];

export const CAPABILITIES: Record<ComponentType, Capability> = {
  header: {
    text: [
      { prop: 'title', max: 60 },
      { prop: 'subtitle', max: 120, optional: true },
    ],
    style: ALL_STYLES,
  },
  text: {
    text: [{ prop: 'text', max: 1500, multiline: true, rich: true }],
    style: ALL_STYLES,
  },
  filePick: { text: [], style: [] },
  toolCard: { text: [], style: ALL_STYLES },
  toolGrid: { text: [{ prop: 'title', max: 60, optional: true }], style: ['align'] },
  catalogLink: { text: [{ prop: 'title', max: 60 }], style: ALL_STYLES },
  shortcut: {
    text: [
      { prop: 'title', max: 40 },
      { prop: 'subtitle', max: 80, optional: true },
    ],
    style: ALL_STYLES,
  },
  button: { text: [{ prop: 'label', max: 40 }], style: ['align'] },
  notice: {
    text: [
      { prop: 'title', max: 60, optional: true },
      { prop: 'text', max: 600, multiline: true, rich: true },
    ],
    style: ALL_STYLES,
  },
  image: {
    text: [
      { prop: 'caption', max: 120, optional: true },
      { prop: 'placeholder', max: 60, optional: true },
    ],
    style: ['align'],
  },
  fileList: { text: [{ prop: 'title', max: 60 }], style: [] },
  workflowRunner: { text: [], style: [] },
  divider: { text: [], style: [] },
  spacer: { text: [], style: [] },
  group: { text: [{ prop: 'title', max: 60, optional: true }], style: ['tone', 'align'] },
  recordList: { text: [], style: ['tone'] },
  recordForm: { text: [], style: ['tone'] },
  stat: { text: [], style: ['tone'] },
};
