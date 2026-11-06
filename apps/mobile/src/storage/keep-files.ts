import { sanitizeFileName } from '@morph/core';

import type { FilePlatform, PickedFile } from '../runtime/platform';
import { copyUserFiles } from '../renderer/slot-file';
import type { WorkspaceRepo } from './types';

/**
 * 打开、分享进来的文件都存进文档库（D-455）：每个文件存一份副本（缩略图在存的时候画好），记下 assetId，
 * 后面存成记录等直接用它。同名、同大小、也是打开进来的文件已经在文档库里时不再存一份。
 * 存不下（太大、空间不够、复制失败）的文件照样进收件页面，只是不进文档库。文字由 copyUserFiles 在后面读（不等）。
 * 原件不动（底线 4）；这是用户打开、分享这一次操作的一部分（底线 16）。
 */
export async function keepIncomingFiles(
  picked: readonly PickedFile[],
  files: FilePlatform,
  repo: WorkspaceRepo,
): Promise<PickedFile[]> {
  const kept: PickedFile[] = [];
  for (const file of picked) {
    if (file.assetId) {
      kept.push(file);
      continue;
    }
    const name = sanitizeFileName(file.name);
    const same = (await repo.listAssets()).find(
      (a) => a.source === 'picked' && a.name === name && file.size !== null && a.size === file.size,
    );
    if (same) {
      kept.push({ ...file, assetId: same.id });
      continue;
    }
    const { assetIds } = await copyUserFiles([file], files, repo);
    const id = assetIds[0];
    if (!id) {
      kept.push(file);
      continue;
    }
    kept.push({ ...file, assetId: id });
  }
  return kept;
}
