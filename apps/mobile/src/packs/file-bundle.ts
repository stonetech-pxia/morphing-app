import type { PackNeed } from '@morph/core';

import type { FilePlatform } from '../runtime/platform';
import type { WorkspaceRepo } from '../storage/types';
import type { PackStore } from './store';

/**
 * 文件处理包一次问完（D-456）：第一次扫描完、第一次分享或打开文件后，一个框列出这台手机处理文件要用的扩展包
 * （文字识别模型、PDF 预览、页面展平、版面分析、没有文档相机时的拉正照片），一次下载。
 * 问过一次就记下来（用户点了下载或以后再说），不再问；以后在「设置 → 已下载内容」里下载。
 */
export const FILE_BUNDLE_ASKED = 'packs:file-bundle-asked';

/** 这台手机处理文件要用、还没装的扩展包。 */
export async function fileBundleMissing(files: FilePlatform, store: PackStore): Promise<string[]> {
  const v = files.vision;
  const wanted = [
    v?.ocrModel?.pack,
    'pdfview',
    v?.flattenModel?.pack,
    v?.layoutModel?.pack,
    v && !v.canFindPaper && !v.documentCamera ? 'scan' : undefined,
  ].filter((id): id is string => typeof id === 'string');
  const have = new Set((await store.installed()).map((p) => p.id));
  return wanted.filter((id) => !have.has(id));
}

/** 还没问过、而且有要下载的：返回要列出来的扩展包；否则空。只读，不写数据。 */
export async function fileBundleToOffer(
  repo: Pick<WorkspaceRepo, 'getMeta'>,
  files: FilePlatform,
  store: PackStore,
): Promise<string[]> {
  if ((await repo.getMeta(FILE_BUNDLE_ASKED)) !== null) return [];
  return fileBundleMissing(files, store);
}

/**
 * 运行时要扩展包（D-064、D-299）：只为必需的弹框；可选的（展平、版面、文字层、按文字取名）没装就直接跳过，
 * 不在每次运行时问（D-456，改 D-274 的每次问）。返回没下载的可选扩展包；null 表示必需的没下载（取消运行）。
 */
export async function ensureRunPacks(
  store: PackStore,
  needs: readonly PackNeed[],
  ask: (needs: readonly PackNeed[]) => Promise<string[] | null>,
): Promise<string[] | null> {
  const have = new Set((await store.installed()).map((p) => p.id));
  const missing = needs.filter((n) => !have.has(n.pack));
  const skipped = missing.filter((n) => n.optional).map((n) => n.pack);
  const required = missing.filter((n) => !n.optional);
  if (required.length === 0) return skipped;
  const left = await ask(required);
  return left === null ? null : [...left, ...skipped];
}
