import { guideGoal } from '@morph/core';
import { useRouter } from 'expo-router';

import { isGoalParam, useGuide } from '../guide/store';
import { useWorkspace } from '../workspace/context';
import type { Applied } from '../workspace/store';

/**
 * 应用之后带用户去该去的地方（草稿应用后，或者功能类修改直接应用后，D-191）：
 * 新做了一个快捷操作 →「做好了」页面（D-125，引导做的可以先用示例试一下）；
 * 从收件页面开始的 → 回到收件页面，用分享的文件运行新的快捷操作（D-129）；
 * 从一个快捷操作开始的（「让 AI 改这个」）→ 它的「做好了」页面，现在就能再用一次（D-126）；
 * 新建了一张数据表 → 数据表的「做好了」页面，现在就能记一笔。
 */
export function useAfterApply(): (applied: Applied) => void {
  const router = useRouter();
  const setGuideStage = useGuide((s) => s.setStage);
  return ({ origin, addedWorkflowIds, addedCollectionIds, notes }) => {
    // AI 的说明（D-110）：草稿里显示在回复里，直接应用的功能显示在「做好了」页面上。
    const extra = notes?.length ? { notes: JSON.stringify(notes) } : {};
    if (origin.guide) void setGuideStage(isGoalParam(origin.guide) ? 'done' : 'goal');
    const made = addedWorkflowIds.length === 1 ? addedWorkflowIds[0] : undefined;
    if (origin.about?.kind === 'shared') {
      router.push({ pathname: '/share', params: made ? { made } : {} });
      return;
    }
    const sample = isGoalParam(origin.guide) ? guideGoal(origin.guide).sample : null;
    const ready = made ?? (origin.about?.kind === 'workflow' ? origin.about.workflowId : undefined);
    if (ready) {
      router.push({
        pathname: '/ready/[workflowId]',
        params: {
          workflowId: ready,
          ...(sample ? { sample } : {}),
          ...(isGoalParam(origin.guide) ? { guide: origin.guide } : {}),
          ...extra,
        },
      });
      return;
    }
    const table = addedCollectionIds.length === 1 ? addedCollectionIds[0] : undefined;
    if (table) {
      router.push({
        pathname: '/table-ready/[collectionId]',
        params: { collectionId: table, ...extra },
      });
    }
  };
}

/** 「做好了」页面的 notes 参数（JSON 字符串数组）；看不懂就当没有。 */
export function readyNotes(param: string | undefined): string[] {
  try {
    const value: unknown = param ? JSON.parse(param) : [];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 「应用」草稿（D-190）：合成一个版本保存（顶部照常出现「已改好 · 撤销」），然后同上。 */
export function useApplyDraft(): () => Promise<void> {
  const applyDraft = useWorkspace((s) => s.applyDraft);
  const after = useAfterApply();
  return async () => {
    const applied = await applyDraft();
    if (applied) after(applied);
  };
}
