import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphShare（D-119、D-120、D-123、D-196）：一次分享多个文件、把文件存进用户在「文件」里选的文件夹。
// iOS 是 ios/MorphShareModule.swift（UIActivityViewController、UIDocumentPickerViewController 选文件夹），
// Android 是 android/…/MorphShareModule.kt（ACTION_SEND_MULTIPLE、存储访问框架）。只用系统框架，不联网。
// Expo Go 和测试里是 null，调用方退回逐个分享 / expo-file-system 选文件夹。

export interface SavedToFolder {
  saved: number;
  /** 文件夹的显示名（给用户看，不发给 AI）。 */
  folder: string;
}

export interface MorphShareModule {
  /** 打开一次系统分享面板，带上全部文件（本机 file:// 地址）；面板关掉后返回。 */
  shareFiles(uris: readonly string[], mimeTypes: readonly string[]): Promise<void>;
  /**
   * 这个快捷操作（key）会存进的文件夹的名字（D-196）：它自己记住的，没有时是最后选过的那个（D-123）；
   * 都没有、或者文件夹已经不在 / 授权被收回时为 null。
   */
  rememberedFolder(key: string): string | null;
  /**
   * 把文件复制进一个文件夹：useRemembered 为 true 且有记住的文件夹时直接存进去（这个快捷操作自己的，
   * 没有时用最后选过的并记给它），否则让用户选一个（iCloud 云盘、Google Drive 等「文件」提供者都可以），
   * 记给这个快捷操作，也记成最后选过的。
   * names 是文件名（含扩展名）；文件夹里已有同名文件时不覆盖（iOS 加「 2」，Android 由文档提供者改名）。
   * 返回存了几个和文件夹名；用户取消时返回 null。
   * 文件夹写不进去时抛出 code 为 ERR_FOLDER_NOT_WRITABLE 的错误。
   */
  exportFiles(
    uris: readonly string[],
    names: readonly string[],
    mimeTypes: readonly string[],
    useRemembered: boolean,
    key: string,
  ): Promise<SavedToFolder | null>;
  /**
   * 用系统预览打开一个文件（D-238）：iOS 是 QuickLook（标题用 name，原来的文件名），Android 交给能打开它的 App；
   * 打开后就返回。
   * Android 上没有能打开它的 App 时抛出 code 为 ERR_NO_VIEWER 的错误。
   */
  previewFile(uri: string, mimeType: string, name: string): Promise<void>;
  /** 忘掉不在 keep 里的快捷操作的文件夹（快捷操作已经删掉了）；最后选过的那个不动。 */
  forgetFolders(keep: readonly string[]): void;
}

export default requireOptionalNativeModule<MorphShareModule>('MorphShare');
