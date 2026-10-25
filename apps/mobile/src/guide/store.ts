import {
  localize,
  GUIDE_GOALS,
  guideGoal,
  type GuideGoalId,
  type Locale,
  type Localized,
} from '@morph/core';

import { create } from 'zustand';

import type { WorkspaceRepo } from '../storage/types';

// 新手引导（D-149）：划屏介绍 → 第 1 步说一句话改界面 → 第 2 步说出「我有什么，我想要什么」做一个快捷操作。
// 进度存在本机的 app_meta 里；没有记录就是第一次打开。「设置 → 重新看新手引导」从头再来。

/**
 * intro：要显示划屏介绍；look：第 1 步；goal：第 2 步；later：第 2 步先放着（首页留一张小卡片）；
 * done：看完或关掉了。
 */
export type GuideStage = 'intro' | 'look' | 'goal' | 'later' | 'done';

const STAGES: readonly GuideStage[] = ['intro', 'look', 'goal', 'later', 'done'];
const META_KEY = 'guide';

interface GuideState {
  /** null：还没读（测试里不读，引导就不出现）。 */
  stage: GuideStage | null;
  repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'> | null;
  load(repo: Pick<WorkspaceRepo, 'getMeta' | 'setMeta'>): Promise<void>;
  setStage(stage: GuideStage): Promise<void>;
}

export const useGuide = create<GuideState>()((set, get) => ({
  stage: null,
  repo: null,
  async load(repo) {
    const saved = await repo.getMeta(META_KEY);
    set({ repo, stage: STAGES.includes(saved as GuideStage) ? (saved as GuideStage) : 'intro' });
  },
  async setStage(stage) {
    set({ stage });
    await get().repo?.setMeta(META_KEY, stage);
  },
}));

/**
 * 第 1 步的句子：一眼就能看出变化，都是内置规则认得的（测试逐句检查）。
 * 引导里固定用内置规则，不调用设置里的 AI：结果稳定、马上出来，也不需要 key。
 */
export const LOOK_PROMPTS: readonly Localized[] = [
  { zh: '换成霓虹风格', en: 'Switch to the Neon style' },
  {
    zh: '首页改成文件工作台，主题换成绿色',
    en: 'Rename the home page to File desk. Change the theme color to green',
  },
  { zh: '换成毛玻璃风格', en: 'Switch to the Glass style' },
];

/** 从引导打开 AI 修改时带的参数（`look-0` 这样的第 1 步句子，或者第 2 步的目标 id）对应的句子。 */
export function guideText(param: string | undefined, locale: Locale): string | null {
  if (!param) return null;
  const look = /^look-(\d+)$/.exec(param);
  if (look) return localize(LOOK_PROMPTS[Number(look[1])], locale) ?? null;
  return GUIDE_GOALS.some((g) => g.id === param)
    ? localize(guideGoal(param as GuideGoalId).text, locale)
    : null;
}

export const isGoalParam = (param: string | undefined): param is GuideGoalId =>
  GUIDE_GOALS.some((g) => g.id === param);
