import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphTranslate（D-170）：iOS 是 ios/MorphTranslateModule.swift（Translation 框架，
// iOS 18 起），Android 是 android/…/MorphTranslateModule.kt（ML Kit 翻译 + 语言识别）。
// Expo Go 和测试里是 null。语言用 BCP 47（zh-Hans、en、ja…），各平台在原生代码里换成自己的代码。
// 出错时 error.code：ERR_TRANSLATE_CANCELLED（用户在系统下载弹窗里取消）、ERR_TRANSLATE_UNSUPPORTED、
// ERR_TRANSLATE_DOWNLOAD（下载失败，多半是没有网络）、ERR_TRANSLATE_FAILED。

export interface MorphTranslateModule {
  /** 系统能不能翻译（iOS 18 起；Android 总是 true）。 */
  isSupported(): boolean;
  /** 每段文字的语言（BCP 47）；认不出时为 null。 */
  detectLanguages(texts: readonly string[]): Promise<(string | null)[]>;
  /**
   * installed：模型都在本机；download：要下载（Android 的 missing 是还没下载的语言）；unsupported：不能翻。
   */
  status(
    from: string,
    to: string,
  ): Promise<{ status: 'installed' | 'download' | 'unsupported'; missing?: string[] }>;
  /** 每种语言模型的下载大小（估计，只有 Android）。 */
  downloadBytes?: number;
  /** 下载一种语言的模型（只有 Android）。 */
  download?(language: string): Promise<void>;
  /** 一段对一段；iOS 需要下载时系统会弹窗问用户。 */
  translate(texts: readonly string[], from: string, to: string): Promise<string[]>;
  /** 已下载的语言模型（只有 Android；iOS 的语言由系统「设置 → 翻译」管理）。 */
  downloadedLanguages?(): Promise<string[]>;
  /** 系统能翻译的语言（只有 iOS，排查用）。 */
  supportedLanguages?(): Promise<string[]>;
  /** 删除一种语言的模型（只有 Android；英文不能删）。 */
  deleteLanguage?(code: string): Promise<void>;
}

export default requireOptionalNativeModule<MorphTranslateModule>('MorphTranslate');
