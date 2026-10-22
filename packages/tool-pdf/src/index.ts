import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

// PDF 工具的真实处理逻辑（M2）。只依赖字节数组，不依赖任何平台 API，
// 因此同一份代码在手机上运行，也能在 Node 中用真实 PDF 测试。

export type PdfErrorCode = 'tooFew' | 'encrypted' | 'unreadable';

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    readonly fileName?: string,
  ) {
    super(fileName ? `${code}: ${fileName}` : code);
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

async function load(input: PdfInput): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(input.bytes);
  } catch (e) {
    throw new PdfError(e instanceof EncryptedPDFError ? 'encrypted' : 'unreadable', input.name);
  }
}

/** 按输入顺序合并 PDF。加密或损坏的文件会以 PdfError 报告具体文件名。 */
export async function mergePdfs(inputs: readonly PdfInput[]): Promise<MergeResult> {
  if (inputs.length < 2) throw new PdfError('tooFew');
  const merged = await PDFDocument.create();
  for (const input of inputs) {
    const doc = await load(input);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return { bytes: await merged.save(), pageCount: merged.getPageCount() };
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  return (await load({ name: 'document', bytes })).getPageCount();
}
