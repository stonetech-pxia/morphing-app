import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphDocs（D-186）：iOS 用系统的文档预览（WKWebView 能显示 Word、Excel、PowerPoint、RTF）
// 加打印排版，把办公文档分页画成 PDF。只有 iOS；Android 系统不会显示办公文档，App 在 JS 里用 mammoth
// 把 Word 转成网页再打印（runtime/expo-documents.ts）。Expo Go 和测试里是 null。
// PDF 密码（D-193）也在这里：iOS 的 PDFKit。Android 没有（P-025）。
// 出错时 error.code：ERR_DOC_UNREADABLE（打不开：损坏、加密、格式不对）、ERR_DOC_FAILED。

export interface MorphDocsModule {
  /** none：没有加密；restricted：不用密码能打开但有限制；locked：要密码才能打开。 */
  pdfLockState(uri: string): Promise<'none' | 'restricted' | 'locked'>;
  /** 用密码打开，另存一份没有密码的到 output；密码不对时返回 null。 */
  unlockPdf(
    uri: string,
    password: string,
    output: string,
  ): Promise<{ uri: string; size: number } | null>;
  /** 加上打开密码（同一个密码也是所有者密码），写到 output。 */
  protectPdf(uri: string, password: string, output: string): Promise<{ uri: string; size: number }>;
  /** 把 uri 的文档画成 PDF 写到 output；页面大小和边距单位是点（1/72 英寸）。 */
  toPdf(
    uri: string,
    output: string,
    page: { width: number; height: number; margin: number },
  ): Promise<{ uri: string; size: number; pageCount: number }>;
}

export default requireOptionalNativeModule<MorphDocsModule>('MorphDocs');
