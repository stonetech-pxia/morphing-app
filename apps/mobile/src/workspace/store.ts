import { emptySession, type WorkspaceConfig } from '@morph/core';
import { createStore } from 'zustand/vanilla';

import { NEXT_META_KEY, SUGGEST_META_KEY, createAIChange, parseSuggest } from './store/ai-change';
import { createBuild } from './store/build';
import { createDraft } from './store/draft';
import { createEditing } from './store/editing';
import { createKernel } from './store/kernel';
import { createPresets } from './store/presets';
import { createRevisions } from './store/revisions';
import { createSession } from './store/session';
import type { WorkspaceDeps, WorkspaceState, WorkspaceStore } from './store/types';
import { createUI } from './store/ui';

// 修改协议的 App 端编排（§7D）：
// 用户请求 → 计划 → 校验 → 预览 → 确认 → 原子保存 → 重新读取并渲染 → 渲染成功才算成功，失败自动回退。
//
// 一个 zustand store，按职责分在 store/ 下几个文件里，对外只从这里拿（createWorkspaceStore、shownConfig、类型）：
// - store/types.ts：状态、动作和结果的类型。新动作先在 WorkspaceState 里声明。
// - store/kernel.ts：共用的依赖、文案、重新读取 head、等待「渲染成功」确认的提交（render）。
// - store/revisions.ts：版本——预览 → 确认 → 渲染确认 / 失败回退、撤销、恢复历史版本、启动。
//   按钮发起的修改（proposeOps）也走这里。
// - store/ai-change.ts：AI 修改的一句话（D-191，功能直接应用、外观进草稿）和「接着改」（next）。
// - store/session.ts：工具清单（D-414）：存盘和记一句；规则在 core 的 ai/session.ts。
// - store/build.ts：大工程的搭建计划（D-415）：一步一步调 ai-change.ts 的一句话。
// - store/draft.ts：AI 草稿（D-190）的存盘、重新套用、退一步、应用、离开、样板 App。
// - store/editing.ts：直接编辑和长按编辑（D-054、D-235）。
// - store/presets.ts：保存的预设（D-410）的存、改名、删除；应用走 revisions.ts 的预览 → 确认。
// - store/ui.ts：提示条、记录提示、导航项、刷新信号。
// 新功能放进管它的那个文件；要别的文件里的内部函数时，从那个文件的 create… 的返回值传进去（例如 opsProposal）。

export type {
  Applied,
  Banner,
  BuildRun,
  BuildRunStep,
  ChangeResult,
  Draft,
  DraftChatReply,
  DraftOrigin,
  DraftResult,
  DraftStep,
  EditDraft,
  EditResult,
  Proposal,
  ProposeResult,
  SavePresetResult,
  WaitingForDraft,
  WorkspaceDeps,
  WorkspaceState,
  WorkspaceStore,
} from './store/types';

/** 外壳和页面要显示的配置：在草稿模式里是草稿，否则是当前版本。 */
export function shownConfig(s: Pick<WorkspaceState, 'config' | 'draft'>): WorkspaceConfig | null {
  return s.draft?.open ? (s.draft.steps.at(-1)?.config ?? s.config) : s.config;
}

export function createWorkspaceStore(deps: WorkspaceDeps): WorkspaceStore {
  const { repo } = deps;
  return createStore<WorkspaceState>()((set, get) => {
    const k = createKernel(deps, set, get);
    const session = createSession(k);
    const draft = createDraft(k, session);
    const revisions = createRevisions(k, draft, session);
    const build = createBuild(k, session);
    const ai = createAIChange(k, { ...revisions, ...draft }, session, build.showBuild);
    build.useTurn(ai.aiChange);

    return {
      status: 'loading',
      error: null,
      config: null,
      head: null,
      proposal: null,
      banner: null,
      busy: false,
      planProgress: null,
      assetsVersion: 0,
      renderAttempt: 0,
      tab: null,
      appId: null,
      appEnters: 0,
      recordsVersion: 0,
      presetsVersion: 0,
      toast: null,
      editing: null,
      draft: null,
      draftNotice: null,
      next: null,
      suggest: [],
      session: emptySession(),
      build: null,

      async boot() {
        await revisions.bootHead();
        if (get().status !== 'ready') return;
        await draft.loadDraft();
        const old = get().draft;
        await session.load(old ? draft.earlierOf(old) : []);
        await build.loadBuild();
        set({
          next: (await repo.getMeta(NEXT_META_KEY)) || null,
          suggest: parseSuggest(await repo.getMeta(SUGGEST_META_KEY)),
        });
      },

      ...revisions.actions,
      ...createEditing(k, revisions),
      ...createUI(k),
      ...createPresets(k),
      ...ai.actions,
      ...draft.actions,
      ...session.actions,
      ...build.actions,
    };
  });
}
