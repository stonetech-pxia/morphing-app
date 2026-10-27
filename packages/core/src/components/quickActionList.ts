import { z } from 'zod';

import { boundedText } from '../schema-base';
import { defineComponent } from './define';

/**
 * 快捷操作列表（D-230）：不写 kind 时是「Morph 可以做什么」的分类入口；写了 kind 时列出这一类
 * 我的快捷操作（▶ 运行、✎ 编辑）和现成的（＋ 添加）。内容由内核决定，AI 只决定放在哪里。
 * kind 与 quick-actions.ts 的 QUICK_ACTION_KINDS 一致。
 */
export const quickActionListComponent = defineComponent({
  type: 'quickActionList',
  props: z.strictObject({
    title: boundedText(1, 60).optional(),
    kind: z.enum(['image', 'video', 'audio', 'document', 'other']).optional(),
  }),
});
