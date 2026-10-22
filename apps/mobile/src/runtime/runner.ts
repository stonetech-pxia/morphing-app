import {
  runWorkflow,
  type AskRequest,
  type Locale,
  type Registry,
  type RunEvent,
  type RunResult,
  type Workflow,
} from '@morph/core';

import type { WorkspaceRepo } from '../storage/types';
import type { RunServices } from './actions/helpers';
import { ACTION_IMPLS } from './actions';
import type { LocalUi } from './local';
import type { FilePlatform } from './platform';

// App 侧的执行入口：把 core 的执行器（workflow/engine.ts）接上本地存储、平台能力和运行页面。
// 这里是唯一能执行动作的地方；配置里只有动作 ID 和参数，没有任何代码。

export type { FilePlatform, PickedFile } from './platform';

export interface RunContext {
  workflow: Workflow;
  revisionId: number;
  repo: WorkspaceRepo;
  files: FilePlatform;
  registry: Registry;
  locale: Locale;
  now: () => Date;
  newId: () => string;
  ui: LocalUi;
  packs?: RunServices['packs'];
  askParams?: (request: AskRequest) => Promise<Record<string, unknown> | null>;
  ensurePack?: (packId: string) => Promise<boolean>;
  signal?: { cancelled: boolean };
  onEvent?: (event: RunEvent) => void;
}

export interface Run {
  result: RunResult;
  /** 本次运行的临时文件 ID；结果页关闭时调用 dispose 删除。 */
  runId: string;
  dispose(): Promise<void>;
}

/** 保存的文件授权给谁：工具自带的工作流给工具，用户自己的工作流给它自己。 */
export const granteeOf = (workflow: Workflow) => workflow.toolId ?? `workflow:${workflow.id}`;

export async function startRun(ctx: RunContext): Promise<Run> {
  const runId = ctx.newId();
  const result = await runWorkflow({
    workflow: ctx.workflow,
    registry: ctx.registry,
    impls: ACTION_IMPLS,
    services: {
      runId,
      files: ctx.files,
      repo: ctx.repo,
      grantee: granteeOf(ctx.workflow),
      ui: ctx.ui,
      packs: ctx.packs ?? null,
    },
    locale: ctx.locale,
    now: ctx.now,
    newId: ctx.newId,
    ...(ctx.askParams ? { askParams: ctx.askParams } : {}),
    ...(ctx.ensurePack ? { ensurePack: ctx.ensurePack } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(ctx.onEvent ? { onEvent: ctx.onEvent } : {}),
    record: {
      start: () =>
        ctx.repo.startToolRun({
          toolId: ctx.workflow.toolId ?? 'workflow',
          workflowId: ctx.workflow.id,
          revisionId: ctx.revisionId,
        }),
      finish: (id, outcome) => ctx.repo.finishToolRun(id, outcome),
    },
  });
  const dispose = () => ctx.files.removeRun(runId);
  // 没有结果可看时立即清理临时文件。
  if (result.status !== 'succeeded') await dispose();
  return { result, runId, dispose };
}

export function newAssetId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
