import type { DataRecord } from '../data';
import type { Registry } from '../registry';
import type { Locale, Workflow, WorkflowStep } from '../schema';
import type { ActionDefinition, ValueType } from './contract';
import { workflowProblems } from './check';

// 工作流执行器（TOOLS_DESIGN §3）：唯一按顺序执行动作的地方。配置里只有动作 ID 和参数，没有任何代码。
// 动作的实现（ActionImpl）和平台能力（services）由 App 注入，因此这里可以在 Node 中测试。

export type FileValueType = Exclude<ValueType, 'text' | 'records'>;

/** 运行中的一个文件：缓存目录里的临时文件，保存之前不是用户文件（D-063）。 */
export interface RunItem {
  uri: string;
  /** 不含扩展名的显示名。 */
  name: string;
  ext: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  pageCount?: number;
  /** 视频、音频的时长（毫秒）。 */
  durationMs?: number;
  /** 照片的拍摄时间（毫秒）。 */
  takenAt?: number;
  /** 文件的修改时间（毫秒）：「文件」App 选的文件有，按日期筛选时拍摄时间读不到就用它（D-242）。 */
  modifiedAt?: number;
  /** 系统文档相机拍的页面：已经找边拉正，scan.detect 直接放行。 */
  straightened?: boolean;
  /** 已经存成用户文件时的文件 ID。 */
  assetId?: string;
  /**
   * 识别文字用的图（D-267）：scan.enhance 记下增强前的那张（增强对系统识别没有帮助，黑白还会抹掉淡字）。
   * 只在 uri 还等于 for 时有效：之后哪一步生成了新图片，uri 就变了，识别退回用当前的图。
   * width / height 是增强时转正前的大小，skew 是转正转的角度（度），用来把识别框换算到增强后的图上。
   */
  ocrSource?: { uri: string; for: string; width: number; height: number; skew: number };
}

export type RunValue =
  | { type: FileValueType; items: RunItem[] }
  /** 文字只留在本机（OCR、二维码识别）：复制、存成文件，绝不发给 AI。 */
  | { type: 'text'; text: string; name: string }
  /** 一张数据表里的记录（D-042）：只在本机生成 PDF / 打印，绝不发给 AI。 */
  | { type: 'records'; collectionId: string; records: DataRecord[]; name: string };

export type FileValue = Extract<RunValue, { items: RunItem[] }>;

export const isFileValue = (value: RunValue | null): value is FileValue =>
  value !== null && 'items' in value;

export type RunErrorCode =
  | 'tooFew'
  | 'tooMany'
  | 'wrongType'
  | 'tooLarge'
  | 'tooLargeTotal'
  | 'unreadable'
  | 'encrypted'
  | 'accessDenied'
  | 'saveFailed'
  | 'folderNotWritable'
  | 'noViewer'
  | 'previewFailed'
  | 'unsupportedAction'
  | 'invalidWorkflow'
  | 'cameraUnavailable'
  | 'permissionDenied'
  | 'packFailed'
  | 'targetNotMet'
  | 'unsupportedText'
  | 'badRange'
  | 'noFormFields'
  | 'badField'
  | 'notFound'
  | 'emptyText'
  | 'passwordMissing'
  | 'pdfRestricted'
  | 'pdfPasswordUnsupported'
  | 'textTooLong'
  | 'doesNotFit'
  | 'noRecords'
  /** 命名要在本机识别文字，这台设备没有系统自带的文字识别（Expo Go，D-244）。 */
  | 'needsRecognition'
  /** 按条件筛选之后一个文件都不剩（detail.count：原来几个，D-242）。 */
  | 'noneMatched'
  /** 视频、音频要用原生模块处理，Expo Go 里没有（D-141）。 */
  | 'needsFullApp'
  /** 系统打不开这段视频 / 音频（格式不支持、有版权保护）。 */
  | 'mediaUnsupported'
  | 'mergeUnsupported'
  | 'backgroundFailed'
  /** 手机剩余空间不够（detail.gb：还需要多少 GB）。 */
  | 'notEnoughSpace'
  /** 目标大小太小，压出来看不清（detail.mb：至少要多少 MB）。 */
  | 'targetTooSmall'
  /** 处理视频时切到了别的 App（iOS 不让后台用视频编码器，D-148）。 */
  | 'interrupted'
  /** 音频压到目标大小会听不清（detail.mb：至少要多少 MB，D-153）。 */
  | 'audioTooSmall'
  /** 视频里没有声音（取声音时，D-155）。 */
  | 'noAudio'
  /** 录音里没有听到说话（语音转文字，D-150）。 */
  | 'noSpeech'
  /** 这种格式这台手机打不开（detail.format：MKV 等，D-185）。 */
  | 'formatUnsupported'
  /** 视频太长，做不成 GIF（detail.seconds：最长几秒，D-184）。 */
  | 'tooLong'
  /** 这台手机不能把这种文档转成 PDF（detail.format：XLSX 等；Android 只能转 Word，D-186）。 */
  | 'documentUnsupported'
  | 'unexpected';

