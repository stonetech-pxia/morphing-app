import { RunCancelled, RunError, fixCjkRadicals, type ActionImpl, type RunItem } from '@morph/core';
import { searchSharedQuality } from '@morph/tool-image';
import {
  PdfError,
  addPageNumbers,
  canEncodeStandardText,
  fillForm,
  listFormFields,
  imagesToPdf,
  mergeDocuments,
  mergePdfs,
  pageInfo,
  resolvePageRule,
  rotatePages,
  selectPages,
  splitPdf,
  stampImage,
  stampText,
  type DocumentInput,
  type ImageKind,
  type ImagePageOptions,
  type PageRule,
} from '@morph/tool-pdf';

import { formatBytes } from './image';
import { fileItems, freshName, readItem, writeItem, type RunServices } from './helpers';

// PDF 动作的实现：字节处理全部在 packages/tool-pdf（pdf-lib），这里只负责读写临时文件。

type Impl = ActionImpl<RunServices>;
type Ctx = Parameters<Impl>[2];

const MB = 1024 * 1024;
const fileName = (item: RunItem) => `${item.name}.${item.ext}`;

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

/** 输出一个 PDF 临时文件。 */
export async function writePdf(ctx: Ctx, bytes: Uint8Array, name: string): Promise<RunItem> {
  const pages = await pageInfo(bytes);
  return writeItem(ctx.services, bytes, {
    name,
    ext: 'pdf',
    mimeType: 'application/pdf',
    pageCount: pages.length,
  });
}

/** 对每个 PDF 做同一件事。 */
async function eachPdf(
  input: Parameters<Impl>[0],
  ctx: Ctx,
  fn: (bytes: Uint8Array, item: RunItem) => Promise<Uint8Array>,
) {
  const items = fileItems(input);
  const out: RunItem[] = [];
  for (const [i, item] of items.entries()) {
    ctx.throwIfCancelled();
    const bytes = await readItem(ctx.services, item);
    out.push(await writePdf(ctx, await guard(fileName(item), () => fn(bytes, item)), item.name));
    ctx.progress(i + 1, items.length);
  }
  return { type: 'pdf' as const, items: out };
}

function ruleOf(params: Record<string, unknown>): PageRule {
  return params.rule === 'range' ? { range: String(params.range) } : (params.rule as PageRule);
}

/** 图片的 JPEG / PNG 字节：pdf-lib 只能嵌入这两种；HEIC、WebP 和很大的 PNG 先转成 JPEG。 */
async function imageBytes(
  ctx: Ctx,
  item: RunItem,
  quality = 0.9,
  scale = 1,
): Promise<{ bytes: Uint8Array; kind: ImageKind; width?: number; height?: number }> {
  const big = (item.width ?? 0) * (item.height ?? 0) > 4_000_000;
  if (scale === 1 && quality >= 0.9) {
    if (item.mimeType === 'image/jpeg')
      return { bytes: await readItem(ctx.services, item), kind: 'jpeg' };
    if (item.mimeType === 'image/png' && !big) {
      return { bytes: await readItem(ctx.services, item), kind: 'png' };
    }
  }
  const { files, runId } = ctx.services;
  const size =
    item.width && item.height
      ? { width: item.width, height: item.height }
      : await files.imageSize(item.uri);
  const resize =
    scale < 1
      ? {
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
        }
      : undefined;
  let out;
  try {
    out = await files.transformImage(
      item.uri,
      resize ? { resize } : {},
      { format: 'jpeg', quality },
      runId,
      freshName(item.name, 'jpg'),
    );
  } catch {
    throw new RunError('unreadable', { name: fileName(item) });
  }
  return {
    bytes: await files.readUri(out.uri),
    kind: 'jpeg',
    width: out.width,
    height: out.height,
  };
}

const isImage = (item: RunItem) => item.mimeType.startsWith('image/');

/** 页面上的位置 → stampImage 用的左上角比例坐标。 */
function stampBox(
  position: string,
  page: { width: number; height: number },
  box: { width: number; height: number },
) {
  const margin = 36;
  const x = position.endsWith('Left')
    ? margin
    : position.endsWith('Right')
      ? page.width - margin - box.width
      : (page.width - box.width) / 2;
  const y = position.startsWith('top')
    ? margin
    : position.startsWith('bottom')
      ? page.height - margin - box.height
      : (page.height - box.height) / 2;
  return {
    x: Math.max(0, x / page.width),
    y: Math.max(0, y / page.height),
    width: box.width / page.width,
  };
}

const today = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 用 PDF 预览包把页面渲染成 JPEG（App 里的 WebView + pdf.js）。返回本次运行的临时图片。 */
export async function renderPages(
  ctx: Ctx,
  item: RunItem,
  opts: { maxSide: number; quality: number; pages?: number[] },
): Promise<RunItem[]> {
  const packs = ctx.services.packs;
  if (!packs) throw new RunError('packFailed', { detail: 'pdfview' });
  let pages: { index: number; width: number; height: number; data: string }[];
  try {
    pages = await packs.runtime.call(
      'pdfview',
      'render',
      { file: 'input', ...opts },
      { input: item.uri },
    );
  } catch (e) {
    throw new RunError('unreadable', { name: fileName(item), detail: String(e) });
  }
  const out: RunItem[] = [];
  for (const page of pages) {
    const bytes = Uint8Array.from(atob(page.data), (c) => c.charCodeAt(0));
    out.push(
      await writeItem(ctx.services, bytes, {
        name: `${item.name}-${page.index + 1}`,
        ext: 'jpg',
        mimeType: 'image/jpeg',
        width: page.width,
        height: page.height,
      }),
    );
  }
  return out;
}

