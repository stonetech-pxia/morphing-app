import { FILE_LIMITS, sanitizeFileName, uniqueFileName } from '@morph/core';

import type { FilePlatform } from '../runtime/platform';
import { newAssetId } from '../runtime/runner';
import type { WorkspaceRepo } from '../storage/types';

// 用户在页面上选的照片（图片组件 D-046、图片背景 D-258）：从相册选一张，重新编码、缩小后存成用户文件，
// 配置里只记录文件 ID。照片不随版本删除（和其他用户文件一样）。

export type PickedPicture =
  { kind: 'saved'; assetId: string } | { kind: 'cancelled' } | { kind: 'tooLarge' };

export async function pickPicture(
  files: FilePlatform,
  repo: WorkspaceRepo,
  maxSide?: number,
): Promise<PickedPicture> {
  const picked = await files.pickImage(maxSide);
  if (!picked) return { kind: 'cancelled' };
  if ((picked.size ?? 0) > FILE_LIMITS.maxFileBytes) return { kind: 'tooLarge' };
  const id = newAssetId();
  const clean = sanitizeFileName(picked.name);
  const ext = /\.([^.]+)$/.exec(clean)?.[1] ?? 'jpg';
  const existing = (await repo.listAssets()).map((a) => a.name);
  const name = uniqueFileName(clean.replace(/\.[^.]+$/, ''), ext, existing);
  const stored = await files.importFile(picked, id, name);
  await repo.addAsset({
    id,
    name,
    mimeType: picked.mimeType ?? 'image/jpeg',
    size: stored.size,
    path: stored.path,
    source: 'picked',
    createdAt: Date.now(),
  });
  return { kind: 'saved', assetId: id };
}
