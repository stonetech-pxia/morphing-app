import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphDocs（D-186）：iOS 用系统的文档预览（WKWebView 能显示 Word、Excel、PowerPoint、RTF）
// 加打印排版，把办公文档分页画成 PDF。只有 iOS；Android 系统不会显示办公文档，App 在 JS 里用 mammoth
// 把 Word 转成网页再打印（runtime/expo-documents.ts）。Expo Go 和测试里是 null。
// 出错时 error.code：ERR_DOC_UNREADABLE（打不开：损坏、加密、格式不对）、ERR_DOC_FAILED。

export interface MorphDocsModule {
  /** 把 uri 的文档画成 PDF 写到 output；页面大小和边距单位是点（1/72 英寸）。 */
  toPdf(
    uri: string,
    output: string,
    page: { width: number; height: number; margin: number },
  ): Promise<{ uri: string; size: number; pageCount: number }>;
}

export default requireOptionalNativeModule<MorphDocsModule>('MorphDocs');
