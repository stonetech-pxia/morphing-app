import { t, RunCancelled, RunError, type ActionImpl, type RunItem } from '@morph/core';

import { searchSharedQuality } from '@morph/tool-image';
import {
  openForCompression,
  pageInfo,
  picturePagesPdf,
  type PdfReplacement,
} from '@morph/tool-pdf';

import { formatBytes } from './image';
import { MB, fileItems, freshName, readItem, type RunServices } from './helpers';
import { guard, renderPages, writePdf } from './pdf';

// 压缩 PDF（D-145）：先只重新压缩里面的图片（文字、链接、表格都保留）；压不到目标时按 whenTooBig：
// 问用户（「转成图片 / 就用现在的」）、把每页转成图片（要用 PDF 预览下载内容），或保留文字。
// 图片的缩小和编码用系统编码器（expo-image-manipulator），所有图片共用一个质量和缩放（D-073）。

type Impl = ActionImpl<RunServices>;
type Ctx = Parameters<Impl>[2];

/** 图片的长边先限制在这里：手机拍的扫描件常有 4000 像素，屏幕上看和打印都用不着。 */
const MAX_PICTURE_SIDE = 2400;
/** 转成图片时每页渲染的长边。 */
const PAGE_SIDE = 2000;
const MAX_QUALITY = 0.8;
/**
 * 保留文字时图片最多缩到这么小（相对长边 2400，约 960 像素，A4 上约 115 dpi，字还看得清）；
 * 再小就不如停下来问用户要不要转成图片。
 */
const MIN_PICTURE_SCALE = 0.4;
/** 转成图片时每页最多缩到这么小（约 600 像素）。 */
const MIN_PAGE_SCALE = 0.3;

const fileName = (item: RunItem) => `${item.name}.${item.ext}`;

/** 压不到目标时问的一句（文字写在这里，不是 AI 生成的）。 */
function tooBigQuestion(
  locale: import('@morph/core').Locale,
  name: string,
  target: string,
  got: string,
) {
  return {
    title: t(locale, 'pdfCompressionLimit', { name, target }),
    message: t(locale, 'pdfCompressionChoice', { got }),
    options: [t(locale, 'pdfTurnIntoPictures'), t(locale, 'pdfKeepCurrent', { got })],
  };
}

/** 保留文字，只压图片：返回压好的 PDF（可能还是比目标大）。 */
async function recompressPictures(
  ctx: Ctx,
  item: RunItem,
  bytes: Uint8Array,
  target: number,
): Promise<Uint8Array> {
  const { files, runId } = ctx.services;
  const compressor = await guard(fileName(item), () => openForCompression(bytes, fileName(item)));
  if (compressor.pictures.length === 0)
    return guard(fileName(item), () => compressor.build(new Map()));
  // 原图写成临时文件，交给系统编码器。
  const sources: { id: number; uri: string; width: number; height: number; stored: number }[] = [];
  for (const p of compressor.pictures) {
    ctx.throwIfCancelled();
    const source = await guard(fileName(item), async () => p.source());
    const written = await files.writeRunFile(
      runId,
      freshName(`${item.name}-${p.id}`, source.kind === 'jpeg' ? 'jpg' : 'png'),
      source.bytes,
    );
    sources.push({
      id: p.id,
      uri: written.uri,
      width: p.width,
      height: p.height,
      stored: p.storedBytes,
    });
  }
  let chosen = new Map<number, PdfReplacement>();
  await searchSharedQuality({
    targetBytes: target,
    overheadBytes: compressor.otherBytes,
    maxQuality: MAX_QUALITY,
    minScale: MIN_PICTURE_SCALE,
    encodeAll: async (quality, scale) => {
      chosen = new Map();
      let total = 0;
      for (const s of sources) {
        ctx.throwIfCancelled();
        const k = Math.min(1, MAX_PICTURE_SIDE / Math.max(s.width, s.height)) * scale;
        const resize =
          k < 1
            ? {
                width: Math.max(1, Math.round(s.width * k)),
                height: Math.max(1, Math.round(s.height * k)),
              }
            : undefined;
        let out;
        try {
          out = await files.transformImage(
            s.uri,
            resize ? { resize } : {},
            { format: 'jpeg', quality },
            runId,
            freshName(`${item.name}-${s.id}`, 'jpg'),
          );
        } catch {
          // 系统解不开的图片（少见的颜色格式）原样保留。
          total += s.stored;
          continue;
        }
        if (out.size < s.stored) {
          chosen.set(s.id, {
            bytes: await files.readUri(out.uri),
            width: out.width,
            height: out.height,
          });
          total += out.size;
        } else {
          total += s.stored;
        }
      }
      return total;
    },
  });
  // 搜索的最后一次编码就是选中的参数（size-search 保证）。
  return guard(fileName(item), () => compressor.build(chosen));
}

