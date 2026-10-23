import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphShare（D-100、D-101）：一次分享多个文件、把文件存进用户在「文件」里选的文件夹。
// iOS 是 ios/MorphShareModule.swift（UIActivityViewController、UIDocumentPickerViewController 选文件夹），
// Android 是 android/…/MorphShareModule.kt（ACTION_SEND_MULTIPLE、存储访问框架）。只用系统框架，不联网。
// Expo Go 和测试里是 null，调用方退回逐个分享 / expo-file-system 选文件夹。

export interface MorphShareModule {
  /** 打开一次系统分享面板，带上全部文件（本机 file:// 地址）；面板关掉后返回。 */
  shareFiles(uris: readonly string[], mimeTypes: readonly string[]): Promise<void>;
  /**
   * 让用户选一个文件夹（iCloud 云盘、Google Drive 等「文件」提供者都可以），把文件复制进去。
   * names 是文件名（含扩展名）；文件夹里已有同名文件时不覆盖（iOS 加「 2」，Android 由文档提供者改名）。
   * 返回存了几个；用户取消时返回 null。
   * 文件夹写不进去时抛出 code 为 ERR_FOLDER_NOT_WRITABLE 的错误。
   */
  exportFiles(
    uris: readonly string[],
    names: readonly string[],
    mimeTypes: readonly string[],
  ): Promise<number | null>;
}

export default requireOptionalNativeModule<MorphShareModule>('MorphShare');
