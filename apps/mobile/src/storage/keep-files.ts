import { sanitizeFileName } from '@morph/core';

import type { FilePlatform, PickedFile } from '../runtime/platform';
import { copyUserFiles } from '../renderer/slot-file';
import type { WorkspaceRepo } from './types';

/**
 * 打开、分享进来的文件都存进文档库（D-455）：每个文件存一份副本（缩略图在存的时候画好），记下 assetId，
 * 后面存成记录等直接用它。同名、同大小、内容也一样（SHA-256，原生边读边算）、也是打开进来的文件已经在文档库里时不再存一份；
 * 名字和大小一样但内容不同的是另一个文件，各存各的（R01）。算不出内容摘要时当成新文件，宁可多存一份也不关联错。
 * 存不下（太大、空间不够、复制失败）的文件照样进收件页面，只是不进文档库。文字由 copyUserFiles 在后面读（不等）。
 * 原件不动（底线 4）；这是用户打开、分享这一次操作的一部分（底线 16）。
 */
/** 文档库里已经有的、和这个文件是同一份的：名字、大小一样，内容的摘要也一样。 */
async function findSameFile(file: PickedFile, files: FilePlatform, repo: WorkspaceRepo) {
  if (file.size === null) return undefined;
  const name = sanitizeFileName(file.name);
  const candidates = (await repo.listAssets()).filter(
    (a) => a.source === 'picked' && a.name === name && a.size === file.size,
  );
  if (candidates.length === 0) return undefined;
  const digestOf = (uri: string) => files.contentDigest(uri).catch(() => null);
  const mine = await digestOf(file.uri);
  if (mine === null) return undefined;
  for (const candidate of candidates) {
    if ((await digestOf(files.fileUri(candidate.path))) === mine) return candidate;
  }
  return undefined;
}

export async function keepIncomingFiles(
  picked: readonly PickedFile[],
  files: FilePlatform,
  repo: WorkspaceRepo,
  /** 存好了几个（一次打开很多张照片时显示进度）。 */
  onProgress?: (done: number, total: number) => void,
): Promise<PickedFile[]> {
  const kept: PickedFile[] = [];
  const total = picked.length;
  const push = (file: PickedFile) => {
    kept.push(file);
    onProgress?.(kept.length, total);
  };
  for (const file of picked) {
    if (file.assetId) {
      push(file);
      continue;
    }
    const same = await findSameFile(file, files, repo);
    if (same) {
      push({ ...file, assetId: same.id });
      continue;
    }
    const { assetIds } = await copyUserFiles([file], files, repo);
    const id = assetIds[0];
    if (!id) {
      push(file);
      continue;
    }
    push({ ...file, assetId: id });
  }
  return kept;
}
