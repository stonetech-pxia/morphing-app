import { PDFDocument } from 'pdf-lib';

// 所有 PDF 函数共用的类型、错误与加载逻辑。

export type PdfErrorCode =
  | 'tooFew'
  | 'encrypted'
  | 'unreadable'
  /** 页码越界、重复或页面规则无法解析。 */
  | 'badRange'
  /** 数值参数越界或格式不对（边距、字号、颜色等）。 */
  | 'badOption'
  /** 图片字节无法按声明的格式嵌入。 */
  | 'badImage'
  /** 标准字体（WinAnsi）无法编码的文字，例如中文。 */
  | 'unsupportedText'
  /** 表单字段不存在，或值与字段类型不匹配。 */
  | 'badField';

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    readonly fileName?: string,
    readonly fieldName?: string,
  ) {
    super([code, fileName, fieldName].filter(Boolean).join(': '));
  }
}

export interface PdfInput {
  name: string;
  bytes: Uint8Array;
}

export interface MergeResult {
  bytes: Uint8Array;
  pageCount: number;
}

/** 加载 PDF；加密或损坏时抛出 PdfError（带上文件名，若有）。 */
// 注意：pdf-lib 的错误类是 ES5 编译产物，`instanceof EncryptedPDFError` 永远为 false，
// 所以改为忽略加密先解析，再看 isEncrypted。
export async function loadPdf(bytes: Uint8Array, name?: string): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new PdfError('unreadable', name);
  }
  if (doc.isEncrypted) throw new PdfError('encrypted', name);
  return doc;
}

/** 数值必须是 [min, max] 内的有限数，否则视为参数错误。 */
export function assertNumber(value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new PdfError('badOption');
}

/** 页码列表不能为空，下标必须是 [0, pageCount) 内的整数，且不重复。 */
export function assertPageIndices(indices: readonly number[], pageCount: number): void {
  if (indices.length < 1) throw new PdfError('badRange');
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= pageCount) throw new PdfError('badRange');
  }
  if (new Set(indices).size !== indices.length) throw new PdfError('badRange');
}

// WinAnsi（pdf-lib 标准字体的编码）= 可打印 ASCII、Latin-1 补充，外加以下 27 个字符。
const WIN_ANSI_EXTRA = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018,
  0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a,
  0x20ac, 0x2122,
]);

/**
 * 文字能否用标准字体（Helvetica 等）绘制。不能时（如中文、emoji、换行符），
 * App 应改用 Skia 把文字渲染成 PNG，再用 stampImage。
 */
export function canEncodeStandardText(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const ok = (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
    if (!ok) return false;
  }
  return true;
}

/** pdf-lib 在标准字体无法编码文字时抛出的普通 Error。 */
export function isEncodingError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('cannot encode');
}
