import type { Workflow } from '@morph/core';

import MorphDocs from '../../modules/morph-docs';

/**
 * 这台手机做不了的动作：入口（PDF 桌面工具栏、快捷操作列表、收件页推荐）不显示。
 * PDF 密码只有 iOS 的 MorphDocs 做了（P-025），Android、Expo Go 和测试里没有。
 */
export const UNSUPPORTED_ACTIONS: ReadonlySet<string> = new Set(
  MorphDocs ? [] : ['pdf.protect', 'pdf.unlock'],
);

/** 快捷操作的每一步这台手机都做得了。 */
export const runsHere = (wf: Workflow) => !wf.steps.some((s) => UNSUPPORTED_ACTIONS.has(s.action));
