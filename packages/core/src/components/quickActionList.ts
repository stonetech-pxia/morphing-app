import { z } from 'zod';

import { localize } from '../localization';
import { t } from '../messages';
import { QUICK_ACTION_CATEGORIES } from '../quick-actions';
import { boundedText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  title: boundedText(1, 60).optional(),
  kind: z.enum(['image', 'video', 'audio', 'document', 'other']).optional(),
});

/**
 * 快捷操作列表（D-230）：不写 kind 时是「Morph 可以做什么」的分类入口；写了 kind 时列出这一类
 * 我的快捷操作（▶ 运行、✎ 编辑）和现成的（＋ 添加）。内容由内核决定，AI 只决定放在哪里。
 * kind 与 quick-actions.ts 的 QUICK_ACTION_KINDS 一致。
 */
export const quickActionListComponent: ComponentDefinitionOf<'quickActionList', typeof props> =
  defineComponent({
    type: 'quickActionList',
    props,
    describe: (c, _config, ctx) =>
      c.props.kind
        ? t(ctx.locale, 'describe_quick_action_list_kind', {
            v0: localize(QUICK_ACTION_CATEGORIES[c.props.kind].name, ctx.locale) ?? c.props.kind,
          })
        : t(ctx.locale, 'describe_quick_action_list'),
  });