export class RunError extends Error {
  constructor(
    readonly code: RunErrorCode,
    /** 只含规格数字和文件显示名，给用户看；不写进执行记录。 */
    readonly detail: Record<string, string | number> = {},
  ) {
    super(`${code} ${JSON.stringify(detail)}`);
  }
}

/** 用户取消（选择器、本地操作界面、运行时询问、扩展包下载确认）。 */
export class RunCancelled extends Error {}

export interface StepContext<S> {
  workflow: Workflow;
  step: WorkflowStep;
  index: number;
  action: ActionDefinition;
  locale: Locale;
  now(): Date;
  newId(): string;
  services: S;
  /** 步内进度，例如第 3/10 张；unit 为 percent 时 done 是 0–100（视频处理）。 */
  progress(done: number, total: number, unit?: 'percent'): void;
  throwIfCancelled(): void;
  /** 本次运行保存成用户文件的 ID（file.save 填写）。 */
  saved: string[];
  /** 这一步问到的密码（secret 参数）：只在这次运行里用；没有问（没有询问界面、用户没填）时没有这个键。 */
  secrets: Readonly<Record<string, string>>;
}

export type ActionImpl<S> = (
  input: RunValue | null,
  params: Record<string, unknown>,
  ctx: StepContext<S>,
) => Promise<RunValue>;

export type RunEvent =
  | { kind: 'step'; index: number }
  | { kind: 'progress'; index: number; done: number; total: number; unit?: 'percent' };

export interface AskRequest {
  step: WorkflowStep;
  action: ActionDefinition;
  keys: readonly string[];
  params: Record<string, unknown>;
  input: RunValue | null;
}

export type RunResult =
  | {
      status: 'succeeded';
      value: RunValue | null;
      saved: string[];
      /** 第一步（输入）拿到的文件总大小：结果页显示「原来 X → 现在 Y」。 */
      inputSize: number;
    }
  | { status: 'cancelled' }
  | { status: 'failed'; error: RunError; stepIndex: number | null };

export interface RunOptions<S> {
  workflow: Workflow;
  registry: Registry;
  impls: Readonly<Record<string, ActionImpl<S>>>;
  services: S;
  locale: Locale;
  now: () => Date;
  newId: () => string;
  /** 运行时询问参数；返回本次使用的参数，null 表示用户取消。不写回配置。 */
  askParams?: (request: AskRequest) => Promise<Record<string, unknown> | null>;
  /** 步骤需要扩展包时调用：已安装或用户确认下载并完成后返回 true；用户拒绝返回 false（D-064）。 */
  ensurePack?: (packId: string) => Promise<boolean>;
  /**
   * 这一步在这台设备上不需要扩展包时返回 true，不调用 ensurePack（D-085–D-087）：
   * 系统自带的识别（iOS 的 Vision、Android 的 ML Kit），或者输入已经是拉正的页面。
   */
  packNotNeeded?: (
    actionId: string,
    params: Record<string, unknown>,
    input: RunValue | null,
  ) => boolean;
  /**
   * 这一步在这台设备上要的扩展包（D-269，例如文字识别模型）；有它时代替动作自己的扩展包。
   * optional：用户不下载也照样做（例如可搜索 PDF 没有文字层），不取消运行。
   * extra：不代替动作自己的扩展包，而是另外问一次（D-274：扫描的展平模型；只能是 optional）。
   */
  devicePack?: (
    actionId: string,
    params: Record<string, unknown>,
    input: RunValue | null,
  ) => { pack: string; optional?: boolean; extra?: boolean } | undefined;
  /** 界面把 cancelled 设为 true 即可取消。 */
  signal?: { cancelled: boolean };
  onEvent?: (event: RunEvent) => void;
  /** 执行记录（tool_runs）：只记录元数据，不记录内容和文件名。 */
  record?: {
    start(): Promise<number>;
    finish(
      id: number,
      result: {
        status: 'succeeded' | 'failed' | 'cancelled';
        error?: string;
        outputAssetId?: string;
      },
    ): Promise<void>;
  };
}

/** 检查「停止」的间隔。 */
const CANCEL_POLL_MS = 200;

/** core 不依赖 DOM 或 Node 的类型，计时器从全局对象取（App 和测试环境都有）。 */
const timers = globalThis as unknown as {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
};

