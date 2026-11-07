import { checkSizes, sanitizeFileName, uniqueFileName } from '@morph/core';
import { mergePdfs } from '@morph/tool-pdf';

import { guard } from '../runtime/actions/pdf';
import type { FilePlatform } from '../runtime/platform';
import { indexAssetText } from './asset-text';
import type { AssetRecord, WorkspaceRepo } from './types';

// 删除用户文件（「设置 → 存储空间」，D-264）：先删磁盘上的文件，再删数据库里的记录。
// 磁盘删了、记录没删掉时，这个文件还列在存储空间里，再删一次就行；反过来会留下看不见、删不掉的文件。

export async function deleteUserFiles(
  ids: readonly string[],
  repo: WorkspaceRepo,
  files: FilePlatform,
): Promise<void> {
  for (const id of ids) {
    const asset = await repo.getAsset(id);
    if (!asset) continue;
    await files.removeAssetFile(asset.path);
    await repo.deleteAsset(id);
  }
}

/**
 * 重命名一个用户文件（全部文件页面，D-472）：只改用户看到的名字，后缀不变（「合同」→「合同.pdf」）；
 * 名字空了或没变时不改，返回 false。
 */
export async function renameUserFile(
  asset: AssetRecord,
  base: string,
  repo: WorkspaceRepo,
): Promise<boolean> {
  const ext = /\.([^./]+)$/.exec(asset.name)?.[1] ?? '';
  // 空的不改（sanitizeFileName 会把空名字变成 untitled）。
  if (!base.trim().replace(/^\.+/, '')) return false;
  const clean = sanitizeFileName(base.trim().replace(/^\.+/, ''));
  const name = ext ? `${clean}.${ext}` : clean;
  if (name === asset.name) return false;
  await repo.renameAsset(asset.id, name);
  return true;
}

/**
 * 把几个 PDF 按顺序合成一个新的用户文件（全部文件页面，D-472）：原来的文件都不动。新文件和快捷操作存的一样
 * 画缩略图（saveRunFile）、在后面读文字（D-455）。读不了、加了密的 PDF 报 RunError（和「合并 PDF」一样的说明）；
 * 太大的（单个 50 MB、合计 100 MB）也报 RunError，在读文件之前。
 */
export async function mergeUserPdfs(
  assets: readonly AssetRecord[],
  name: string,
  repo: WorkspaceRepo,
  files: FilePlatform,
  ctx: { now(): Date; newId(): string },
): Promise<AssetRecord> {
  // pdf-lib 把整份文件读进内存：和快捷操作一样先按单个 50 MB、合计 100 MB 检查（P-006），读文件之前就拒绝。
  // 大小用存进文档库时记下的（runner 的 copyHandedFiles 也是这样查的）。
  checkSizes(assets.map((a) => ({ name: a.name, size: a.size, mimeType: a.mimeType })));
  const inputs: { name: string; bytes: Uint8Array }[] = [];
  for (const a of assets) inputs.push({ name: a.name, bytes: await files.readBytes(a.path) });
  const merged = await guard('', () => mergePdfs(inputs));
  const existing = (await repo.listAssets()).map((a) => a.name);
  const fileName = uniqueFileName(sanitizeFileName(name), 'pdf', existing);
  const id = ctx.newId();
  const runId = `merge-${id}`;
  try {
    const temp = await files.writeRunFile(runId, fileName, merged.bytes);
    const stored = await files.saveRunFile(temp.uri, id, fileName);
    const asset: AssetRecord = {
      id,
      name: fileName,
      mimeType: 'application/pdf',
      size: stored.size,
      path: stored.path,
      source: 'generated',
      createdAt: ctx.now().getTime(),
    };
    await repo.addAsset(asset);
    void indexAssetText(files, asset);
    return asset;
  } finally {
    await files.removeRun(runId).catch(() => undefined);
  }
}
