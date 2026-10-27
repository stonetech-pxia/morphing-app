import type { FilePlatform } from '../runtime/platform';
import type { WorkspaceRepo } from './types';

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
