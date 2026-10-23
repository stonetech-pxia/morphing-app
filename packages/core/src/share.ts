import { FILE_LIMITS } from './limits';
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
    case 'any':
      return true;
    default:
      return false;
  }
}

/** 分享进来的文件能不能直接当作这个输入步骤的结果（类型和个数都要对得上）。 */
export function shareFitsInput(
  actionId: string,
  params: Record<string, unknown>,
  files: readonly SharedFileInfo[],
): ShareFit {
  let type: FileValueType;
  let accepts: (mime: string) => boolean;
  if (actionId === 'in.photos') {
    // 相册、拍照、扫描都算：分享进来的照片没有拉正，后面的找边步骤会处理。
    type = 'images';
    accepts = isImage;
  } else if (actionId === 'in.files') {
    const accept = String(params.accept);
    type = (FILE_ACCEPT[accept] ?? 'files') as FileValueType;
    accepts = (mime) => acceptsSharedFile(accept, mime);
  } else {
    return { ok: false, reason: 'type' };
  }
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

/** 大小上限（P-006）：和选择器选的文件一样，单个 50 MB、合计 100 MB。没问题时返回 null。 */
export function sharedSizeProblem(
  files: readonly SharedFileInfo[],
):
  | { code: 'tooLarge'; detail: { name: string; mb: number } }
  | { code: 'tooLargeTotal'; detail: { mb: number } }
  | null {
  const mb = (bytes: number) => bytes / 1024 / 1024;
  for (const f of files) {
    if ((f.size ?? 0) > FILE_LIMITS.maxFileBytes) {
      return { code: 'tooLarge', detail: { name: f.name, mb: mb(FILE_LIMITS.maxFileBytes) } };
    }
  }
  const total = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  if (total > FILE_LIMITS.maxTotalBytes) {
    return { code: 'tooLargeTotal', detail: { mb: mb(FILE_LIMITS.maxTotalBytes) } };
  }
  return null;
}
