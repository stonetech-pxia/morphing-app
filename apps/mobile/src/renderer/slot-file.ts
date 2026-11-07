import type { FilePlatform, PickedFile } from '../runtime/platform';
import { copyUserFiles, type ImportProblem } from '../storage/copy-files';
import type { WorkspaceRepo } from '../storage/types';

// 文件入口（D-257）和附件字段（D-263）：用户选的文件复制一份存成用户文件（assets/<id>/<文件名>），原件不动
// （AGENTS.md「文件的归属」）。选择在这里，复制进 App 在 storage/copy-files.ts（R11）。

/** 从哪里选：相机（只给附件用）、相册（原样，不重新编码）、「文件」。 */
export type SlotSource = 'camera' | 'photos' | 'files';

export type { ImportProblem };

export type SlotImport =
  { kind: 'saved'; assetId: string } | { kind: 'cancelled' } | { kind: ImportProblem };

/** 一次选了几个文件：存好的按选的顺序；中间出了问题就停在那里，problem 说明原因。 */
export type FilesImport =
  { kind: 'cancelled' } | { kind: 'done'; assetIds: string[]; problem?: ImportProblem };

async function pick(
  source: SlotSource,
  max: number,
  files: FilePlatform,
): Promise<PickedFile[] | null> {
  if (source === 'camera') {
    const photo = await files.takePhoto();
    return photo ? [photo] : null;
  }
  return source === 'photos' ? files.pickMedia(max) : files.pickDocuments(['*/*'], max > 1);
}

/** 选最多 max 个文件，逐个复制进 App。 */
export async function importUserFiles(
  source: SlotSource,
  max: number,
  files: FilePlatform,
  repo: WorkspaceRepo,
): Promise<FilesImport> {
  const picked = (await pick(source, max, files))?.slice(0, max);
  if (!picked || picked.length === 0) return { kind: 'cancelled' };
  try {
    return { kind: 'done', ...(await copyUserFiles(picked, files, repo)) };
  } finally {
    // 选择器复制进缓存的那份（视频可能很大）用完就删；相册原件、content:// 不在缓存里，不会动。
    await files.removePickedCopies(picked.map((p) => p.uri)).catch(() => undefined);
  }
}

/** 文件入口：选一个文件复制进 App。 */
export async function importSlotFile(
  source: Exclude<SlotSource, 'camera'>,
  files: FilePlatform,
  repo: WorkspaceRepo,
): Promise<SlotImport> {
  const result = await importUserFiles(source, 1, files, repo);
  if (result.kind === 'cancelled') return result;
  if (result.problem) return { kind: result.problem };
  return { kind: 'saved', assetId: result.assetIds[0]! };
}