/** 每页渲染成图片，按原来的纸张大小重新排成 PDF，压到目标以内。 */
async function picturePages(
  ctx: Ctx,
  item: RunItem,
  bytes: Uint8Array,
  target: number,
): Promise<Uint8Array> {
  const { files, runId } = ctx.services;
  if (!(await ctx.services.ensurePack?.('pdfview'))) throw new RunCancelled();
  const sizes = await guard(fileName(item), () => pageInfo(bytes));
  const rendered = await renderPages(ctx, item, { maxSide: PAGE_SIDE, quality: 0.9 });
  let jpegs: Uint8Array[] = [];
  const result = await searchSharedQuality({
    targetBytes: target,
    overheadBytes: 2048 + rendered.length * 1024,
    maxQuality: MAX_QUALITY,
    minScale: MIN_PAGE_SCALE,
    encodeAll: async (quality, scale) => {
      jpegs = [];
      let total = 0;
      for (const page of rendered) {
        ctx.throwIfCancelled();
        const w = page.width ?? PAGE_SIDE;
        const h = page.height ?? PAGE_SIDE;
        const out = await files.transformImage(
          page.uri,
          scale < 1
            ? {
                resize: {
                  width: Math.max(1, Math.round(w * scale)),
                  height: Math.max(1, Math.round(h * scale)),
                },
              }
            : {},
          { format: 'jpeg', quality },
          runId,
          freshName(page.name, 'jpg'),
        );
        jpegs.push(await files.readUri(out.uri));
        total += out.size;
      }
      return total;
    },
  });
  const pdf = await guard(fileName(item), () =>
    picturePagesPdf(
      jpegs.map((jpeg, i) => ({
        jpeg,
        width: sizes[i]?.width ?? 595,
        height: sizes[i]?.height ?? 842,
      })),
    ),
  );
  if (!result.met && pdf.bytes.length > target) {
    throw new RunError('targetNotMet', {
      name: fileName(item),
      target: formatBytes(target, ctx.locale),
      got: formatBytes(pdf.bytes.length, ctx.locale),
    });
  }
  return pdf.bytes;
}

export const PDF_COMPRESS_IMPLS: Record<string, Impl> = {
  async 'pdf.compress'(input, params, ctx) {
    const { maxMB, whenTooBig } = params as {
      maxMB: number;
      whenTooBig: 'ask' | 'images' | 'keepText';
    };
    const target = maxMB * MB;
    const items = fileItems(input);
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      ctx.progress(i, items.length);
      // 本来就够小：原样交给下一步。
      if (item.size <= target) {
        out.push(item);
        continue;
      }
      const bytes = await readItem(ctx.services, item);
      let best = await recompressPictures(ctx, item, bytes, target);
      if (best.length > bytes.length) best = bytes;
      if (best.length > target) {
        let choice = whenTooBig;
        if (choice === 'ask') {
          const q = tooBigQuestion(
            ctx.locale,
            fileName(item),
            formatBytes(target, ctx.locale),
            formatBytes(best.length, ctx.locale),
          );
          const answer = await ctx.services.ui.choose(q.title, q.message, q.options);
          if (answer === null) throw new RunCancelled();
          choice = answer === 0 ? 'images' : 'keepText';
        }
        if (choice === 'images') best = await picturePages(ctx, item, bytes, target);
      }
      out.push(best === bytes ? item : await writePdf(ctx, best, item.name));
    }
    ctx.progress(items.length, items.length);
    return { type: 'pdf', items: out };
  },
};
