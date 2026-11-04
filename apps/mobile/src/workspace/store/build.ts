import {
  buildItemId,
  recheckItems,
  setItemStatus,
  startBuildItems,
  type PlanSession,
} from '@morph/core';

import { StepStopped, type createAIChange } from './ai-change';
import type { Kernel } from './kernel';
import type { SessionStore } from './session';
import type { BuildRun, BuildRunStep, ChangeResult, WorkspaceState } from './types';

// 大工程的搭建计划（AGENT_PLAN §3.9、D-415）。模型先回计划，用户看过、可以删掉几步，点「开始」。这一次点击算一次用户操作
// （底线 16 的解释，D-416）：一步一次 planner.plan，带工具清单和当前配置；功能直接生效，外观进草稿（底线 7 不变）；
// 一步失败就停下，由用户选重试、跳过或停止。App 进后台或重启后停在没做完的那一步，用户点了才继续。

const BUILD_META_KEY = 'build';

/** 这一步做完功能后，最多再接着做几句（next）。 */
const NEXT_TURNS = 1;

function parseBuild(stored: string | null): BuildRun | null {
  if (!stored) return null;
  try {
    const run = JSON.parse(stored) as BuildRun;
    return Array.isArray(run.steps) && run.steps.length > 0 ? run : null;
  } catch {
    return null;
  }
}

type Turn = ReturnType<typeof createAIChange>['aiChange'];

