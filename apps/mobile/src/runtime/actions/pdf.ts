import {
  RunCancelled,
  RunError,
  fixCjkRadicals,
  groupItems,
  t,
  type ActionImpl,
  type GroupRule,
  type Locale,
  type RunItem,
} from '@morph/core';
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
  type ImageInput,
  type ImageKind,
  type ImagePageOptions,
  type PageRule,
} from '@morph/tool-pdf';

import { deviceLanguageTags } from '../../i18n';
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

/** 文件已经打开之后出的错：PDF 自己的问题照常说明，其他的照实报出来（不说成「文件可能已损坏」）。 */
function arrangeError(e: unknown): unknown {
  if (e instanceof PdfError || e instanceof RunError || e instanceof RunCancelled) return e;
  return new RunError('unexpected', { detail: String(e instanceof Error ? e.message : e) });
}

async function arranged(name: string, fn: () => Promise<Uint8Array>): Promise<Uint8Array> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PdfError) return pdfError(e, name);
    throw arrangeError(e);
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
/** 文字层识别用的西欧语言（D-195）。 */
const LATIN_TEXT_LAYER = ['en-US', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-BR'] as const;

/**
 * 文字层识别用的语言（D-266）：手机的语言列表或界面语言里有中文、日文、韩文时先认它（附带英文，
 * 这些识别器也认拉丁字母），写进 PDF 用无字形字体；没有时认西欧语言。第一种必须是系统支持的。
 */
export function textLayerLanguages(
  locale: Locale,
  deviceTags: readonly string[],
): readonly string[] {
  for (const tag of [...deviceTags, ...(locale === 'zh' ? ['zh-Hans'] : [])]) {
    const [lang, ...rest] = tag.split('-');
    const tail = rest.join('-');
    if (lang === 'zh') return [/Hant|TW|HK|MO/.test(tail) ? 'zh-Hant' : 'zh-Hans', 'en-US'];
    if (lang === 'ja') return ['ja-JP', 'en-US'];
    if (lang === 'ko') return ['ko-KR', 'en-US'];
  }
  return LATIN_TEXT_LAYER;
}

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

/** 分组（D-243）：不分组时是一组，名字是第一个文件的名字（和以前一样）。 */
function groupsOf(input: Parameters<Impl>[0], params: Record<string, unknown>, ctx: Ctx) {
  return groupItems(
    fileItems(input),
    params.group as GroupRule | undefined,
    params.groupSize as number | undefined,
    t(ctx.locale, 'groupUndated'),
  );
}

/** 一组 PDF 和图片按顺序合成一个 PDF。 */
async function mergeGroup(
  ctx: Ctx,
  items: RunItem[],
  params: Record<string, unknown>,
  name: string,
): Promise<RunItem> {
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
  return writePdf(ctx, result.bytes, name);
}

/** 一组图片排成一个 PDF；大小上限对这一个 PDF 算（D-073）。 */
async function imagesPdf(
  ctx: Ctx,
  items: RunItem[],
  params: Record<string, unknown>,
  name: string,
): Promise<RunItem> {
  const { maxMB, textLayer, ...rest } = params as unknown as ImagePageOptions & {
    maxMB: number;
    textLayer?: boolean;
  };
  const {
    group: _group,
    groupSize: _size,
    ...page
  } = rest as ImagePageOptions & {
    group?: string;
    groupSize?: number;
  };
  let images: ImageInput[] = [];
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
        target: formatBytes(target, ctx.locale),
        got: formatBytes(result.bytes, ctx.locale),
      });
    }
  } else {
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      images.push(await imageBytes(ctx, item));
      ctx.progress(i + 1, items.length);
    }
  }
  // 能搜索的 PDF（D-195）：每页识别文字和位置。没有系统自带的识别（Expo Go）时不加；某一页识别失败只是那页不加。
  const vision = textLayer ? ctx.services.files.vision : null;
  if (vision) {
    const languages = textLayerLanguages(ctx.locale, deviceLanguageTags());
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      // 中日韩识别失败（旧系统不支持）时再按西欧语言认一次；还失败就这一页不加文字层。
      for (const attempt of languages === LATIN_TEXT_LAYER
        ? [languages]
        : [languages, LATIN_TEXT_LAYER]) {
        try {
          images[i] = { ...images[i]!, text: await vision.recognizeLines(item.uri, attempt) };
          break;
        } catch {
          // 换下一组语言。
        }
      }
      ctx.progress(i + 1, items.length);
    }
  }
  const result = await guard('', () => imagesToPdf(images, page));
  return writePdf(ctx, result.bytes, name);
}

export const PDF_IMPLS: Record<string, Impl> = {
  async 'pdf.merge'(input, params, ctx) {
    // D-243：分组时每组合成一个 PDF；分出来只有一个 PDF 的组原样留着（合并至少要 2 个，不分组时照旧报错）。
    const grouped = params.group !== undefined && params.group !== 'none';
    const out: RunItem[] = [];
    for (const group of groupsOf(input, params, ctx)) {
      ctx.throwIfCancelled();
      const only = group.items[0]!;
      if (grouped && group.items.length === 1 && !isImage(only)) {
        const pages = await guard(fileName(only), async () =>
          pageInfo(await readItem(ctx.services, only)),
        );
        out.push({ ...only, name: group.name, pageCount: pages.length });
      } else out.push(await mergeGroup(ctx, group.items, params, group.name));
    }
    return { type: 'pdf', items: out };
  },

  async 'pdf.fromImages'(input, params, ctx) {
    const out: RunItem[] = [];
    for (const group of groupsOf(input, params, ctx)) {
      ctx.throwIfCancelled();
      out.push(await imagesPdf(ctx, group.items, params, group.name));
    }
    return { type: 'pdf', items: out };
  },

  async 'pdf.pages'(input, _params, ctx) {
    const out: RunItem[] = [];
    for (const [i, item] of fileItems(input).entries()) {
      ctx.throwIfCancelled();
      const bytes = await readItem(ctx.services, item);
      const pages = await guard(fileName(item), () => pageInfo(bytes));
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
      // 整理界面出的错不是文件坏了，照实报出来（不经过 guard）。
      let chosen;
      try {
        chosen = await ctx.services.ui.open('pages', {
          item,
          pages,
          ...(thumbnails ? { thumbnails } : {}),
        });
      } catch (e) {
        throw arrangeError(e);
      }
      if (!chosen) throw new RunCancelled();
      // 什么都没改（最常见：合并后直接点「完成」）就原样留着，不再把每一页复制一遍。
      const unchanged =
        chosen.length === pages.length && chosen.every((p, j) => p.index === j && !p.rotate);
      const result = unchanged
        ? bytes
        : await arranged(fileName(item), async () => {
            let next = bytes;
            for (const angle of [90, 180, 270] as const) {
              const indices = chosen.filter((p) => p.rotate === angle).map((p) => p.index);
              if (indices.length) next = await rotatePages(next, angle, indices);
            }
            return selectPages(
              next,
              chosen.map((p) => p.index),
            );
          });
      out.push(await writePdf(ctx, result, item.name));
      ctx.progress(i + 1, fileItems(input).length);
    }
    return { type: 'pdf' as const, items: out };
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
