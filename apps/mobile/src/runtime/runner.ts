import {
  RunError,
  localize,
  isFileValue,
  ocrPackId,
  runWorkflow,
  templateReads,
  type AskRequest,
  type Calendar,
  type DevicePack,
  type Locale,
  type OcrLanguage,
  type PackNeed,
  type Registry,
  type RunEvent,
  type RunResult,
  type RunValue,
  type Workflow,
} from '@morph/core';

import { t } from '../i18n';
import type { WorkspaceRepo } from '../storage/types';
import type { RunServices } from './actions/helpers';
import { ACTION_IMPLS } from './actions';
import { VISION_LANGUAGES } from './actions/ocr';
import { resolveOcrLanguage } from './ocr-language';
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
  calendar?: Calendar;
  packs?: RunServices['packs'];
  askParams?: (request: AskRequest) => Promise<Record<string, unknown> | null>;
  ensurePack?: (packId: string, options?: { optional?: boolean }) => Promise<boolean>;
  /** 一次问完这次运行要的扩展包（D-299）：返回没下载的可选扩展包，null 表示取消。 */
  ensurePacks?: (needs: readonly PackNeed[]) => Promise<string[] | null>;
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

/** 会跑很久的动作（视频、音频）：含这些步骤的运行切到别的 App 也继续（D-160）。 */
const BACKGROUND_ACTIONS: ReadonlySet<string> = new Set([
  'video.speed',
  'video.crop',
  'video.rotate',
  'video.audio',
  'video.mute',
  'video.merge',
  'video.compress',
  'video.convert',
  'video.trim',
  'video.toGif',
  'audio.volume',
  'audio.denoise',
  'audio.transcribe',
  'video.subtitles',
  'audio.compress',
  'audio.convert',
  'audio.trim',
  'audio.merge',
  'audio.fromVideo',
]);

export const isBackgroundAction = (actionId: string) => BACKGROUND_ACTIONS.has(actionId);

/** 进度通知最多多久改一次（毫秒）。 */
const NOTIFY_MS = 1000;

/**
 * 含长步骤的运行：从开始（用户刚点了，App 在前台；Android 12 起在后台不能开始）到结束一直保活，
 * 长步骤后面的命名、保存也在后台跑完。第一次时问一次通知权限（D-161），结束时不在前台就发完成通知（D-162）。
 */
async function keepAlive(ctx: RunContext) {
  const background = ctx.files.background;
  const { workflow, locale, registry } = ctx;
  if (!background || !workflow.steps.some((step) => isBackgroundAction(step.action))) return null;
  await background.ensureNotificationPermission();
  if (!background.begin(workflow.name, t(locale, 'bgPreparing'))) return null;
  let notifiedAt = 0;
  return {
    onEvent(e: RunEvent) {
      const now = ctx.now().getTime();
      if (e.kind === 'progress' && now - notifiedAt < NOTIFY_MS) return;
      notifiedAt = now;
      const action = workflow.steps[e.index]!.action;
      const text = t(locale, 'bgStep', {
        n: e.index + 1,
        total: workflow.steps.length,
        step: localize(registry.actions.get(action)?.label, locale) ?? action,
      });
      if (e.kind === 'step' || e.total <= 0) {
        background.update(text, null);
        return;
      }
      const amount = t(locale, e.unit === 'percent' ? 'runPercent' : 'runProgress', {
        done: e.done,
        total: e.total,
      });
      background.update(
        `${text} · ${amount}`,
        e.unit === 'percent' ? e.done / 100 : e.done / e.total,
      );
    },
    end(result: RunResult | null) {
      const notify = result !== null && result.status !== 'cancelled' && !background.isForeground();
      const ok = result?.status === 'succeeded';
      background.end(
        notify
          ? {
              title: t(locale, ok ? 'bgDoneTitle' : 'bgFailedTitle', { name: workflow.name }),
              body: t(locale, ok ? 'bgDoneBody' : 'bgFailedBody'),
            }
          : null,
      );
    },
  };
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
  locale: Locale = 'en',
): boolean {
  const { vision } = files;
  // 语音转文字（D-150、D-151）：iOS 用系统识别，不用下载内容；没有原生模块时动作自己报错，不白下载。
  if (actionId === 'audio.transcribe' || actionId === 'video.subtitles')
    return files.speech?.engine !== 'whisper';
  if (actionId === 'ocr.recognize') {
    const languages = VISION_LANGUAGES[resolveOcrLanguage(params.lang, locale)];
    return !!vision && !!languages && vision.supportsLanguage(languages[0]!);
  }
  if (actionId === 'scan.detect') {
    if (vision?.canFindPaper) return true;
    return isFileValue(input) && input.items.every((item) => item.straightened);
  }
  return false;
}

