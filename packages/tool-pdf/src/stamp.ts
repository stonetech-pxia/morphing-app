import { type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

import { PdfError, assertNumber, assertPageIndices, canEncodeStandardText, loadPdf } from './core';
import { type ImageKind, embedImage } from './images';
import { type PageView, pageView, placeBox } from './view';

// 在已有页面上叠加内容：页码、文字水印 / 印章、图片（签名、中文印章）。
// 位置一律按用户看到的方向计算：带 /Rotate 的页面上，内容会随之旋转，看起来依然是正的。

export type EdgePosition =
  'bottomCenter' | 'bottomRight' | 'bottomLeft' | 'topCenter' | 'topRight' | 'topLeft';
export type StampPosition = EdgePosition | 'center';

/** [水平, 垂直] 锚点：0 = 左 / 下，0.5 = 居中，1 = 右 / 上。 */
const ANCHORS: Record<StampPosition, [number, number]> = {
  bottomLeft: [0, 0],
  bottomCenter: [0.5, 0],
  bottomRight: [1, 0],
  topLeft: [0, 1],
  topCenter: [0.5, 1],
  topRight: [1, 1],
  center: [0.5, 0.5],
};

/** 文字框（基线左端为 p, q）在视图中的位置。 */
function anchorRect(view: PageView, position: StampPosition, w: number, h: number, margin: number) {
  const anchor: [number, number] | undefined = ANCHORS[position];
  if (!anchor) throw new PdfError('badOption');
  const [ax, ay] = anchor;
  return {
    p: margin + ax * (view.width - 2 * margin - w),
    q: margin + ay * (view.height - 2 * margin - h),
    w,
    h,
  };
}

function drawLabel(
  page: PDFPage,
  font: PDFFont,
  text: string,
  opts: {
    position: StampPosition;
    fontSize: number;
    margin: number;
    color?: ReturnType<typeof rgb>;
    opacity?: number;
    rotateDeg?: number;
  },
): void {
  const view = pageView(page);
  const w = font.widthOfTextAtSize(text, opts.fontSize);
  const h = font.heightAtSize(opts.fontSize, { descender: false });
  const rect = anchorRect(view, opts.position, w, h, opts.margin);
  page.drawText(text, {
    ...placeBox(view, rect, opts.rotateDeg ?? 0),
    font,
    size: opts.fontSize,
    color: opts.color ?? rgb(0, 0, 0),
    opacity: opts.opacity ?? 1,
  });
}

export interface PageNumberOptions {
  position: EdgePosition;
  /** n："3"；nOfTotal："3 / 10"；pageNOfTotal："Page 3 of 10"。 */
  format: 'n' | 'nOfTotal' | 'pageNOfTotal';
  startAt: number;
  fontSize: number;
  marginPt: number;
  /**
   * 只给这些页（0 起）编号；编号按它们在列表中的顺序从 startAt 起递增，
   * 总数 = startAt + 页数 - 1。例如跳过封面：pages = [1..n-1]、startAt = 1。
   */
  pages?: number[];
}

function formatNumber(format: PageNumberOptions['format'], n: number, total: number): string {
  if (format === 'n') return String(n);
  if (format === 'nOfTotal') return `${n} / ${total}`;
  return `Page ${n} of ${total}`;
}

/** 用 Helvetica 加页码，黑色。 */
export async function addPageNumbers(
  bytes: Uint8Array,
  opts: PageNumberOptions,
): Promise<Uint8Array> {
  assertNumber(opts.fontSize, 1, 200);
  assertNumber(opts.marginPt, 0, 300);
  assertNumber(opts.startAt, 0, 1_000_000);
  if (!Number.isInteger(opts.startAt)) throw new PdfError('badOption');
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const targets = opts.pages ?? doc.getPageIndices();
  assertPageIndices(targets, pages.length);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = opts.startAt + targets.length - 1;
  targets.forEach((index, k) => {
    const page = pages[index];
    if (!page) return;
    drawLabel(page, font, formatNumber(opts.format, opts.startAt + k, total), {
      position: opts.position,
      fontSize: opts.fontSize,
      margin: opts.marginPt,
    });
  });
  return doc.save();
}

export interface StampTextOptions {
  /** 只支持标准字体可编码的单行文字，见 canEncodeStandardText。 */
  text: string;
  position: StampPosition;
  fontSize: number;
  /** '#RRGGBB' */
  color: string;
  /** 0–1 */
  opacity: number;
  /** 绕文字中心逆时针旋转（用户所见方向），如 45 做斜向水印。 */
  rotateDeg?: number;
  /** 0 起；不传则所有页。 */
  pages?: number[];
}

/** 文字离页边的固定距离（半英寸）。 */
const STAMP_MARGIN_PT = 36;

function parseColor(hex: string): ReturnType<typeof rgb> {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new PdfError('badOption');
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/** 用 Helvetica 盖文字；标准字体无法编码时抛 unsupportedText。 */
export async function stampText(bytes: Uint8Array, opts: StampTextOptions): Promise<Uint8Array> {
  if (opts.text.length < 1) throw new PdfError('badOption');
  if (!canEncodeStandardText(opts.text)) throw new PdfError('unsupportedText');
  const color = parseColor(opts.color);
  assertNumber(opts.fontSize, 1, 500);
  assertNumber(opts.opacity, 0, 1);
  assertNumber(opts.rotateDeg ?? 0, -360, 360);
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const targets = opts.pages ?? doc.getPageIndices();
  assertPageIndices(targets, pages.length);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const index of targets) {
    const page = pages[index];
    if (!page) continue;
    drawLabel(page, font, opts.text, {
      position: opts.position,
      fontSize: opts.fontSize,
      margin: STAMP_MARGIN_PT,
      color,
      opacity: opts.opacity,
      rotateDeg: opts.rotateDeg ?? 0,
    });
  }
  return doc.save();
}

export interface StampImageOptions {
  image: { bytes: Uint8Array; kind: ImageKind };
  pageIndex: number;
  /** 图片左上角，占页面宽 / 高的比例（0–1，原点为用户所见的左上角）。 */
  x: number;
  y: number;
  /** 图片宽度占页宽的比例；高度按图片比例计算。 */
  width: number;
}

/** 把图片（签名、Skia 渲染的中文印章）放到某一页上；旋转过的页面按用户所见方向放置。 */
export async function stampImage(bytes: Uint8Array, opts: StampImageOptions): Promise<Uint8Array> {
  assertNumber(opts.x, 0, 1);
  assertNumber(opts.y, 0, 1);
  assertNumber(opts.width, 0.001, 1);
  const doc = await loadPdf(bytes);
  assertPageIndices([opts.pageIndex], doc.getPageCount());
  const page = doc.getPage(opts.pageIndex);
  const image = await embedImage(doc, opts.image);
  const view = pageView(page);
  const w = opts.width * view.width;
  const h = (w * image.height) / image.width;
  const rect = { p: opts.x * view.width, q: view.height * (1 - opts.y) - h, w, h };
  page.drawImage(image, { ...placeBox(view, rect), width: w, height: h });
  return doc.save();
}