export async function runWorkflow<S>(opts: RunOptions<S>): Promise<RunResult> {
  const { workflow, registry } = opts;
  const runId = (await opts.record?.start()) ?? null;
  const finish = async (result: RunResult) => {
    if (runId !== null && opts.record) {
      await opts.record.finish(runId, {
        status: result.status,
        ...(result.status === 'failed' ? { error: result.error.code } : {}),
        ...(result.status === 'succeeded' && result.saved[0]
          ? { outputAssetId: result.saved[0] }
          : {}),
      });
    }
    return result;
  };

  // 配置保存前已经校验过；执行前再检查一次（D-020 纵深防御）。
  if (workflowProblems(workflow, registry).length > 0) {
    return finish({ status: 'failed', error: new RunError('invalidWorkflow'), stepIndex: null });
  }

  const saved: string[] = [];
  let value: RunValue | null = null;
  let index = 0;
  let inputSize = 0;
  const throwIfCancelled = () => {
    if (opts.signal?.cancelled) throw new RunCancelled();
  };
  // 用户点「停止」时不再等待挂起的系统界面（例如没能弹出的文件选择器）：每一步都和取消信号赛跑。
  let stopWatching = () => {};
  const whenCancelled = new Promise<never>((_, reject) => {
    if (!opts.signal) return;
    const timer = timers.setInterval(() => {
      if (opts.signal?.cancelled) {
        timers.clearInterval(timer);
        reject(new RunCancelled());
      }
    }, CANCEL_POLL_MS);
    stopWatching = () => timers.clearInterval(timer);
  });
  whenCancelled.catch(() => undefined);
  const orCancel = <T>(promise: Promise<T>) => Promise.race([promise, whenCancelled]);
  try {
    for (const [i, step] of workflow.steps.entries()) {
      index = i;
      throwIfCancelled();
      opts.onEvent?.({ kind: 'step', index: i });
      const action = registry.actions.get(step.action)!;
      const impl = opts.impls[step.action];
      if (!impl) throw new RunError('unsupportedAction', { action: step.action });
      let params = action.params.parse(step.params);
      // 密码每次都问（D-194），和配置里的 ask 一起问；回答分开放，不进参数。
      const secretKeys = action.fields.filter((f) => f.kind === 'secret').map((f) => f.key);
      const keys = [...(step.ask ?? []), ...secretKeys.filter((k) => !step.ask?.includes(k))];
      const secrets: Record<string, string> = {};
      if (keys.length && opts.askParams) {
        const answered = await orCancel(
          opts.askParams({
            step,
            action,
            keys,
            params,
            input: value,
          }),
        );
        if (answered === null) throw new RunCancelled();
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(answered)) {
          if (!secretKeys.includes(k)) rest[k] = v;
          else if (typeof v === 'string' && v !== '') secrets[k] = v;
        }
        params = action.params.parse({ ...params, ...rest });
      }
      // 先问参数再确认扩展包：文字识别的语言包由本次选的语言决定。
      const device = opts.devicePack?.(action.id, params, value);
      const replaces = device && !device.extra ? device : undefined;
      const pack =
        replaces?.pack ??
        (opts.packNotNeeded?.(action.id, params, value)
          ? undefined
          : (action.packFor?.(params) ?? action.pack));
      if (
        pack &&
        opts.ensurePack &&
        !(await orCancel(opts.ensurePack(pack))) &&
        !replaces?.optional
      ) {
        throw new RunCancelled();
      }
      // 另外要的扩展包（可选）：用户不下载也照样做这一步。
      if (device?.extra && opts.ensurePack) await orCancel(opts.ensurePack(device.pack));
      throwIfCancelled();
      value = await orCancel(
        impl(value, params, {
          workflow,
          step,
          index: i,
          action,
          locale: opts.locale,
          now: opts.now,
          newId: opts.newId,
          services: opts.services,
          progress: (done, total, unit) =>
            opts.onEvent?.({
              kind: 'progress',
              index: i,
              done,
              total,
              ...(unit ? { unit } : {}),
            }),
          throwIfCancelled,
          saved,
          secrets,
        }),
      );
      if (i === 0) inputSize = totalSize(value);
    }
    return finish({ status: 'succeeded', value, saved, inputSize });
  } catch (e) {
    if (e instanceof RunCancelled) return finish({ status: 'cancelled' });
    const error = e instanceof RunError ? e : new RunError('unexpected', { detail: String(e) });
    return finish({ status: 'failed', error, stepIndex: index });
  } finally {
    stopWatching();
  }
}

/** 一个值里所有文件的总大小。 */
export const totalSize = (value: RunValue | null) =>
  isFileValue(value) ? value.items.reduce((sum, item) => sum + item.size, 0) : 0;