/**
 * 这一步在这台设备上要的文字识别模型（D-269）：识别 PP-OCRv6 认的语言时要它；可搜索 PDF 的文字层、
 * 按识别出的文字取名不下载也能做（没有文字层、用原来的名字），所以是可选的。
 */
export function devicePack(
  files: FilePlatform,
  actionId: string,
  params: Record<string, unknown>,
  locale: Locale = 'en',
): DevicePack | DevicePack[] | undefined {
  // 扫描的展平模型（D-274）：在扫描包之外另外问，不下载也照常扫描。
  const flatten = files.vision?.flattenModel;
  if (actionId === 'scan.detect') {
    return flatten && params.flatten !== false
      ? { pack: flatten.pack, optional: true, extra: true }
      : undefined;
  }
  const model = files.vision?.ocrModel;
  // 转 Word（D-328）：和转 Excel 一样要认字的模型，另外可选版面分析模型（不下载也照样转）。
  if (actionId === 'ocr.toWord') {
    const ocr = devicePack(files, 'ocr.toExcel', params, locale) as DevicePack | undefined;
    const layout = files.vision?.layoutModel;
    const extra = layout ? [{ pack: layout.pack, optional: true, extra: true }] : [];
    return ocr || extra.length ? [...(ocr ? [ocr] : []), ...extra] : undefined;
  }
  // 转 Excel（D-272）要每行的位置，只用本机的识别（PP-OCRv6 或系统的），不用文字识别包。
  if (actionId === 'ocr.recognize' || actionId === 'ocr.toExcel') {
    const lang = resolveOcrLanguage(params.lang, locale);
    const code = VISION_LANGUAGES[lang]?.[0];
    if (model && code && model.languages.includes(code.split('-')[0]!)) return { pack: model.pack };
    // 自动（D-278）选到系统也认不了的语言（Android 的俄文、越南文）：要那种语言的识别包。
    if (
      actionId === 'ocr.recognize' &&
      params.lang === 'auto' &&
      !(code && files.vision?.supportsLanguage(code))
    ) {
      return { pack: ocrPackId(lang) };
    }
    return undefined;
  }
  if (!model) return undefined;
  if (actionId === 'pdf.fromImages' && params.textLayer === true) {
    return { pack: model.pack, optional: true };
  }
  if (
    actionId === 'file.rename' &&
    typeof params.template === 'string' &&
    templateReads(params.template).ocr
  ) {
    return { pack: model.pack, optional: true };
  }
  return undefined;
}

