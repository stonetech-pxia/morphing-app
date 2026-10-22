import { RunError, type ActionImpl } from '@morph/core';
import { PdfError, mergePdfs } from '@morph/tool-pdf';

import { fileItems, readItem, writeItem, type RunServices } from './helpers';

// PDF 动作的实现：字节处理全部在 packages/tool-pdf（pdf-lib），这里只负责读写临时文件。

type Impl = ActionImpl<RunServices>;

/** tool-pdf 的错误 → 运行错误（带出错的文件名）。 */
export function pdfError(e: unknown): never {
  if (!(e instanceof PdfError)) throw e;
  if (e.code === 'tooFew') throw new RunError('tooFew', { min: 2, kind: 'PDF' });
  throw new RunError(e.code as never, { name: e.fileName ?? '' });
}

export const PDF_IMPLS: Record<string, Impl> = {
  async 'pdf.merge'(input, _params, ctx) {
    const items = fileItems(input);
    const inputs = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      inputs.push({ name: `${item.name}.${item.ext}`, bytes: await readItem(ctx.services, item) });
      ctx.progress(i + 1, items.length);
    }
    try {
      const result = await mergePdfs(inputs);
      const first = items[0]!;
      const merged = await writeItem(ctx.services, result.bytes, {
        name: first.name,
        ext: 'pdf',
        mimeType: 'application/pdf',
        pageCount: result.pageCount,
      });
      return { type: 'pdf', items: [merged] };
    } catch (e) {
      return pdfError(e);
    }
  },
};
