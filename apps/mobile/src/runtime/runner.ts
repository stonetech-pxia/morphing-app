import {
  isFileValue,
  runWorkflow,
  type AskRequest,
  type Locale,
  type OcrLanguage,
  type Registry,
  type RunEvent,
  type RunResult,
  type RunValue,
  type Workflow,
} from '@morph/core';

import type { WorkspaceRepo } from '../storage/types';
import type { RunServices } from './actions/helpers';
import { ACTION_IMPLS } from './actions';
import { VISION_LANGUAGES } from './actions/ocr';
import type { LocalUi } from './local';
import type { FilePlatform, PickedFile } from './platform';

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
  /** 当前配置里的数据表（读取记录用）。 */
  collections?: RunServices['collections'];
  packs?: RunServices['packs'];
  askParams?: (request: AskRequest) => Promise<Record<string, unknown> | null>;
  ensurePack?: (packId: string) => Promise<boolean>;
  signal?: { cancelled: boolean };
  onEvent?: (event: RunEvent) => void;
  /** 分享进来的文件（D-115）：交给第一步，第一步不再打开选择器，也不问参数。 */
  incoming?: readonly PickedFile[] | null;
}

export interface Run {
  result: RunResult;
  /** 本次运行的临时文件 ID；结果页关闭时调用 dispose 删除。 */
  runId: string;
  dispose(): Promise<void>;
}

/** 保存的文件授权给谁：工具自带的工作流给工具，用户自己的工作流给它自己。 */
export const granteeOf = (workflow: Workflow) => workflow.toolId ?? `workflow:${workflow.id}`;

/**
 * 这一步在这台设备上不需要扩展包（D-085–D-087）：系统能识别这种语言；系统能找边，
 * 或者输入全是文档相机拉正过的页面（scan.detect 直接放行）。
 */
export function packNotNeeded(
  files: FilePlatform,
  actionId: string,
  params: Record<string, unknown>,
  input: RunValue | null,
): boolean {
  const { vision } = files;
  if (actionId === 'ocr.recognize') {
    const languages = VISION_LANGUAGES[params.lang as OcrLanguage];
    return !!vision && !!languages && vision.supportsLanguage(languages[0]!);
  }
  if (actionId === 'scan.detect') {
    if (vision?.canFindPaper) return true;
    return isFileValue(input) && input.items.every((item) => item.straightened);
  }
  return false;
}

/** 这台设备上真正需要下载的扩展包（工作流页的提示用；预设的扫描都从文档相机开始）。 */
export function packsNeeded(packIds: readonly string[], files: FilePlatform): string[] {
  const { vision } = files;
  if (!vision) return [...packIds];
  return packIds.filter((id) => {
    if (id === 'scan') return !vision.canFindPaper && !vision.documentCamera;
    if (id === 'ocr') return false;
    if (id.startsWith('ocr-')) {
      const languages = VISION_LANGUAGES[id.slice(4).replace('-', '_') as OcrLanguage];
      return !languages || !vision.supportsLanguage(languages[0]!);
    }
    return true;
  });
}

/** 第一步用分享进来的文件时，它的「每次运行时问」（来源、个数）没有意义，不问。 */
function askUnlessShared(
  ctx: RunContext,
  ask: NonNullable<RunContext['askParams']>,
): NonNullable<RunContext['askParams']> {
  if (!ctx.incoming) return ask;
  return async (request) => (request.step === ctx.workflow.steps[0] ? {} : ask(request));
}

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
      collections: ctx.collections ?? [],
      packs: ctx.packs ?? null,
      incoming: ctx.incoming ?? null,
    },
    locale: ctx.locale,
    now: ctx.now,
    newId: ctx.newId,
    ...(ctx.askParams ? { askParams: askUnlessShared(ctx, ctx.askParams) } : {}),
    ...(ctx.ensurePack ? { ensurePack: ctx.ensurePack } : {}),
    packNotNeeded: (actionId, params, input) => packNotNeeded(ctx.files, actionId, params, input),
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
