import { localize, type Locale, type Localized } from '@morph/core';

import { create } from 'zustand';

import type { WorkspaceRepo } from '../storage/types';

// 新手引导（D-149、D-231）：划屏介绍 → 第 1 步发一句话加上两个文件入口（直接生效）→ 第 2 步打开图片或文件。
// 进度存在本机的 app_meta 里；没有记录就是第一次打开。「设置 → 重新看新手引导」从头再来。

/** intro：要显示划屏介绍；look：第 1 步；goal：第 2 步；done：看完或关掉了。 */
export type GuideStage = 'intro' | 'look' | 'goal' | 'done';

const STAGES: readonly GuideStage[] = ['intro', 'look', 'goal', 'done'];
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
    // 以前的「新手任务」小卡片（later）已经去掉（D-231）：当作看完了。
    const stage = saved === 'later' ? 'done' : saved;
    set({ repo, stage: STAGES.includes(stage as GuideStage) ? (stage as GuideStage) : 'intro' });
  },
  async setStage(stage) {
    set({ stage });
    await get().repo?.setMeta(META_KEY, stage);
  },
}));

/**
 * 第 1 步的句子（D-231）：首页是空的，先加上「打开相册」「打开文件」。中英文都是内置规则认得的（测试逐句检查）。
 * 中英文引导固定用内置规则，不调用设置里的 AI：结果稳定、马上出来，也不需要 key。
 * 内置规则不认法语（P-037）：法语界面发法语原句给设置里的 AI。
 */
export const LOOK_PROMPTS: readonly Localized[] = [
  {
    zh: '加入「打开相册」和「打开文件」按钮',
    en: 'Add the “Open photo library” and “Open files” buttons',
    fr: 'Ajouter les boutons « Ouvrir les photos » et « Ouvrir les fichiers »',
  },
];

/** 从引导打开 AI 修改时带的参数（`look-0` 这样的第 1 步句子）对应的句子。 */
export function guideText(param: string | undefined, locale: Locale): string | null {
  const look = /^look-(\d+)$/.exec(param ?? '');
  return look ? (localize(LOOK_PROMPTS[Number(look[1])], locale) ?? null) : null;
}
