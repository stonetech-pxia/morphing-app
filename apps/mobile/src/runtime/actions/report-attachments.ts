import {
  REPORT_ATTACHMENT_LIMITS as LIMITS,
  RunCancelled,
  reportAttachmentNotes,
  reportAttachments,
  reportAttachmentsToHtml,
  type ActionImpl,
  type Collection,
  type DataRecord,
  type LinkResolver,
  type PageSize,
  type ReportAttachment,
  type ReportAttachmentPage,
  type RunItem,
} from '@morph/core';
import { countPages, mergePdfs } from '@morph/tool-pdf';

import { freshName, mimeOf, writeItem, type RunServices } from './helpers';

// 报表带附件（D-425）：print.records 打开 attachments 时，每条记录的照片和 PDF 按记录顺序接在报表后面。
// 照片解码时就缩小，每几张排一次版（一份 HTML 不会太大）；PDF 的页面用 tool-pdf 合并，前面一页写明是哪条记录的。
// 少一个附件不会让整份报表失败：跳过，并印在报表上。原件只读，不移动、不删除（底线 4）。
// 中间文件属于这次运行，用完就删，成功和失败都一样。

type Ctx = Parameters<ActionImpl<RunServices>>[2];

/** 按顺序接在报表后面的一份 PDF：temp 是这次运行自己的，用户的 PDF 附件不是。 */
interface Segment {
  uri: string;
  name: string;
  temp: boolean;
}

export interface CollectedAttachments {
  segments: Segment[];
  overLimit: string[];
  unreadable: string[];
  /** 全部附件的图注（合并失败时报表上要写都没放进来）。 */
  titles: string[];
  locale: Ctx['locale'];
  cleanup(): Promise<void>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function collectAttachments(
  ctx: Ctx,
  collection: Collection,
  records: readonly DataRecord[],
  opts: { fields: readonly string[]; pageSize: PageSize; links: LinkResolver | undefined },
  print: (html: string, name: string) => Promise<RunItem>,
): Promise<CollectedAttachments> {
  const { files, repo, runId, calendar } = ctx.services;
  const list = reportAttachments(collection, records, {
    fields: opts.fields,
    locale: ctx.locale,
    now: ctx.now(),
    ...(calendar ? { cal: calendar } : {}),
    ...(opts.links ? { links: opts.links } : {}),
  });
  const temps = new Set<string>();
  const removeTemp = async (uri: string) => {
    temps.delete(uri);
    await files.removeRunFile(uri).catch(() => undefined);
  };
  const collected: CollectedAttachments = {
    segments: [],
    overLimit: [],
    unreadable: [],
    titles: list.map((a) => a.title),
    locale: ctx.locale,
    cleanup: async () => {
      for (const uri of [...temps]) await removeTemp(uri);
    },
  };
  const { segments, overLimit, unreadable } = collected;

  let batch: ReportAttachmentPage[] = [];
  let batchBytes = 0;
  /** 把攒着的这几页排成一份 PDF；排不出来时这几个附件算读不了，不影响别的。 */
  const flush = async (): Promise<boolean> => {
    if (batch.length === 0) return true;
    const pages = batch;
    batch = [];
    batchBytes = 0;
    try {
      const pdf = await print(
        reportAttachmentsToHtml(pages, { pageSize: opts.pageSize, locale: ctx.locale }),
        'attachments',
      );
      temps.add(pdf.uri);
      segments.push({ uri: pdf.uri, name: 'attachments.pdf', temp: true });
      return true;
    } catch {
      unreadable.push(...pages.map((p) => p.attachment.title));
      return false;
    }
  };

  const addImage = async (a: ReportAttachment, uri: string, room: number): Promise<number> => {
    const jpg = await files.reducedJpeg(
      uri,
      LIMITS.maxSide,
      LIMITS.quality,
      runId,
      freshName('attachment', 'jpg'),
    );
    temps.add(jpg.uri);
    try {
      if (jpg.size > room) {
        overLimit.push(a.title);
        return 0;
      }
      batch.push({ attachment: a, jpegBase64: toBase64(await files.readUri(jpg.uri)) });
      batchBytes += jpg.size;
      if (batch.length >= LIMITS.batchImages || batchBytes >= LIMITS.batchBytes) await flush();
      return jpg.size;
    } finally {
      await removeTemp(jpg.uri);
    }
  };

  const addPdf = async (a: ReportAttachment, uri: string, size: number): Promise<number> => {
    // 带密码或坏掉的 PDF 在这里就读不了，算在跳过的里面。
    const pdfPages = await countPages(await files.readUri(uri));
    batch.push({ attachment: a, pdfPages });
    if (!(await flush())) return 0;
    segments.push({ uri, name: 'attachment.pdf', temp: false });
    return size;
  };

  let accepted = 0;
  let bytes = 0;
  try {
    for (const [i, a] of list.entries()) {
      ctx.throwIfCancelled();
      if (accepted >= LIMITS.maxCount) {
        overLimit.push(a.title);
        continue;
      }
      try {
        const asset = await repo.getAsset(a.assetId);
        if (!asset) throw new Error('missing');
        const mime = mimeOf(asset.name, asset.mimeType).toLowerCase();
        const uri = files.fileUri(asset.path);
        const room = LIMITS.maxBytes - bytes;
        let added: number;
        if (mime === 'application/pdf') {
          if (asset.size > room) {
            overLimit.push(a.title);
            continue;
          }
          added = await addPdf(a, uri, asset.size);
        } else if (mime.startsWith('image/')) added = await addImage(a, uri, room);
        else throw new Error('not an image or a PDF');
        if (added > 0) {
          accepted++;
          bytes += added;
        }
      } catch (e) {
        if (e instanceof RunCancelled) throw e;
        unreadable.push(a.title);
      }
      ctx.progress(i + 1, list.length);
    }
    ctx.throwIfCancelled();
    await flush();
  } catch (e) {
    // 取消也是失败的一种：不等运行结束，先删掉这一步的中间文件。
    await collected.cleanup();
    throw e;
  }
  return collected;
}

/** 印报表，再把附件接在后面。合并失败时只留报表，并写明附件都没放进来。 */
export async function mergeReport(
  ctx: Ctx,
  collected: CollectedAttachments,
  report: (notes: readonly string[]) => Promise<RunItem>,
  name: string,
): Promise<RunItem> {
  const { files } = ctx.services;
  const { locale, overLimit, unreadable, segments, titles } = collected;
  const first = await report(reportAttachmentNotes({ overLimit, unreadable }, locale));
  if (segments.length === 0) return first;
  try {
    const inputs = [{ uri: first.uri, name: 'report.pdf' }, ...segments];
    const parts = [];
    for (const part of inputs) {
      ctx.throwIfCancelled();
      parts.push({ name: part.name, bytes: await files.readUri(part.uri) });
    }
    const merged = await mergePdfs(parts);
    const item = await writeItem(ctx.services, merged.bytes, {
      name,
      ext: 'pdf',
      mimeType: 'application/pdf',
      pageCount: merged.pageCount,
    });
    await files.removeRunFile(first.uri).catch(() => undefined);
    return item;
  } catch (e) {
    if (e instanceof RunCancelled) throw e;
    await files.removeRunFile(first.uri).catch(() => undefined);
    return report(reportAttachmentNotes({ overLimit: [], unreadable: titles }, locale));
  }
}
