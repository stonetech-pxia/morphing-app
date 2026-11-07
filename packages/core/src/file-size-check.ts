import { FILE_LIMITS, MEDIA_LIMITS } from './limits';
import { mediaKindOf } from './media';
import { RunError } from './workflow/engine';

const MB = 1024 * 1024;

/** 视频和音频：由原生模块边读边写，不进 JS 内存（D-142）。 */
export const isMediaFile = (f: { name: string; mimeType?: string | null }) => {
  const kind = mediaKindOf(f.mimeType, f.name);
  return kind === 'video' || kind === 'audio';
};

/**
 * 要整份读进 JS 内存处理的文件：检查大小上限（P-006）。选择器不一定提供大小，复制后再检查一次。
 * 视频和音频单独用 MEDIA_LIMITS：单个 4 GB、最多 10 个，不计入合计（D-142）。
 * 快捷操作和全部文件页面的合并 PDF 都走这一个函数，阈值只有一份（R04）。
 */
export function checkSizes(
  sizes: readonly { name: string; size: number | null; mimeType?: string | null }[],
): void {
  const media = sizes.filter(isMediaFile);
  for (const f of media) {
    if ((f.size ?? 0) > MEDIA_LIMITS.maxFileBytes) {
      throw new RunError('tooLarge', { name: f.name, mb: MEDIA_LIMITS.maxFileBytes / MB });
    }
  }
  if (media.length > MEDIA_LIMITS.maxCount) {
    throw new RunError('tooMany', { max: MEDIA_LIMITS.maxCount });
  }
  const others = sizes.filter((f) => !isMediaFile(f));
  for (const f of others) {
    if ((f.size ?? 0) > FILE_LIMITS.maxFileBytes) {
      throw new RunError('tooLarge', { name: f.name, mb: FILE_LIMITS.maxFileBytes / MB });
    }
  }
  if (others.reduce((sum, f) => sum + (f.size ?? 0), 0) > FILE_LIMITS.maxTotalBytes) {
    throw new RunError('tooLargeTotal', { mb: FILE_LIMITS.maxTotalBytes / MB });
  }
}
