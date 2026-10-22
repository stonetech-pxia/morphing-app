import {
  PDFDocument,
  type PDFImage,
  PageSizes,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
} from 'pdf-lib';

import { type MergeResult, PdfError, assertNumber } from './core';

// 图片转 PDF：每张图片一页，按页面选项排版并居中。

export type ImageKind = 'jpeg' | 'png';

/**
 * width / height 只作参考：排版以图片本身的像素尺寸为准。
 * PDF 不认 EXIF 方向，调用方应先把照片转正再传入。
 */
export interface ImageInput {
  bytes: Uint8Array;
  kind: ImageKind;
  width?: number;
  height?: number;
}

export interface ImagePageOptions {
  /** 'fit'：页面就是图片大小（72 dpi，长边不超过 1700 pt）加边距。 */
  pageSize: 'a4' | 'letter' | 'fit';
  /** 'auto'：横图用横向页面。'fit' 时忽略。 */
  orientation: 'auto' | 'portrait' | 'landscape';
  /** 0–30 毫米。 */
  marginMm: number;
  /** contain：完整显示；cover：铺满边距内区域，超出部分裁掉。 */
  fit: 'contain' | 'cover';
}

const PT_PER_MM = 72 / 25.4;
const FIT_MAX_PT = 1700;

/** JPEG 原样嵌入（不重新编码）；无法解析时报 badImage。 */
export async function embedImage(
  doc: PDFDocument,
  image: { bytes: Uint8Array; kind: ImageKind },
  name?: string,
): Promise<PDFImage> {
  try {
    return image.kind === 'jpeg'
      ? await doc.embedJpg(image.bytes)
      : await doc.embedPng(image.bytes);
  } catch {
    throw new PdfError('badImage', name);
  }
}

export function assertImagePageOptions(opts: ImagePageOptions): void {
  assertNumber(opts.marginMm, 0, 30);
}

/** 为一张已嵌入的图片新增一页。 */
export function addImagePage(doc: PDFDocument, image: PDFImage, opts: ImagePageOptions): void {
  const margin = opts.marginMm * PT_PER_MM;
  const { width: iw, height: ih } = image;
  let pageW: number;
  let pageH: number;
  if (opts.pageSize === 'fit') {
    const s = Math.min(1, FIT_MAX_PT / Math.max(iw, ih));
    pageW = iw * s + 2 * margin;
    pageH = ih * s + 2 * margin;
  } else {
    const [w, h] = opts.pageSize === 'a4' ? PageSizes.A4 : PageSizes.Letter;
    const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && iw > ih);
    [pageW, pageH] = landscape ? [h, w] : [w, h];
  }
  const page = doc.addPage([pageW, pageH]);
  const boxW = pageW - 2 * margin;
  const boxH = pageH - 2 * margin;
  const scale = (opts.fit === 'cover' ? Math.max : Math.min)(boxW / iw, boxH / ih);
  const width = iw * scale;
  const height = ih * scale;
  const placement = { x: (pageW - width) / 2, y: (pageH - height) / 2, width, height };
  if (opts.fit === 'cover') {
    // 裁剪到边距内的区域，避免图片盖住边距。
    page.pushOperators(
      pushGraphicsState(),
      rectangle(margin, margin, boxW, boxH),
      clip(),
      endPath(),
    );
    page.drawImage(image, placement);
    page.pushOperators(popGraphicsState());
  } else {
    page.drawImage(image, placement);
  }
}

/** 按顺序把图片转成 PDF，每张一页。 */
export async function imagesToPdf(
  images: readonly ImageInput[],
  opts: ImagePageOptions,
): Promise<MergeResult> {
  if (images.length < 1) throw new PdfError('tooFew');
  assertImagePageOptions(opts);
  const doc = await PDFDocument.create();
  for (const image of images) addImagePage(doc, await embedImage(doc, image), opts);
  return { bytes: await doc.save(), pageCount: doc.getPageCount() };
}
