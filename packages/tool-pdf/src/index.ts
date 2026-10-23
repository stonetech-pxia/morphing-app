// PDF 工具的真实处理逻辑。只依赖字节数组，不依赖任何平台 API，
// 因此同一份代码在手机（Hermes）上运行，也能在 Node 中用真实 PDF 测试。

export {
  type MergeResult,
  PdfError,
  type PdfErrorCode,
  type PdfInput,
  canEncodeStandardText,
} from './core';
export {
  type PdfCompressor,
  type PdfPicture,
  type PdfReplacement,
  openForCompression,
  picturePagesPdf,
} from './compress';
export { type FormField, type FormFieldType, fillForm, listFormFields } from './forms';
export { type ImageInput, type ImageKind, type ImagePageOptions, imagesToPdf } from './images';
export { type DocumentInput, countPages, mergeDocuments, mergePdfs } from './merge';
export {
  type PageInfo,
  type PageRule,
  type SplitMode,
  pageInfo,
  resolvePageRule,
  rotatePages,
  selectPages,
  splitPdf,
} from './pages';
export {
  type EdgePosition,
  type PageNumberOptions,
  type StampImageOptions,
  type StampPosition,
  type StampTextOptions,
  addPageNumbers,
  stampImage,
  stampText,
} from './stamp';
