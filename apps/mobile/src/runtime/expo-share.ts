import { RunError, sanitizeFileName, uniqueFileName } from '@morph/core';

import type { MorphShareModule, SavedToFolder } from '../../modules/morph-share';
import type { FolderItem } from './platform';

// 输出去向（D-119、D-120）：一次分享多个文件、存到用户在「文件」里选的文件夹。
// 有本地模块 MorphShare 时用它；没有时（Expo Go）分享退回 expo-sharing 逐个打开面板，
// 存到文件夹退回 expo-file-system 的选文件夹。每个快捷操作记住自己的文件夹（D-195），还没有时用最后选过的
// 那个（D-123）：原生模块存在系统里，Expo Go 里只在这次打开 App 期间记住。依赖从外面传进来，测试里用假的。

/** 用户选好的文件夹（Expo Go 里的退路）。 */
export interface PickedFolder {
  /** 文件夹的显示名。 */
  name: string;
  /** 文件夹里已有的文件名，不覆盖它们。 */
  names(): string[];
  /** 新建一个文件并写入源文件的内容；写不进去时抛出 code 为 ERR_FOLDER_NOT_WRITABLE 的错误。 */
  write(name: string, mimeType: string, sourceUri: string): Promise<void>;
}

export interface ShareDeps {
  native: MorphShareModule | null;
  /** 打开一次分享面板，只带一个文件（expo-sharing）。 */
  shareOne(item: { uri: string; mimeType: string }): Promise<void>;
  /** 让用户选一个文件夹；取消时返回 null。 */
  pickFolder(): Promise<PickedFolder | null>;
  /** Expo Go 里最后选过的文件夹（只在内存里）。 */
  remembered: PickedFolder | null;
  /** Expo Go 里每个快捷操作记住的文件夹（只在内存里）。 */
  rememberedBy: Map<string, PickedFolder>;
}

/** 快捷操作 key 会存进的文件夹的名字：它自己的，没有时是最后选过的。 */
export function rememberedFolder(deps: ShareDeps, key: string): string | null {
  if (deps.native) return deps.native.rememberedFolder(key);
  return (deps.rememberedBy.get(key) ?? deps.remembered)?.name ?? null;
}

/** 忘掉已经删掉的快捷操作的文件夹（keep：现在还有的快捷操作）。 */
export function forgetFolders(deps: ShareDeps, keep: readonly string[]): void {
  if (deps.native) {
    deps.native.forgetFolders(keep);
    return;
  }
  for (const key of [...deps.rememberedBy.keys()]) {
    if (!keep.includes(key)) deps.rememberedBy.delete(key);
  }
}

export const FOLDER_NOT_WRITABLE = 'ERR_FOLDER_NOT_WRITABLE';

export async function shareAll(
  deps: ShareDeps,
  items: readonly { uri: string; mimeType: string }[],
): Promise<void> {
  if (items.length === 0) return;
  if (deps.native) {
    await deps.native.shareFiles(
      items.map((i) => i.uri),
      items.map((i) => i.mimeType),
    );
    return;
  }
  for (const item of items) await deps.shareOne(item);
}

/**
 * 存到快捷操作 key 的文件夹：choose 为 false 时有记住的文件夹就直接存进去（它自己的，没有时用最后选过的
 * 并记给它），否则（或 choose 为 true）让用户选一个，记给它，也记成最后选过的。用户取消时返回 null。
 */
export async function saveAllToFolder(
  deps: ShareDeps,
  items: readonly FolderItem[],
  key: string,
  choose: boolean,
): Promise<SavedToFolder | null> {
  if (items.length === 0) return { saved: 0, folder: rememberedFolder(deps, key) ?? '' };
  try {
    if (deps.native) {
      return await deps.native.exportFiles(
        items.map((i) => i.uri),
        items.map((i) => sanitizeFileName(`${i.name}.${i.ext}`)),
        items.map((i) => i.mimeType),
        !choose,
        key,
      );
    }
    const kept = choose ? null : (deps.rememberedBy.get(key) ?? deps.remembered);
    const folder = kept ?? (await deps.pickFolder());
    if (!folder) return null;
    if (!kept) deps.remembered = folder;
    deps.rememberedBy.set(key, folder);
    const taken = folder.names();
    for (const item of items) {
      const name = uniqueFileName(sanitizeFileName(item.name), item.ext, taken);
      taken.push(name);
      await folder.write(name, item.mimeType, item.uri);
    }
    return { saved: items.length, folder: folder.name };
  } catch (e) {
    if ((e as { code?: string }).code === FOLDER_NOT_WRITABLE) {
      throw new RunError('folderNotWritable');
    }
    throw new RunError('saveFailed', { detail: e instanceof Error ? e.message : String(e) });
  }
}