export const PDF_IMPLS: Record<string, Impl> = {
  async 'pdf.merge'(input, params, ctx) {
    const items = fileItems(input);
    const allPdf = items.every((i) => !isImage(i));
    const inputs: DocumentInput[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      if (isImage(item)) {
        const image = await imageBytes(ctx, item);
        inputs.push({ name: fileName(item), ...image });
      } else {
        inputs.push({
          name: fileName(item),
          bytes: await readItem(ctx.services, item),
          kind: 'pdf' as const,
        });
      }
      ctx.progress(i + 1, items.length);
    }
    const pageOpts: ImagePageOptions = {
      pageSize: (params.imagePage as ImagePageOptions['pageSize'] | undefined) ?? 'a4',
      orientation: 'auto',
      marginMm: 0,
      fit: 'contain',
    };
    const result = await guard('', () =>
      // 只有 PDF 时沿用原来的合并（至少 2 个）。
      allPdf ? mergePdfs(inputs) : mergeDocuments(inputs, pageOpts),
    );
    return { type: 'pdf', items: [await writePdf(ctx, result.bytes, items[0]!.name)] };
  },

  async 'pdf.fromImages'(input, params, ctx) {
    const items = fileItems(input);
    const { maxMB, ...page } = params as unknown as ImagePageOptions & { maxMB: number };
    let images: Awaited<ReturnType<typeof imageBytes>>[] = [];
    if (maxMB > 0) {
      // 「PDF ≤ X MB」：所有图片共用一个质量和缩放，生成前按总大小搜索（D-073）。
      const target = maxMB * MB;
      const result = await searchSharedQuality({
        targetBytes: target,
        overheadBytes: 2048 + items.length * 1024,
        maxQuality: 0.9,
        encodeAll: async (quality, scale) => {
          ctx.throwIfCancelled();
          images = [];
          for (const item of items) images.push(await imageBytes(ctx, item, quality, scale));
          return images.reduce((sum, i) => sum + i.bytes.length, 0);
        },
      });
      if (!result.met) {
        throw new RunError('targetNotMet', {
          name: 'PDF',
          target: formatBytes(target),
          got: formatBytes(result.bytes),
        });
      }
    } else {
      for (const [i, item] of items.entries()) {
        ctx.throwIfCancelled();
        images.push(await imageBytes(ctx, item));
        ctx.progress(i + 1, items.length);
      }
    }
    const result = await guard('', () => imagesToPdf(images, page));
    return { type: 'pdf', items: [await writePdf(ctx, result.bytes, items[0]!.name)] };
  },

  async 'pdf.pages'(input, _params, ctx) {
    return eachPdf(input, ctx, async (bytes, item) => {
      const pages = await pageInfo(bytes);
      // 装了 PDF 预览包就显示缩略图；没装也能按页码整理（不会为此弹出下载）。
      let thumbnails: string[] | undefined;
      if (ctx.services.packs && (await ctx.services.packs.isInstalled('pdfview'))) {
        try {
          thumbnails = (await renderPages(ctx, item, { maxSide: 240, quality: 0.7 })).map(
            (p) => p.uri,
          );
        } catch {
          thumbnails = undefined;
        }
      }
      const chosen = await ctx.services.ui.open('pages', {
        item,
        pages,
        ...(thumbnails ? { thumbnails } : {}),
      });
      if (!chosen) throw new RunCancelled();
      let out = bytes;
      for (const angle of [90, 180, 270] as const) {
        const indices = chosen.filter((p) => p.rotate === angle).map((p) => p.index);
        if (indices.length) out = await rotatePages(out, angle, indices);
      }
      return selectPages(
        out,
        chosen.map((p) => p.index),
      );
    });
  },

  async 'pdf.selectPages'(input, params, ctx) {
    return eachPdf(input, ctx, async (bytes) => {
      const count = (await pageInfo(bytes)).length;
      return selectPages(bytes, resolvePageRule(ruleOf(params), count));
    });
  },

  async 'pdf.rotate'(input, params, ctx) {
    return eachPdf(input, ctx, async (bytes) => {
      const count = (await pageInfo(bytes)).length;
      return rotatePages(
        bytes,
        params.angle as 90 | 180 | 270,
        resolvePageRule(ruleOf(params), count),
      );
    });
  },

  async 'pdf.split'(input, params, ctx) {
    const out: RunItem[] = [];
    for (const item of fileItems(input)) {
      ctx.throwIfCancelled();
      const bytes = await readItem(ctx.services, item);
      const parts = await guard(fileName(item), async () => {
        if (params.mode === 'every') return splitPdf(bytes, { kind: 'every', n: Number(params.n) });
        const count = (await pageInfo(bytes)).length;
        const ranges = String(params.ranges)
          .split(/[;；]/)
          .map((r) => r.trim())
          .filter(Boolean)
          .map((range) => resolvePageRule({ range }, count));
        return splitPdf(bytes, { kind: 'ranges', ranges });
      });
      for (const [i, part] of parts.entries()) {
        out.push(await writePdf(ctx, part, `${item.name}-${i + 1}`));
        ctx.progress(i + 1, parts.length);
      }
    }
    return { type: 'pdf', items: out };
  },

  async 'pdf.pageNumbers'(input, params, ctx) {
    const { position, format, startAt, fontSize, skipFirst } = params as {
      position: 'bottomCenter';
      format: 'n';
      startAt: number;
      fontSize: number;
      skipFirst: boolean;
    };
    return eachPdf(input, ctx, async (bytes) => {
      const count = (await pageInfo(bytes)).length;
      const pages = skipFirst ? Array.from({ length: count - 1 }, (_, i) => i + 1) : undefined;
      if (pages && pages.length === 0) return bytes;
      return addPageNumbers(bytes, {
        position,
        format,
        startAt,
        fontSize,
        marginPt: 24,
        ...(pages ? { pages } : {}),
      });
    });
  },

  async 'pdf.toImages'(input, params, ctx) {
    const out: RunItem[] = [];
    for (const item of fileItems(input)) {
      ctx.throwIfCancelled();
      out.push(
        ...(await renderPages(ctx, item, { maxSide: Number(params.maxSide), quality: 0.88 })),
      );
    }
    return { type: 'images', items: out };
  },

  async 'pdf.extractText'(input, _params, ctx) {
    const [item] = fileItems(input);
    const packs = ctx.services.packs;
    if (!item || !packs) throw new RunError('packFailed', { detail: 'pdfview' });
    let result: { pages: string[] };
    try {
      result = await packs.runtime.call('pdfview', 'text', { file: 'input' }, { input: item.uri });
    } catch (e) {
      throw new RunError('unreadable', { name: fileName(item), detail: String(e) });
    }
    const text = fixCjkRadicals(result.pages.join('\n\n')).trim();
    // 扫描件没有文字层。
    if (!text) throw new RunError('notFound', { name: fileName(item) });
    // 文字只留在本机，绝不发给 AI（D-036）。
    return { type: 'text', text, name: item.name };
  },

  async 'pdf.sign'(input, _params, ctx) {
    return eachPdf(input, ctx, async (bytes, item) => {
      const previews = await renderPages(ctx, item, { maxSide: 1000, quality: 0.8 });
      const placed = await ctx.services.ui.open('sign', {
        item,
        pages: previews.map((p) => ({ uri: p.uri, width: p.width!, height: p.height! })),
      });
      if (!placed) throw new RunCancelled();
      return stampImage(bytes, {
        image: { bytes: placed.png, kind: 'png' },
        pageIndex: placed.pageIndex,
        x: placed.x,
        y: placed.y,
        width: placed.width,
      });
    });
  },

  async 'pdf.fillForm'(input, params, ctx) {
    return eachPdf(input, ctx, async (bytes, item) => {
      const fields = await listFormFields(bytes);
      if (fields.filter((f) => !f.readOnly && f.type !== 'other').length === 0) {
        // 签回表格：有的 PDF 只需要签名，没有表单就原样交给下一步。
        if (params.whenNoFields === 'skip') return bytes;
        throw new RunError('noFormFields', { name: fileName(item) });
      }
      const values = await ctx.services.ui.open('fillForm', { item, fields });
      if (!values) throw new RunCancelled();
      return fillForm(bytes, values, { flatten: Boolean(params.flatten) });
    });
  },

  async 'pdf.stamp'(input, params, ctx) {
    const { position, fontSize, color, opacity, angle } = params as {
      position: 'center';
      fontSize: number;
      color: string;
      opacity: number;
      angle: 0 | 45;
    };
    const text = String(params.text).replace(/\{date\}/g, today(ctx.now()));
    return eachPdf(input, ctx, async (bytes) => {
      const info = await pageInfo(bytes);
      const pages = resolvePageRule(ruleOf(params), info.length);
      if (canEncodeStandardText(text)) {
        return stampText(bytes, {
          text,
          position,
          fontSize,
          color,
          opacity: opacity / 100,
          ...(angle ? { rotateDeg: angle } : {}),
          pages,
        });
      }
      // 标准字体写不了中文和 emoji：用系统字体画成图片再盖上去（D-073）。
      const scale = 3;
      const image = await ctx.services.files.renderText(text, {
        fontSize: fontSize * scale,
        color,
        opacity: opacity / 100,
      });
      let out = bytes;
      for (const index of pages) {
        const page = info[index]!;
        const box = stampBox(position, page, {
          width: image.width / scale,
          height: image.height / scale,
        });
        out = await stampImage(out, {
          image: { bytes: image.bytes, kind: 'png' },
          pageIndex: index,
          ...box,
        });
      }
      return out;
    });
  },
};
