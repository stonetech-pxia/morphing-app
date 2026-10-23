import { FILE_LIMITS, MEDIA_LIMITS } from './limits';
import { mediaKindOf } from './media';
import type { Workflow } from './schema';
import { FILE_ACCEPT } from './tools/io';
import type { FileValueType } from './workflow/engine';

// 分享到 Morph（TOOLS_DESIGN §11，D-114–D-118）：别的 App 分享进来的文件交给哪个工作流。
// 文件只当作工作流第一步（in.photos / in.files）的输入，不改工作流的格式，AI 也看不到这些文件。

/** 分享进来的一个文件；mimeType 已经按扩展名补全。 */
export interface SharedFileInfo {
  name: string;
  mimeType: string;
  size: number | null;
}

export type ShareFit =
  | { ok: true; type: FileValueType }
  /** 第一步不收文件（输入文字、读取记录），或者文件类型不对。 */
  | { ok: false; reason: 'type' }
  | { ok: false; reason: 'tooFew'; min: number }
  | { ok: false; reason: 'tooMany'; max: number };

const isImage = (mime: string) => mime.startsWith('image/');
const isPdf = (mime: string) => mime === 'application/pdf';
const isZip = (mime: string) =>
  mime === 'application/zip' || mime === 'application/x-zip-compressed';
const isVideo = (mime: string) => mime.startsWith('video/');
const isAudio = (mime: string) => mime.startsWith('audio/');
/** 视频和音频由原生模块处理，用 MEDIA_LIMITS（D-133）。 */
const isMedia = (f: SharedFileInfo) => {
  const kind = mediaKindOf(f.mimeType, f.name);
  return kind === 'video' || kind === 'audio';
};

/** in.files 的 accept 收不收这个文件。 */
export function acceptsSharedFile(accept: string, mimeType: string): boolean {
  switch (accept) {
    case 'pdf':
      return isPdf(mimeType);
    case 'images':
      return isImage(mimeType);
    case 'pdfOrImages':
      return isPdf(mimeType) || isImage(mimeType);
    case 'zip':
      return isZip(mimeType);
    case 'videos':
      return isVideo(mimeType);
    case 'audio':
      return isAudio(mimeType);
    case 'any':
      return true;
    default:
      return false;
  }
}

/**
 * 收文件的输入动作：分享进来的文件当作它的结果时是什么类型、收不收这个文件。
 * 新的输入动作（例如以后的「选音频」）在这里加一行。
 */
const SHARE_INPUTS: Readonly<
  Record<
    string,
    (params: Record<string, unknown>) => { type: FileValueType; accepts(mime: string): boolean }
  >
> = {
  // 相册、拍照、扫描都算：分享进来的照片没有拉正，后面的找边步骤会处理。
  'in.photos': () => ({ type: 'images', accepts: isImage }),
  'in.videos': () => ({ type: 'video', accepts: isVideo }),
  'in.files': (params) => {
    const accept = String(params.accept);
    return {
      type: (FILE_ACCEPT[accept] ?? 'files') as FileValueType,
      accepts: (mime) => acceptsSharedFile(accept, mime),
    };
  },
};

/** 分享进来的文件能不能直接当作这个输入步骤的结果（类型和个数都要对得上）。 */
export function shareFitsInput(
  actionId: string,
  params: Record<string, unknown>,
  files: readonly SharedFileInfo[],
): ShareFit {
  const input = SHARE_INPUTS[actionId];
  if (!input) return { ok: false, reason: 'type' };
  const { type, accepts } = input(params);
  if (files.length === 0 || !files.every((f) => accepts(f.mimeType))) {
    return { ok: false, reason: 'type' };
  }
  const min = Number(params.min ?? 1);
  const max = Number(params.max ?? Infinity);
  if (files.length < min) return { ok: false, reason: 'tooFew', min };
  if (files.length > max) return { ok: false, reason: 'tooMany', max };
  return { ok: true, type };
}

/** 工作流能不能接这些文件：看第一步。 */
export function shareFit(workflow: Workflow, files: readonly SharedFileInfo[]): ShareFit {
  const first = workflow.steps[0];
  if (!first) return { ok: false, reason: 'type' };
  return shareFitsInput(first.action, first.params, files);
}

/**
 * 大小上限（P-006）：和选择器选的文件一样，单个 50 MB、合计 100 MB。视频和音频单独算（D-133）：
 * 单个 4 GB、最多 10 个，不计入合计。没问题时返回 null。
 */
export function sharedSizeProblem(
  files: readonly SharedFileInfo[],
):
  | { code: 'tooLarge'; detail: { name: string; mb: number } }
  | { code: 'tooLargeTotal'; detail: { mb: number } }
  | { code: 'tooMany'; detail: { max: number } }
  | null {
  const mb = (bytes: number) => bytes / 1024 / 1024;
  const media = files.filter(isMedia);
  for (const f of media) {
    if ((f.size ?? 0) > MEDIA_LIMITS.maxFileBytes) {
      return { code: 'tooLarge', detail: { name: f.name, mb: mb(MEDIA_LIMITS.maxFileBytes) } };
    }
  }
  if (media.length > MEDIA_LIMITS.maxCount) {
    return { code: 'tooMany', detail: { max: MEDIA_LIMITS.maxCount } };
  }
  const others = files.filter((f) => !isMedia(f));
  for (const f of others) {
    if ((f.size ?? 0) > FILE_LIMITS.maxFileBytes) {
      return { code: 'tooLarge', detail: { name: f.name, mb: mb(FILE_LIMITS.maxFileBytes) } };
    }
  }
  const total = others.reduce((sum, f) => sum + (f.size ?? 0), 0);
  if (total > FILE_LIMITS.maxTotalBytes) {
    return { code: 'tooLargeTotal', detail: { mb: mb(FILE_LIMITS.maxTotalBytes) } };
  }
  return null;
}
