import {
  PAGE_POINTS,
  RunError,
  localDate,
  periodRange,
  recordsToHtml,
  sortRecords,
  textToHtml,
  type ActionImpl,
  type PageSize,
  type Period,
  type RecordTemplate,
  type RunItem,
  type RunValue,
} from '@morph/core';
import { ArchiveError, createZip, extractZip, mimeTypeOfName } from '@morph/tool-archive';
import {
  QrError,
  decodeQr,
  downscaleRgba,
  encodePng,
  qrMatrix,
  qrToRgba,
  MAX_TEXT_LENGTH,
} from '@morph/tool-qr';

import {
  baseName,
  displayName,
  extOf,
  fileItems,
  freshName,
  readItem,
  writeItem,
  type RunServices,
} from './helpers';

// T6 的其他动作：输入文字、读取记录、ZIP、二维码、文字转 PDF、用记录生成 PDF。
// 文字和记录只在本机处理（D-036、D-042）。

type Impl = ActionImpl<RunServices>;

const textOf = (input: RunValue | null) => {
  if (!input || input.type !== 'text') throw new RunError('unexpected', { detail: 'no text' });
  return input;
};

export const MORE_IMPLS: Record<string, Impl> = {
  async 'in.text'(_input, params, ctx) {
    const text = String(params.text ?? '').trim();
    if (!text) throw new RunError('emptyText');
    return {
      type: 'text',
      text,
      name: ctx.locale === 'zh' ? '文字' : 'Text',
    };
  },

  async 'in.records'(_input, params, ctx) {
    const collection = ctx.services.collections.find((c) => c.id === params.collectionId);
    if (!collection) throw new RunError('notFound', { name: String(params.collectionId) });
    const period = params.period as 'all' | Period;
    let records = await ctx.services.repo.listRecords(collection.id);
    if (period !== 'all') {
      const [start, end] = periodRange(period, ctx.now());
      // 按表里第一个日期字段；没有日期字段就按创建时间。
      const dateField = collection.fields.find((f) => f.type === 'date');
      records = records.filter((r) => {
        const raw = dateField ? r.values[dateField.id] : localDate(new Date(r.createdAt));
        return typeof raw === 'string' && raw >= start && raw <= end;
      });
    }
    if (records.length === 0) throw new RunError('noRecords', { name: collection.name });
    const dateField = collection.fields.find((f) => f.type === 'date');
    const sorted = sortRecords(records, collection, {
      field: dateField?.id ?? 'createdAt',
      direction: 'asc',
    });
    return { type: 'records', collectionId: collection.id, records: sorted, name: collection.name };
  },

  async 'print.records'(input, params, ctx) {
    if (!input || input.type !== 'records') {
      throw new RunError('unexpected', { detail: 'no records' });
    }
    const collection = ctx.services.collections.find((c) => c.id === input.collectionId);
    if (!collection) throw new RunError('notFound', { name: input.name });
    const pageSize = params.pageSize as PageSize;
    const html = recordsToHtml(collection, input.records, {
      template: params.template as RecordTemplate,
      title: String(params.title ?? ''),
      fields: (params.fields as string[] | undefined) ?? [],
      pageSize,
      locale: ctx.locale,
      now: ctx.now(),
    });
    const name = String(params.title || '').trim() || collection.name;
    return { type: 'pdf', items: [await printHtml(ctx.services, html, pageSize, name)] };
  },

  async 'text.toPdf'(input, params, ctx) {
    const value = textOf(input);
    const pageSize = params.pageSize as PageSize;
    const html = textToHtml(value.text, { fontSize: Number(params.fontSize), pageSize });
    return { type: 'pdf', items: [await printHtml(ctx.services, html, pageSize, value.name)] };
  },

  async 'text.toFile'(input, _params, ctx) {
    const value = textOf(input);
    const bytes = new TextEncoder().encode(value.text);
    const item = await writeItem(ctx.services, bytes, {
      name: value.name,
      ext: 'txt',
      mimeType: 'text/plain',
    });
    return { type: 'files', items: [item] };
  },

  async 'text.copy'(input, _params, ctx) {
    const value = textOf(input);
    await ctx.services.files.copyText(value.text);
    return value;
  },

  async 'zip.create'(input, _params, ctx) {
    const items = fileItems(input);
    const entries = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      entries.push({ name: displayName(item), bytes: await readItem(ctx.services, item) });
      ctx.progress(i + 1, items.length);
    }
    let bytes: Uint8Array;
    try {
      bytes = createZip(entries);
    } catch (e) {
      throw archiveError(e, items[0]!);
    }
    const zip = await writeItem(ctx.services, bytes, {
      name: items[0]!.name,
      ext: 'zip',
      mimeType: 'application/zip',
    });
    return { type: 'zip', items: [zip] };
  },

  async 'zip.extract'(input, _params, ctx) {
    const out: RunItem[] = [];
    for (const item of fileItems(input)) {
      ctx.throwIfCancelled();
      let entries;
      try {
        entries = extractZip(await readItem(ctx.services, item));
      } catch (e) {
        throw archiveError(e, item);
      }
      for (const [i, entry] of entries.entries()) {
        // 压缩包里的目录层级去掉，只留文件名（tool-archive 已经去掉了 ../ 之类的路径）。
        const fileName = entry.name.split('/').pop()!;
        out.push(
          await writeItem(ctx.services, entry.bytes, {
            name: baseName(fileName),
            ext: extOf(fileName) || 'bin',
            mimeType: entry.mimeType || mimeTypeOfName(fileName),
          }),
        );
        ctx.progress(i + 1, entries.length);
      }
    }
    return { type: 'files', items: out };
  },

  async 'qr.generate'(input, params, ctx) {
    const value = textOf(input);
    let matrix;
    try {
      matrix = qrMatrix(value.text, { ecc: params.ecc as 'M' });
    } catch (e) {
      if (e instanceof QrError && e.code === 'tooLong') {
        throw new RunError('textTooLong', { max: MAX_TEXT_LENGTH });
      }
      throw new RunError('emptyText');
    }
    // 每个模块整数个像素，留白 4 个模块，尽量接近要求的大小。
    const scale = Math.max(1, Math.floor(Number(params.sizePx) / (matrix.size + 8)));
    const png = encodePng(qrToRgba(matrix, { scale }));
    const width = (matrix.size + 8) * scale;
    const item = await writeItem(ctx.services, png, {
      name: ctx.locale === 'zh' ? '二维码' : 'QR code',
      ext: 'png',
      mimeType: 'image/png',
      width,
      height: width,
    });
    return { type: 'images', items: [item] };
  },

  async 'qr.read'(input, _params, ctx) {
    const items = fileItems(input);
    const found: string[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      let pixels;
      try {
        pixels = await ctx.services.files.imagePixels(item.uri, 1600);
      } catch {
        throw new RunError('unreadable', { name: displayName(item) });
      }
      const text = decodeQr(downscaleRgba(pixels, 1600));
      if (text) found.push(text);
      ctx.progress(i + 1, items.length);
    }
    if (found.length === 0) throw new RunError('notFound', { name: displayName(items[0]!) });
    return { type: 'text', text: found.join('\n\n'), name: items[0]!.name };
  },
};

/** 用系统打印排版把 HTML 变成 PDF。 */
async function printHtml(
  services: RunServices,
  html: string,
  pageSize: PageSize,
  name: string,
): Promise<RunItem> {
  let out;
  try {
    out = await services.files.htmlToPdf(
      html,
      PAGE_POINTS[pageSize],
      services.runId,
      freshName(name, 'pdf'),
    );
  } catch (e) {
    throw new RunError('unexpected', { detail: String(e instanceof Error ? e.message : e) });
  }
  return {
    uri: out.uri,
    name,
    ext: 'pdf',
    mimeType: 'application/pdf',
    size: out.size,
    pageCount: out.pageCount,
  };
}

function archiveError(e: unknown, item: RunItem): RunError {
  const name = displayName(item);
  if (!(e instanceof ArchiveError)) return new RunError('unreadable', { name });
  switch (e.code) {
    case 'encrypted':
      return new RunError('encrypted', { name });
    case 'tooLarge':
      return new RunError('tooLargeTotal', { mb: 100 });
    case 'tooManyEntries':
      return new RunError('tooMany', { max: 500 });
    case 'empty':
      return new RunError('notFound', { name });
    default:
      return new RunError('unreadable', { name });
  }
}