/** 这台设备上真正需要下载的扩展包（工作流页的提示用；预设的扫描都从文档相机开始）。 */
export function packsNeeded(packIds: readonly string[], files: FilePlatform): string[] {
  const { vision } = files;
  const speechNeeded = (id: string) =>
    !id.startsWith('speech-') || files.speech?.engine === 'whisper';
  if (!vision) return packIds.filter(speechNeeded);
  return packIds
    .filter((id) => {
      if (id === 'scan') return !vision.canFindPaper && !vision.documentCamera;
      if (id === 'ocr') return false;
      if (id.startsWith('speech-')) return speechNeeded(id);
      if (id.startsWith('ocr-')) {
        const languages = VISION_LANGUAGES[id.slice(4).replace('-', '_') as OcrLanguage];
        return !languages || !vision.supportsLanguage(languages[0]!);
      }
      return true;
    })
    .concat(
      // PP-OCRv6 认的语言不要语言包，但要文字识别模型（D-269）。
      vision.ocrModel &&
        packIds.some((id) => {
          const code = VISION_LANGUAGES[id.slice(4).replace('-', '_') as OcrLanguage]?.[0];
          return (
            id.startsWith('ocr-') &&
            !!code &&
            vision.ocrModel!.languages.includes(code.split('-')[0]!)
          );
        })
        ? [vision.ocrModel.pack]
        : [],
    );
}

/** 第一步用分享进来的文件时，它的「每次运行时问」（来源、个数）没有意义，不问。 */
function askUnlessShared(
  ctx: RunContext,
  ask: NonNullable<RunContext['askParams']>,
): NonNullable<RunContext['askParams']> {
  if (!ctx.incoming) return ask;
  return async (request) => (request.step === ctx.workflow.steps[0] ? {} : ask(request));
}

/**
 * 这台设备根本做不了的步骤（iOS 17 以下、没有 Google Play 服务时的去背景）：开始前就说，
 * 不要等用户选完照片、跑到那一步才告诉他。
 */
function unsupportedStep(ctx: RunContext): RunResult | null {
  const index = ctx.workflow.steps.findIndex((s) => s.action === 'image.removeBackground');
  if (index < 0 || ctx.files.vision?.backgroundRemovalSupported) return null;
  return {
    status: 'failed',
    stepIndex: index,
    error: new RunError('unsupportedAction', { action: t(ctx.locale, 'backgroundNeedsSystem') }),
  };
}

export async function startRun(ctx: RunContext): Promise<Run> {
  const runId = ctx.newId();
  const blocked = unsupportedStep(ctx);
  if (blocked) return { result: blocked, runId, dispose: async () => undefined };
  const alive = await keepAlive(ctx);
  const onEvent = alive
    ? (e: RunEvent) => {
        alive.onEvent(e);
        ctx.onEvent?.(e);
      }
    : ctx.onEvent;
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
      ...(ctx.calendar ? { calendar: ctx.calendar } : {}),
      packs: ctx.packs ?? null,
      incoming: ctx.incoming ?? null,
      ...(ctx.ensurePack ? { ensurePack: ctx.ensurePack } : {}),
    },
    locale: ctx.locale,
    now: ctx.now,
    newId: ctx.newId,
    ...(ctx.askParams ? { askParams: askUnlessShared(ctx, ctx.askParams) } : {}),
    ...(ctx.ensurePack ? { ensurePack: ctx.ensurePack } : {}),
    ...(ctx.ensurePacks ? { ensurePacks: ctx.ensurePacks } : {}),
    packNotNeeded: (actionId, params, input) =>
      packNotNeeded(ctx.files, actionId, params, input, ctx.locale),
    devicePack: (actionId, params) => devicePack(ctx.files, actionId, params, ctx.locale),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(onEvent ? { onEvent } : {}),
    record: {
      start: () =>
        ctx.repo.startToolRun({
          toolId: ctx.workflow.toolId ?? 'workflow',
          workflowId: ctx.workflow.id,
          revisionId: ctx.revisionId,
        }),
      finish: (id, outcome) => ctx.repo.finishToolRun(id, outcome),
    },
  }).then(
    (done) => {
      alive?.end(done);
      return done;
    },
    (e: unknown) => {
      alive?.end(null);
      throw e;
    },
  );
  const dispose = () => ctx.files.removeRun(runId);
  // 没有结果可看时立即清理临时文件。
  if (result.status !== 'succeeded') await dispose();
  return { result, runId, dispose };
}

export function newAssetId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
