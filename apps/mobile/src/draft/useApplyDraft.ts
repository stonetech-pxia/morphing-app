import { guideGoal } from '@morph/core';
import { useRouter } from 'expo-router';

import { isGoalParam, useGuide } from '../guide/store';
import { useWorkspace } from '../workspace/context';

/**
 * 「应用」草稿（D-190）：合成一个版本保存（顶部照常出现「已改好 · 撤销」），然后带用户去该去的地方：
 * 新做了一个快捷操作 →「做好了」页面（D-125，引导做的可以先用示例试一下）；
 * 从收件页面开始的 → 回到收件页面，用分享的文件运行新的快捷操作（D-129）；
 * 从一个快捷操作开始的（「让 AI 改这个」）→ 它的「做好了」页面，现在就能再用一次（D-126）。
 */
export function useApplyDraft(): () => Promise<void> {
  const router = useRouter();
  const applyDraft = useWorkspace((s) => s.applyDraft);
  const setGuideStage = useGuide((s) => s.setStage);
  return async () => {
    const applied = await applyDraft();
    if (!applied) return;
    const { origin, addedWorkflowIds } = applied;
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
        params: { workflowId: ready, ...(sample ? { sample } : {}) },
      });
    }
  };
}
