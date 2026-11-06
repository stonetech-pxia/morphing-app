import { RunError, type ActionImpl, type RunItem } from '@morph/core';
import { leafBlocks, parseDocDoc } from '@morph/tool-office';
import { countPages } from '@morph/tool-pdf';

import { jpegDataUrl, wordPageHtml } from '../../desk/word-page';
import { displayName, fileItems, freshName, type RunServices } from './helpers';

// 文档转 PDF（D-186）：排版交给平台（iOS 系统的文档预览，Android 用 mammoth 转 Word），这里检查格式、
// 报进度、把结果交给下一步。转 Word 做出来的、带着中间格式的 docx（D-466）按编辑页的版面打印：和编辑页看到的一样
// （原图的位置、空白、字号、对齐），不受平台排版的影响（Android 的 mammoth 不认对齐、缩进和字号）。

/** 按中间格式打印一份 docx；中间格式读不出来时返回 null（交给平台排版）。 */
async function docDocToPdf(
  services: RunServices,
  item: RunItem,
  page: { width: number; height: number },
  relPath: string,
): Promise<{ uri: string; size: number; pageCount: number } | null> {
  const { files, runId } = services;
  if (!item.docDoc || item.docDoc.for !== item.uri) return null;
  const doc = parseDocDoc(new TextDecoder().decode(await files.readUri(item.docDoc.uri)));
  if (!doc) return null;
  const images: Record<string, string> = {};
  for (const block of doc.pages.flatMap((p) => leafBlocks(p))) {
    if (block.kind !== 'image' || !block.src || images[block.src]) continue;
    try {
      images[block.src] = jpegDataUrl(await files.readUri(block.src));
    } catch {
      // 读不到的图片空着（和编辑页一样画成灰块）。
    }
  }
  const html = wordPageHtml(doc, page.width, images, true);
  const pdf = await files.htmlToPdf(html, page, runId, relPath, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
  // Android 的 expo-print 报的页数总是 1：从 PDF 本身数。
  return { ...pdf, pageCount: await countPages(await files.readUri(pdf.uri)) };
}

type Impl = ActionImpl<RunServices>;

/** 纸张大小（点）。 */
const PAGES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

export const DOCUMENT_IMPLS: Record<string, Impl> = {
  async 'pdf.fromDocument'(input, params, ctx) {
    const { pageSize } = params as { pageSize: keyof typeof PAGES };
    const { documents } = ctx.services.files;
    const { runId } = ctx.services;
    const items = fileItems(input);
    // 先全部检查一遍格式，免得转了几个才发现后面的不行。
    for (const item of items) {
      if (!documents.extensions.includes(item.ext.toLowerCase())) {
        throw new RunError('documentUnsupported', {
          name: displayName(item),
          format: item.ext.toUpperCase(),
        });
      }
    }
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      ctx.progress(i, items.length);
      let pdf;
      try {
        pdf =
          (await docDocToPdf(ctx.services, item, PAGES[pageSize], freshName(item.name, 'pdf'))) ??
          (await documents.toPdf(
            item.uri,
            item.ext.toLowerCase(),
            PAGES[pageSize],
            runId,
            freshName(item.name, 'pdf'),
          ));
      } catch (e) {
        if (e instanceof RunError) throw e;
        throw new RunError('unreadable', { name: displayName(item) });
      }
      out.push({
        uri: pdf.uri,
        name: item.name,
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: pdf.size,
        pageCount: pdf.pageCount,
      });
    }
    ctx.progress(items.length, items.length);
    return { type: 'pdf', items: out };
  },
};
