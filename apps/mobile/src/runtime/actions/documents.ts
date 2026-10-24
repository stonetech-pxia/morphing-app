import { RunError, type ActionImpl, type RunItem } from '@morph/core';

import { displayName, fileItems, freshName, type RunServices } from './helpers';

// 文档转 PDF（D-186）：排版交给平台（iOS 系统的文档预览，Android 用 mammoth 转 Word），这里检查格式、
// 报进度、把结果交给下一步。

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
        pdf = await documents.toPdf(
          item.uri,
          item.ext.toLowerCase(),
          PAGES[pageSize],
          runId,
          freshName(item.name, 'pdf'),
        );
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