export function createBuild(k: Kernel, session: SessionStore) {
  const { deps, repo, registry, locale, set, get, msg } = k;
  let turn: Turn;
  /** 用户点了停止（或 App 进后台）：做完手上这一步就停，模型回来了也不应用。 */
  let stopRequested = false;
  let looping = false;

  async function save(build: BuildRun | null) {
    set({ build });
    await repo.setMeta(BUILD_META_KEY, build ? JSON.stringify(build) : '');
  }

  async function patchStep(id: string, patch: Partial<BuildRunStep>, phase?: BuildRun['phase']) {
    const build = get().build;
    if (!build) return;
    await save({
      ...build,
      ...(phase ? { phase } : {}),
      steps: build.steps.map((s) => {
        if (s.id !== id) return s;
        const { reason: _, needsDraft: _n, ...rest } = s;
        return { ...rest, ...patch };
      }),
    });
  }

  type StepOutcome =
    | { kind: 'done'; already?: boolean }
    | { kind: 'stopped' }
    | { kind: 'failed'; reason: string; needsDraft?: boolean };

  async function doStep(
    build: BuildRun,
    step: BuildRunStep,
    position: NonNullable<PlanSession['step']>,
  ): Promise<StepOutcome> {
    let input = step.current ?? step.request;
    let isNext = step.current !== undefined;
    for (let extra = 0; extra <= NEXT_TURNS; extra++) {
      const itemId = isNext ? undefined : buildItemId(step.id);
      let result: ChangeResult;
      try {
        result = await turn(input, deps.provider, build.origin, false, {
          step: position,
          ...(itemId ? { itemId } : {}),
          stillWanted: () => !stopRequested,
        });
      } catch (e) {
        if (e instanceof StepStopped) return { kind: 'stopped' };
        return { kind: 'failed', reason: msg('buildFailedModel') };
      }
      if (result.kind === 'needsDraft')
        return { kind: 'failed', reason: result.message, needsDraft: true };
      if (result.kind === 'invalid') return { kind: 'failed', reason: msg('buildFailedInvalid') };
      if (result.kind === 'rejected') {
        // 配置已经是这样了：这一步不用做。
        if (result.reason === 'noChange') {
          if (itemId) await session.update((s) => setItemStatus(s, itemId, 'done'));
          // 这一步自己的那句没改到任何东西：前面已经做了。接着做剩下的外观时不算。
          return { kind: 'done', ...(isNext ? {} : { already: true }) };
        }
        return { kind: 'failed', reason: result.message };
      }
      // 代码判定做好了没有（D-414），不看模型怎么说。
      const item = get().session.items.find((i) =>
        itemId ? i.id === itemId : i.text === input && i.status !== 'todo',
      );
      if (item?.status === 'failed')
        return { kind: 'failed', reason: item.reason ?? msg('buildFailedInvalid') };
      // 这句话里剩下的外观（next）：还算这一步，不用用户再点（同一次「开始」）。还剩的留在清单里。
      const next = get().next;
      if (!next || next === input || extra === NEXT_TURNS) return { kind: 'done' };
      await patchStep(step.id, { status: 'running', current: next });
      input = next;
      isNext = true;
    }
    return { kind: 'done' };
  }

  async function finish() {
    const planned = get().draft?.steps.at(-1)?.config ?? get().config!;
    // 整体检查：中间放过的「页面在下一步」这时要算了。
    await session.update((s) => recheckItems(s, planned, registry, locale, { all: true }));
    const build = get().build;
    if (build) await save({ ...build, phase: 'finished' });
  }

  /** 从第一个没做完的步骤接着做，直到做完、失败或停下。 */
  async function run() {
    if (looping) return;
    looping = true;
    stopRequested = false;
    try {
      for (;;) {
        const build = get().build;
        if (!build) return;
        if (stopRequested) {
          await save({ ...build, phase: 'paused' });
          return;
        }
        const active = build.steps.filter((s) => s.status !== 'skipped');
        const step = active.find((s) => s.status !== 'done');
        if (!step) {
          await finish();
          return;
        }
        await patchStep(step.id, { status: 'running' }, 'running');
        const index = active.indexOf(step);
        const outcome = await doStep(get().build ?? build, step, {
          index: index + 1,
          total: active.length,
          remaining: active.length - index - 1,
        });
        if (outcome.kind === 'stopped') {
          await patchStep(step.id, { status: 'todo' }, 'paused');
          return;
        }
        if (outcome.kind === 'failed') {
          await patchStep(
            step.id,
            {
              status: 'failed',
              reason: outcome.reason,
              ...(outcome.needsDraft ? { needsDraft: true } : {}),
            },
            'failed',
          );
          await session.update((s) =>
            setItemStatus(s, buildItemId(step.id), 'failed', outcome.reason),
          );
          return;
        }
        await patchStep(step.id, { status: 'done', ...(outcome.already ? { already: true } : {}) });
      }
    } finally {
      looping = false;
    }
  }

  const actions: Pick<
    WorkspaceState,
    | 'removeBuildStep'
    | 'startBuild'
    | 'stopBuild'
    | 'resumeBuild'
    | 'skipBuildStep'
    | 'applyDraftForBuild'
    | 'endBuild'
  > = {
    async removeBuildStep(stepId) {
      const build = get().build;
      if (!build || build.phase !== 'review') return;
      const steps = build.steps.filter((s) => s.id !== stepId);
      await save(steps.length > 0 ? { ...build, steps } : null);
    },

    async startBuild() {
      const build = get().build;
      if (!build || build.phase !== 'review') return;
      await session.update((s) => startBuildItems(s, build.summary, build.steps));
      await save({ ...build, phase: 'running' });
      await run();
    },

    async stopBuild() {
      const build = get().build;
      if (!build) return;
      if (build.phase === 'running' && looping) stopRequested = true;
      else if (build.phase === 'failed' || build.phase === 'running')
        await save({ ...build, phase: 'paused' });
    },

    async resumeBuild() {
      const build = get().build;
      if (!build || (build.phase !== 'paused' && build.phase !== 'failed')) return;
      await save({ ...build, phase: 'running' });
      await run();
    },

    async skipBuildStep() {
      const build = get().build;
      const step = build?.steps.find((s) => s.status === 'failed');
      if (!build || build.phase !== 'failed' || !step) return;
      await patchStep(step.id, { status: 'skipped' }, 'running');
      await session.update((s) => setItemStatus(s, buildItemId(step.id), 'skipped'));
      await run();
    },

    async applyDraftForBuild() {
      const build = get().build;
      if (!build || build.phase !== 'failed') return;
      if (!(await get().applyDraft())) return;
      await actions.resumeBuild();
    },

    async endBuild() {
      const build = get().build;
      if (!build || (looping && build.phase === 'running')) return;
      await save(null);
    },
  };

  return {
    actions,
    /** ai-change.ts 要用 showBuild，这里要用它的一句话：建好之后再接上。 */
    useTurn(fn: Turn) {
      turn = fn;
    },
    async showBuild({ summary, steps, origin }: Pick<BuildRun, 'summary' | 'steps' | 'origin'>) {
      await save({ summary, steps, origin, phase: 'review' });
    },
    /** 启动：上次在做的算停下了，用户点了才继续（底线 16）。 */
    async loadBuild() {
      const build = parseBuild(await repo.getMeta(BUILD_META_KEY));
      if (!build) return;
      if (build.phase !== 'running') {
        set({ build });
        return;
      }
      await save({
        ...build,
        phase: 'paused',
        steps: build.steps.map((s) => (s.status === 'running' ? { ...s, status: 'todo' } : s)),
      });
    },
  };
}
