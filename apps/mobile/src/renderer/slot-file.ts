import { MEDIA_LIMITS, sanitizeFileName, uniqueFileName } from '@morph/core';

import { mimeOf } from '../runtime/actions/helpers';
import type { FilePlatform } from '../runtime/platform';
import { newAssetId } from '../runtime/runner';
import type { WorkspaceRepo } from '../storage/types';

// 文件入口（D-257）：用户选的文件复制一份存成用户文件（assets/<id>/<文件名>），原件不动
// （AGENTS.md「文件的归属」）。复制由原生的 File.copy 边读边写，不把文件读进 JS 内存，所以不受
// pdf-lib 那个 50 MB 的限制，只按视频的上限（D-142）和手机剩余空间检查。

export type SlotSource = 'photos' | 'files';

export type SlotImport =
  | { kind: 'saved'; assetId: string }
  | { kind: 'cancelled' }
  | { kind: 'tooLarge' | 'noSpace' | 'copyFailed' };

/** 复制时给手机留的余量：存满了系统和别的 App 会出问题。 */
const SPACE_MARGIN = 200 * 1024 * 1024;

export async function importSlotFile(
  source: SlotSource,
  files: FilePlatform,
  repo: WorkspaceRepo,
): Promise<SlotImport> {
  const picked =
    source === 'photos'
      ? (await files.pickMedia(1))?.[0]
      : (await files.pickDocuments(['*/*'], false))?.[0];
  if (!picked) return { kind: 'cancelled' };
  try {
    const size = picked.size ?? 0;
    if (size > MEDIA_LIMITS.maxFileBytes) return { kind: 'tooLarge' };
    const free = files.freeDiskBytes();
    if (free !== null && size + SPACE_MARGIN > free) return { kind: 'noSpace' };
    const clean = sanitizeFileName(picked.name);
    // 扩展名照原样保留（大小写也不改）。
    const ext = /\.([^./]+)$/.exec(clean)?.[1] ?? 'bin';
    const existing = (await repo.listAssets()).map((a) => a.name);
    const name = uniqueFileName(clean.replace(/\.[^.]+$/, '') || 'untitled', ext, existing);
    const id = newAssetId();
    let stored;
    try {
      stored = await files.importFile(picked, id, name);
    } catch {
      return { kind: 'copyFailed' };
    }
    await repo.addAsset({
      id,
      name,
      mimeType: mimeOf(name, picked.mimeType),
      size: stored.size,
      path: stored.path,
      source: 'picked',
      createdAt: Date.now(),
    });
    return { kind: 'saved', assetId: id };
  } finally {
    // 选择器复制进缓存的那份（视频可能很大）用完就删；相册原件、content:// 不在缓存里，不会动。
    await files.removePickedCopies([picked.uri]).catch(() => undefined);
  }
}
