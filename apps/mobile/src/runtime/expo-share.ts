import { RunError, sanitizeFileName, uniqueFileName } from '@morph/core';

import type { MorphShareModule, SavedToFolder } from '../../modules/morph-share';
import type { FolderItem } from './platform';

// 输出去向（D-119、D-120）：一次分享多个文件、存到用户在「文件」里选的文件夹。
// 有本地模块 MorphShare 时用它；没有时（Expo Go）分享退回 expo-sharing 逐个打开面板，
// 存到文件夹退回 expo-file-system 的选文件夹。每个快捷操作记住自己的文件夹（D-196），还没有时用最后选过的
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
  /**
   * 能直接交给原生分享的文件（D-466）：Android 的 FileProvider 只开放了缓存里的 runs/、preview/、share/，
   * 桌上和文档库里的文件不在里面（三星真机上分享桌上的文件报 ERR_UNEXPECTED）。iOS 都能直接交。
   */
  shareable(uri: string): boolean;
  /** 把要分享的文件复制成 name（放进 share/，每次分享前清掉上一次的），返回副本的地址。 */
  stageCopy(uri: string, name: string, first: boolean): Promise<string>;
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

/** 分享出去时文件叫什么：有名字和扩展名时用它们（桌上的文件存成 v2-0.docx 这样的名字，D-466）。 */
function sharedName(item: { uri: string; name?: string; ext?: string }): string {
  const own = decodeURIComponent(item.uri.replace(/^.*\//, ''));
  if (!item.name) return own;
  return sanitizeFileName(item.ext ? `${item.name}.${item.ext}` : item.name);
}

/**
 * 原生分享前先把文件放到能交出去的地方、用对的名字（D-466）：不能直接交的、或者文件名不是用户看到的名字的，
 * 复制一份（同名的加 -2）。别的原样交出去（大视频不复制）。
 */
export async function stageForShare(
  deps: ShareDeps,
  items: readonly { uri: string; mimeType: string; name?: string; ext?: string }[],
): Promise<{ uri: string; mimeType: string }[]> {
  const taken: string[] = [];
  let first = true;
  const out: { uri: string; mimeType: string }[] = [];
  for (const item of items) {
    const name = sharedName(item);
    const own = decodeURIComponent(item.uri.replace(/^.*\//, ''));
    if (deps.shareable(item.uri) && sanitizeFileName(own) === name) {
      out.push({ uri: item.uri, mimeType: item.mimeType });
      continue;
    }
    const dot = name.lastIndexOf('.');
    const unique = dot > 0 ? uniqueFileName(name.slice(0, dot), name.slice(dot + 1), taken) : name;
    taken.push(unique);
    out.push({ uri: await deps.stageCopy(item.uri, unique, first), mimeType: item.mimeType });
    first = false;
  }
  return out;
}

export async function shareAll(
  deps: ShareDeps,
  items: readonly { uri: string; mimeType: string; name?: string; ext?: string }[],
): Promise<void> {
  if (items.length === 0) return;
  if (deps.native) {
    const ready = await stageForShare(deps, items);
    await deps.native.shareFiles(
      ready.map((i) => i.uri),
      ready.map((i) => i.mimeType),
    );
    return;
  }
  for (const item of items) await deps.shareOne(item);
}

export const NO_VIEWER = 'ERR_NO_VIEWER';

/** 用系统预览打开一个文件（D-238）；Expo Go 里没有原生模块，退回分享面板（iOS 的面板上能看文件）。 */
export async function previewFile(
  deps: ShareDeps,
  item: { uri: string; mimeType: string; name: string },
): Promise<void> {
  if (!deps.native) {
    await deps.shareOne(item);
    return;
  }
  try {
    await deps.native.previewFile(item.uri, item.mimeType, item.name);
  } catch (e) {
    if ((e as { code?: string }).code === NO_VIEWER) throw new RunError('noViewer');
    // 别的原生错误（读不到文件、权限）不把错误代码显示给用户。
    throw new RunError('previewFailed');
  }
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
