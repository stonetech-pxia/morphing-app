import { create } from 'zustand';

import type { FilePlatform, PickedFile } from '../runtime/platform';

// 分享到 Morph（TOOLS_DESIGN §11）：别的 App 分享进来、还没处理的文件。只在内存里，不进配置、不进数据库，
// 也不发给 AI；用户选了工作流、存到文件或关掉收件页面后清掉（D-097）。

export interface IncomingShare {
  /** 每次分享一个新 ID：收件页面据此知道是不是又分享了一批。 */
  id: number;
  files: PickedFile[];
  /** Android：原生模块顺手复制到 App 缓存目录的副本（file://），用完一起删。 */
  copies: string[];
}

interface IncomingState {
  share: IncomingShare | null;
  receive(files: PickedFile[], copies?: string[]): void;
  clear(): void;
}

let seq = 0;

export const useIncoming = create<IncomingState>()((set) => ({
  share: null,
  receive: (files, copies = []) => set({ share: { id: ++seq, files, copies } }),
  clear: () => set({ share: null }),
}));

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * expo-share-intent 原生模块给的数据 → 选择器同样格式的文件列表。
 * iOS 是一段 JSON（分享扩展复制到 App Group 共享目录的 file:// 地址）；Android 是对象，
 * 用 content:// 地址（发送方授予了读权限；filePath 常常是 App 没有权限读的外部存储路径）。
 * 文字和网址不收（Morph 只处理文件），返回空列表。
 */
export function normalizeShare(raw: unknown): PickedFile[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  const out: PickedFile[] = [];
  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const uri = str(o.contentUri) ?? str(o.path);
    if (!uri || !/^(file|content):\/\//.test(uri)) continue;
    const width = num(o.width);
    const height = num(o.height);
    out.push({
      uri,
      name: str(o.fileName) ?? decodeURIComponent(uri.split('/').pop() ?? 'file'),
      size: num(o.fileSize) ?? num(o.size),
      mimeType: str(o.mimeType),
      ...(width && height ? { width, height } : {}),
    });
  }
  return out;
}

/**
 * expo-share-intent 的 Android 模块读不到原始路径时，会把文件复制到 App 缓存目录的最上层（用原文件名）。
 * 我们用 content:// 地址，不用这些副本，但要记下来删掉（D-097）。
 */
export function nativeCopies(raw: unknown): string[] {
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const path = str(o.filePath);
    return str(o.contentUri) && path?.includes('/cache/') ? [`file://${path}`] : [];
  });
}

/**
 * 用完一批分享的文件（D-097）：从内存里清掉，删掉共享目录里的副本。
 * 这期间又分享了一批时，只清这一批，新的一批保留。
 */
export async function releaseShare(
  files: Pick<FilePlatform, 'removeShared'>,
  id: number,
): Promise<void> {
  const current = useIncoming.getState().share;
  if (current?.id === id) useIncoming.getState().clear();
  const keep = current && current.id !== id ? current.files.map((f) => f.uri) : [];
  await files.removeShared(keep, current?.id === id ? current.copies : []).catch(() => undefined);
}
