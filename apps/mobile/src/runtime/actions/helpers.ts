import {
  FILE_LIMITS,
  RunError,
  isFileValue,
  sanitizeFileName,
  type Collection,
  type RunItem,
  type RunValue,
} from '@morph/core';
import { capPixels } from '@morph/tool-image';

import type { WorkspaceRepo } from '../../storage/types';
import type { FilePlatform, PickedFile } from '../platform';
import type { PackRuntime } from '../../packs/bridge';
import type { LocalUi } from '../local';

// 动作实现共用的工具函数和运行环境。

/** 一次运行注入给动作实现的环境。 */
export interface RunServices {
  runId: string;
  files: FilePlatform;
  repo: WorkspaceRepo;
  /** 保存的文件授权给谁：工具 ID，或用户自己的工作流 `workflow:<id>`（§7G）。 */
  grantee: string;
  ui: LocalUi;
  /** 当前配置里的数据表（读取记录、生成报表用）。 */
  collections: readonly Collection[];
  /** 扩展包（WebView 里的 pdf.js、OpenCV、tesseract）；没有时为 null。 */
  packs: { runtime: PackRuntime; isInstalled(id: string): Promise<boolean> } | null;
  /** 从别的 App 分享进来的文件：第一步（in.photos / in.files）直接用它们，不打开选择器（D-096）。 */
  incoming?: readonly PickedFile[] | null;
}

export const MB = 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  zip: 'application/zip',
  txt: 'text/plain',
};

export const extOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
export const baseName = (name: string) => name.replace(/\.[^./]+$/, '');
export const mimeOfExt = (ext: string) => MIME_BY_EXT[ext] ?? 'application/octet-stream';

export function mimeOf(name: string, given: string | null): string {
  if (given && given !== 'application/octet-stream') return given;
  return mimeOfExt(extOf(name));
}

export const isImageMime = (mime: string) => mime.startsWith('image/');

/** 输入一定是文件（校验器保证了类型）。 */
export function fileItems(input: RunValue | null): RunItem[] {
  if (!isFileValue(input)) throw new RunError('unexpected', { detail: 'no files' });
  return input.items;
}

let counter = 0;
/**
 * 临时文件的相对路径：每个中间结果放在自己的子目录里（不会覆盖前一步的输入），
 * 文件名就是显示名，所以分享、存到「文件」时对方看到的是正确的名字。
 */
export const freshName = (name: string, ext: string) =>
  `${++counter}/${sanitizeFileName(name)}.${ext}`;

/** 把一段字节写成本次运行的临时文件。 */
export async function writeItem(
  services: RunServices,
  bytes: Uint8Array,
  item: Omit<RunItem, 'uri' | 'size'>,
): Promise<RunItem> {
  const stored = await services.files.writeRunFile(
    services.runId,
    freshName(item.name, item.ext),
    bytes,
  );
  return { ...item, uri: stored.uri, size: stored.size };
}

/** 选择器给的文件：检查大小上限（P-006）。选择器不一定提供大小，复制后再检查一次。 */
export function checkSizes(sizes: readonly { name: string; size: number | null }[]): void {
  for (const f of sizes) {
    if ((f.size ?? 0) > FILE_LIMITS.maxFileBytes) {
      throw new RunError('tooLarge', { name: f.name, mb: FILE_LIMITS.maxFileBytes / MB });
    }
  }
  if (sizes.reduce((sum, f) => sum + (f.size ?? 0), 0) > FILE_LIMITS.maxTotalBytes) {
    throw new RunError('tooLargeTotal', { mb: FILE_LIMITS.maxTotalBytes / MB });
  }
}

export async function readItem(services: RunServices, item: RunItem): Promise<Uint8Array> {
  try {
    return await services.files.readUri(item.uri);
  } catch {
    throw new RunError('accessDenied', { name: `${item.name}.${item.ext}` });
  }
}

/** 本次运行的临时文件 → 文件名（报错时显示）。 */
export const displayName = (item: RunItem) => `${item.name}.${item.ext}`;

/**
 * 送进扩展包页面（WebView）的图片：重新编码成 JPG（摆正方向、去掉元数据，WebView 不一定认识 HEIC），
 * 缩到 iOS canvas 的 1677 万像素以内，长边不超过 maxSide。
 */
export async function imageForPage(
  services: RunServices,
  item: RunItem,
  maxSide: number,
): Promise<RunItem> {
  let size = item.width && item.height ? { width: item.width, height: item.height } : null;
  try {
    size ??= await services.files.imageSize(item.uri);
    const fit = capPixels(size);
    const k = Math.min(1, maxSide / Math.max(size.width, size.height), fit.width / size.width);
    const resize = {
      width: Math.max(1, Math.round(size.width * k)),
      height: Math.max(1, Math.round(size.height * k)),
    };
    const out = await services.files.transformImage(
      item.uri,
      k < 1 ? { resize } : {},
      { format: 'jpeg', quality: 0.92 },
      services.runId,
      freshName(item.name, 'jpg'),
    );
    return {
      ...item,
      uri: out.uri,
      ext: 'jpg',
      mimeType: 'image/jpeg',
      size: out.size,
      width: out.width,
      height: out.height,
    };
  } catch {
    throw new RunError('unreadable', { name: displayName(item) });
  }
}

/** 扩展包页面返回的 base64 → 字节。 */
export const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
