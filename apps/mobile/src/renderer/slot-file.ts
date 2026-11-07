import { MEDIA_LIMITS, sanitizeFileName, uniqueFileName } from '@morph/core';

import { mimeOf } from '../runtime/actions/helpers';
import type { FilePlatform, PickedFile } from '../runtime/platform';
import { newAssetId } from '../runtime/runner';
import { indexAssetText } from '../storage/asset-text';
import type { WorkspaceRepo } from '../storage/types';

// 文件入口（D-257）和附件字段（D-263）：用户选的文件复制一份存成用户文件（assets/<id>/<文件名>），原件不动
// （AGENTS.md「文件的归属」）。复制由原生的 File.copy 边读边写，不把文件读进 JS 内存，所以不受
// pdf-lib 那个 50 MB 的限制，只按视频的上限（D-142）和手机剩余空间检查。

/** 从哪里选：相机（只给附件用）、相册（原样，不重新编码）、「文件」。 */
export type SlotSource = 'camera' | 'photos' | 'files';

export type ImportProblem = 'tooLarge' | 'noSpace' | 'copyFailed';

export type SlotImport =
  { kind: 'saved'; assetId: string } | { kind: 'cancelled' } | { kind: ImportProblem };

/** 一次选了几个文件：存好的按选的顺序；中间出了问题就停在那里，problem 说明原因。 */
export type FilesImport =
  { kind: 'cancelled' } | { kind: 'done'; assetIds: string[]; problem?: ImportProblem };

/** 复制时给手机留的余量：存满了系统和别的 App 会出问题。 */
const SPACE_MARGIN = 200 * 1024 * 1024;

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

/**
 * 把几个文件逐个复制成用户文件，原件不动、也不删（收件那一批的副本由收件页面释放时删，D-392）。
 * 存好的按顺序；中间出了问题就停在那里，problem 说明原因。
 */
export async function copyUserFiles(
  picked: readonly PickedFile[],
  files: FilePlatform,
  repo: WorkspaceRepo,
): Promise<{ assetIds: string[]; created: string[]; problem?: ImportProblem }> {
  const assetIds: string[] = [];
  // 这一次新复制的（不算打开时已经存进文档库、直接拿来用的，D-455）：调用方放弃时只删这些。
  const created: string[] = [];
  const toIndex: { path: string; mimeType: string }[] = [];
  const done = (problem?: ImportProblem) => {
    // 文件里的文字在后面慢慢读，不让用户等（D-455）。
    void (async () => {
      for (const asset of toIndex) await indexAssetText(files, asset);
    })();
    return problem ? { assetIds, created, problem } : { assetIds, created };
  };
  for (const file of picked) {
    if (file.assetId) {
      assetIds.push(file.assetId);
      continue;
    }
    const size = file.size ?? 0;
    if (size > MEDIA_LIMITS.maxFileBytes) return done('tooLarge');
    // 每复制一个都重新查一次剩余空间（前面的已经占了地方）。
    const free = files.freeDiskBytes();
    if (free !== null && size + SPACE_MARGIN > free) return done('noSpace');
    const clean = sanitizeFileName(file.name);
    // 扩展名照原样保留（大小写也不改）。
    const ext = /\.([^./]+)$/.exec(clean)?.[1] ?? 'bin';
    const existing = (await repo.listAssets()).map((a) => a.name);
    const name = uniqueFileName(clean.replace(/\.[^.]+$/, '') || 'untitled', ext, existing);
    const id = newAssetId();
    let stored;
    try {
      // 原生复制失败时自己删掉半个文件（expo-platform 的 importFile）。
      stored = await files.importFile(file, id, name);
    } catch {
      return done('copyFailed');
    }
    try {
      await repo.addAsset({
        id,
        name,
        mimeType: mimeOf(name, file.mimeType),
        size: stored.size,
        path: stored.path,
        source: 'picked',
        createdAt: Date.now(),
      });
    } catch {
      // 副本已经复制进来、数据库里登记不上：这一个副本删掉（不然存储空间页看不到、也删不掉）；
      // 前面登记好的照旧，原件不动（R10）。
      await files.removeAssetFile(stored.path).catch(() => undefined);
      return done('copyFailed');
    }
    assetIds.push(id);
    created.push(id);
    toIndex.push({ path: stored.path, mimeType: mimeOf(name, file.mimeType) });
  }
  return done();
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
