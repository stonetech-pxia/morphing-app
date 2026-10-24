import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  PageSizes,
  StandardFonts,
  TextRenderingMode,
  beginText,
  clip,
  endPath,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setCharacterSqueeze,
  setFontAndSize,
  setTextRenderingMode,
  showText,
} from 'pdf-lib';

import { type MergeResult, PdfError, assertNumber } from './core';

// 图片转 PDF：每张图片一页，按页面选项排版并居中。图片带着识别出的文字时，在上面画一层看不见的字
// （D-195）：PDF 看起来不变，但能搜索、选中、复制。

export type ImageKind = 'jpeg' | 'png';

/** 图片上识别出的一行字：像素坐标，原点在左上角。 */
export interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一张图片的文字：width / height 是识别时图片的像素大小（坐标按它换算，和嵌入时的缩放无关）。 */
export interface TextLayer {
  width: number;
  height: number;
  lines: readonly TextLine[];
}

/**
 * width / height 只作参考：排版以图片本身的像素尺寸为准。
 * PDF 不认 EXIF 方向，调用方应先把照片转正再传入。
 */
export interface ImageInput {
  bytes: Uint8Array;
  kind: ImageKind;
  width?: number;
  height?: number;
  /** 识别出的文字；有时画一层看不见的字。 */
  text?: TextLayer;
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

/**
 * 看不见的文字层（D-195）：每行用文字渲染模式「不可见」画在识别框的位置，横向缩放到框的宽度。
 * 只写 Helvetica 写得出的字（拉丁字母，P-028）；有别的字的那一行跳过。
 */
function drawTextLayer(
  page: PDFPage,
  placement: { x: number; y: number; width: number; height: number },
  layer: TextLayer,
  font: PDFFont,
): void {
  const charset = new Set(font.getCharacterSet());
  const key = page.node.newFontDictionary(font.name, font.ref);
  const sx = placement.width / layer.width;
  const sy = placement.height / layer.height;
  for (const line of layer.lines) {
    const text = line.text.trim();
    if (!text || ![...text].every((c) => charset.has(c.codePointAt(0)!))) continue;
    const size = line.height * sy;
    const natural = font.widthOfTextAtSize(text, size);
    if (size <= 0 || natural <= 0) continue;
    // 基线比框的底边高一点（下伸部分约占 0.2 个字高）。
    const x = placement.x + line.x * sx;
    const y = placement.y + placement.height - (line.y + line.height) * sy + size * 0.2;
    page.pushOperators(
      beginText(),
      setFontAndSize(key, size),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setCharacterSqueeze(((line.width * sx) / natural) * 100),
      moveText(x, y),
      showText(font.encodeText(text)),
      endText(),
    );
  }
}

/** 为一张已嵌入的图片新增一页；带文字时（text 和 font 都给了）加上看不见的文字层。 */
export function addImagePage(
  doc: PDFDocument,
  image: PDFImage,
  opts: ImagePageOptions,
  text?: { layer: TextLayer; font: PDFFont },
): void {
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
  if (text) drawTextLayer(page, placement, text.layer, text.font);
}

/** 按顺序把图片转成 PDF，每张一页。 */
export async function imagesToPdf(
  images: readonly ImageInput[],
  opts: ImagePageOptions,
): Promise<MergeResult> {
  if (images.length < 1) throw new PdfError('tooFew');
  assertImagePageOptions(opts);
  const doc = await PDFDocument.create();
  const font = images.some((i) => i.text?.lines.length)
    ? await doc.embedFont(StandardFonts.Helvetica)
    : null;
  for (const image of images) {
    const text = image.text && font ? { layer: image.text, font } : undefined;
    addImagePage(doc, await embedImage(doc, image), opts, text);
  }
  return { bytes: await doc.save(), pageCount: doc.getPageCount() };
}
