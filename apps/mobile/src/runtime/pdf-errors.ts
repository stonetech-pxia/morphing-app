import { RunCancelled, RunError } from '@morph/core';
import { PdfError } from '@morph/tool-pdf';

// tool-pdf 的错误翻成运行错误。单独一个文件：文档库的合并 PDF（存储）也要用，不该为此依赖整个 PDF 动作模块（R11）。

/** tool-pdf 的错误 → 运行错误（带出错的文件名）。 */
export function pdfError(e: unknown, name = ''): never {
  if (e instanceof RunError || e instanceof RunCancelled) throw e;
  // pdf-lib 读坏文件时会抛各种普通错误：对用户来说都是「无法读取」。
  if (!(e instanceof PdfError)) throw new RunError('unreadable', { name });
  const file = e.fileName ?? name;
  switch (e.code) {
    case 'tooFew':
      throw new RunError('tooFew', { min: 2, kind: 'PDF' });
    case 'encrypted':
    case 'unreadable':
    case 'badRange':
    case 'unsupportedText':
      throw new RunError(e.code, {
        name: e.code === 'unsupportedText' ? (e.fieldName ?? file) : file,
      });
    case 'badField':
      throw new RunError('badField', { name: e.fieldName ?? '' });
    case 'badImage':
      throw new RunError('unreadable', { name: file });
    default:
      throw new RunError('unexpected', { detail: e.code });
  }
}

export async function guard<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    return pdfError(e, name);
  }
}
