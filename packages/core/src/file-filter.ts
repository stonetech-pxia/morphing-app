import { localDate, periodRange } from './data';
import { isOfficeFile, mediaKindOf } from './media';
import type { Period } from './schema';

// 按条件筛选文件（file.filter，D-242）：条件只能从固定的几种里选（类型、大小、图片方向、日期、时长），
// 每种最多一条，全部满足才保留。没有表达式，AI 只能选条件和数字，看不到文件。

export const FILTER_KINDS = ['any', 'images', 'pdf', 'video', 'audio', 'documents'] as const;
export const FILTER_ORIENTATIONS = ['any', 'landscape', 'portrait', 'square'] as const;

export interface FileFilter {
  kind: (typeof FILTER_KINDS)[number];
  size: 'any' | 'larger' | 'smaller';
  sizeMB?: number;
  orientation: (typeof FILTER_ORIENTATIONS)[number];
  date: 'any' | 'lastDays' | 'period' | 'between';
  days?: number;
  /** 日历上的一段：本周、本月、今年……（和数据表筛选同一套）。 */
  period?: Period;
  /** YYYY-MM-DD，含这一天。 */
  from?: string;
  to?: string;
  duration: 'any' | 'longer' | 'shorter';
  seconds?: number;
  /** 一个都不剩时：stop = 停下并说明，skip = 这一步不筛，原样交给下一步。 */
  whenEmpty: 'stop' | 'skip';
}

/** 筛选时用到的文件信息（RunItem 的一部分）。 */
export interface FilterableItem {
  name: string;
  ext: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** 照片的拍摄时间（毫秒）。 */
  takenAt?: number;
  /** 文件的修改时间（毫秒，「文件」App 选的文件有）。 */
  modifiedAt?: number;
}

/** 宽高差在 2% 以内算方的（手机拍的 1:1 照片常差几个像素）。 */
const SQUARE_TOLERANCE = 0.02;

/** 这一组条件里有没有真的条件（全是「不限」的筛选没有意义）。 */
export const hasFileCondition = (
  f: Pick<FileFilter, 'kind' | 'size' | 'orientation' | 'date' | 'duration'>,
) =>
  f.kind !== 'any' ||
  f.size !== 'any' ||
  f.orientation !== 'any' ||
  f.date !== 'any' ||
  f.duration !== 'any';

/** 要判断方向就要宽高，要判断时长就要时长：运行时先补齐这些信息。 */
export function fileFilterNeeds(f: FileFilter): { dimensions: boolean; duration: boolean } {
  return { dimensions: f.orientation !== 'any', duration: f.duration !== 'any' };
}

const localDay = (ms: number) => localDate(new Date(ms));

export function orientationOf(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  if (Math.abs(width - height) <= SQUARE_TOLERANCE * Math.max(width, height)) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function kindMatches(kind: FileFilter['kind'], item: FilterableItem): boolean {
  const name = `${item.name}.${item.ext}`;
  switch (kind) {
    case 'any':
      return true;
    case 'images':
      return mediaKindOf(item.mimeType, name) === 'image';
    case 'pdf':
      return mediaKindOf(item.mimeType, name) === 'pdf';
    case 'video':
      return mediaKindOf(item.mimeType, name) === 'video';
    case 'audio':
      return mediaKindOf(item.mimeType, name) === 'audio';
    case 'documents':
      return isOfficeFile(item.mimeType, name);
  }
}

/**
 * 一个文件是否满足全部条件。读不到的信息（没有拍摄 / 修改日期、没有宽高、不是视频音频没有时长）
 * 算不满足这一条：「最近 7 天的照片」不会把不知道日期的照片也留下。
 */
export function matchesFileFilter(item: FilterableItem, f: FileFilter, now: Date): boolean {
  if (!kindMatches(f.kind, item)) return false;
  if (f.size !== 'any') {
    const limit = (f.sizeMB ?? 0) * 1024 * 1024;
    if (f.size === 'larger' ? !(item.size > limit) : !(item.size < limit)) return false;
  }
  if (f.orientation !== 'any') {
    if (!item.width || !item.height) return false;
    if (orientationOf(item.width, item.height) !== f.orientation) return false;
  }
  if (f.date !== 'any') {
    const at = item.takenAt ?? item.modifiedAt;
    if (at === undefined) return false;
    const day = localDay(at);
    if (f.date === 'lastDays') {
      const days = f.days ?? 1;
      const start = localDay(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime(),
      );
      if (day < start || day > localDay(now.getTime())) return false;
    } else if (f.date === 'period') {
      const [start, end] = periodRange(f.period ?? 'today', now);
      if (day < start || day > end) return false;
    } else if (day < (f.from ?? '') || day > (f.to ?? '9999-12-31')) return false;
  }
  if (f.duration !== 'any') {
    if (item.durationMs === undefined) return false;
    const limit = (f.seconds ?? 0) * 1000;
    if (f.duration === 'longer' ? !(item.durationMs > limit) : !(item.durationMs < limit))
      return false;
  }
  return true;
}

export function filterFiles<T extends FilterableItem>(
  items: readonly T[],
  f: FileFilter,
  now: Date,
) {
  return items.filter((item) => matchesFileFilter(item, f, now));
}
