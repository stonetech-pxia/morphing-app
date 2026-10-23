import { RunError, sanitizeFileName, uniqueFileName } from '@morph/core';

import type { MorphShareModule } from '../../modules/morph-share';
import type { FolderItem } from './platform';

// 输出去向（D-100、D-101）：一次分享多个文件、存到用户在「文件」里选的文件夹。
// 有本地模块 MorphShare 时用它；没有时（Expo Go）分享退回 expo-sharing 逐个打开面板，
// 存到文件夹退回 expo-file-system 的选文件夹。依赖从外面传进来，测试里用假的。

/** 用户选好的文件夹（Expo Go 里的退路）。 */
export interface PickedFolder {
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

export async function saveAllToFolder(
  deps: ShareDeps,
  items: readonly FolderItem[],
): Promise<number | null> {
  if (items.length === 0) return 0;
  try {
    if (deps.native) {
      return await deps.native.exportFiles(
        items.map((i) => i.uri),
        items.map((i) => sanitizeFileName(`${i.name}.${i.ext}`)),
        items.map((i) => i.mimeType),
      );
    }
    const folder = await deps.pickFolder();
    if (!folder) return null;
    const taken = folder.names();
    for (const item of items) {
      const name = uniqueFileName(sanitizeFileName(item.name), item.ext, taken);
      taken.push(name);
      await folder.write(name, item.mimeType, item.uri);
    }
    return items.length;
  } catch (e) {
    if ((e as { code?: string }).code === FOLDER_NOT_WRITABLE) {
      throw new RunError('folderNotWritable');
    }
    throw new RunError('saveFailed', { detail: e instanceof Error ? e.message : String(e) });
  }
}
