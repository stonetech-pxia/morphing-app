import { unzlibSync, zlibSync } from 'fflate';
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from 'pdf-lib';

import { type MergeResult, PdfError, loadPdf } from './core';

// 压缩 PDF（D-136）：只重新压缩里面的图片，文字、链接、表格都保留。
// 图片的解码和编码由 App 的系统编码器完成（缩小 + 降质量，输出 JPEG），这里只负责
// 找出能处理的图片、把它们变成编码器认识的 JPEG / PNG，以及把新的 JPEG 换回去。
//
// 能处理的：DCTDecode（数据本身就是 JPEG）；FlateDecode 的 8 位 RGB / 灰度图（补成 PNG）。
// 跳过：黑白扫描（JBIG2 / CCITT，本来就小）、JPEG 2000、CMYK、索引色、带 /Decode 的、
// 用作别的图片遮罩的（SMask / Mask）、很小的图。

/** 比这还小的图片不值得重新编码。 */
const MIN_PIXELS = 64 * 64;
const MIN_STORED_BYTES = 8 * 1024;

export interface PdfPicture {
  /** 在这份 PDF 里的编号（换图时用）。 */
  id: number;
  width: number;
  height: number;
  /** PDF 里现在占多少字节。 */
  storedBytes: number;
  /** 交给系统编码器的原图：JPEG 原样，Flate 图补成 PNG。用到时才生成，省内存。 */
  source(): { kind: 'jpeg' | 'png'; bytes: Uint8Array };
}

export interface PdfReplacement {
  /** JPEG（RGB）。 */
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PdfCompressor {
  originalBytes: number;
  pictures: readonly PdfPicture[];
  /** 不是这些图片的部分大约占多少字节（估计压缩后的大小用）。 */
  otherBytes: number;
  /** 换上新图片后保存。只换比原来小的。 */
  build(replacements: ReadonlyMap<number, PdfReplacement>): Promise<Uint8Array>;
}

const name = (n: string) => PDFName.of(n);

function lookupName(doc: PDFDocument, value: PDFObject | undefined): string | undefined {
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
  return resolved instanceof PDFName ? resolved.decodeText() : undefined;
}

function lookupNumber(doc: PDFDocument, value: PDFObject | undefined): number | undefined {
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
  return resolved instanceof PDFNumber ? resolved.asNumber() : undefined;
}

/** 颜色空间的通道数：只认 RGB 和灰度（DeviceRGB / DeviceGray / CalRGB / CalGray / ICCBased N=3 或 1）。 */
function channels(doc: PDFDocument, value: PDFObject | undefined): 1 | 3 | null {
  const cs = value instanceof PDFRef ? doc.context.lookup(value) : value;
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    if (n === 'DeviceRGB' || n === 'CalRGB') return 3;
    if (n === 'DeviceGray' || n === 'CalGray') return 1;
    return null;
  }
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const kind = lookupName(doc, cs.get(0));
    if (kind === 'CalRGB') return 3;
    if (kind === 'CalGray') return 1;
    if (kind === 'ICCBased') {
      const profile = doc.context.lookup(cs.get(1));
      const n =
        profile instanceof PDFRawStream
          ? lookupNumber(doc, profile.dict.get(name('N')))
          : undefined;
      return n === 3 ? 3 : n === 1 ? 1 : null;
    }
  }
  return null;
}

/** 只有一个滤镜时返回它的名字；没有滤镜返回 ''；多个滤镜返回 null（不处理）。 */
function singleFilter(doc: PDFDocument, dict: PDFDict): string | null {
  const filter = dict.get(name('Filter'));
  if (filter === undefined) return '';
  const resolved = filter instanceof PDFRef ? doc.context.lookup(filter) : filter;
  if (resolved instanceof PDFName) return resolved.decodeText();
  if (resolved instanceof PDFArray && resolved.size() === 1) {
    return lookupName(doc, resolved.get(0)) ?? null;
  }
  return null;
}

function decodeParm(doc: PDFDocument, dict: PDFDict, key: string): number | undefined {
  let parms = dict.get(name('DecodeParms'));
  if (parms instanceof PDFRef) parms = doc.context.lookup(parms);
  if (parms instanceof PDFArray) parms = parms.get(0);
  if (parms instanceof PDFRef) parms = doc.context.lookup(parms);
  return parms instanceof PDFDict ? lookupNumber(doc, parms.get(name(key))) : undefined;
}

// ---- PNG ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: readonly Uint8Array[]): number {
  let crc = ~0;
  for (const bytes of parts) {
    for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

function u32(n: number): Uint8Array {
  return Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const t = Uint8Array.from(type, (c) => c.charCodeAt(0));
  return [u32(data.length), t, data, u32(crc32([t, data]))];
}

/** rows：每行前面带一个 PNG 滤镜字节的像素数据。 */
function makePng(width: number, height: number, gray: boolean, rows: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = gray ? 0 : 2;
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibSync(rows)),
    ...chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Flate 解出来的像素 → 带滤镜字节的 PNG 行。PNG 预测器（≥ 10）的数据本来就是这个格式。 */
function pngRows(
  data: Uint8Array,
  width: number,
  height: number,
  comps: number,
  predictor: number,
): Uint8Array | null {
  const stride = width * comps;
  if (predictor >= 10) return data.length >= (stride + 1) * height ? data : null;
  if (data.length < stride * height) return null;
  const rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rows.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return rows;
}

/** 用作别的图片遮罩的图片：不能换成 JPEG。 */
function maskRefs(doc: PDFDocument): Set<string> {
  const refs = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const key of ['SMask', 'Mask']) {
      const value = obj.dict.get(name(key));
      if (value instanceof PDFRef) refs.add(value.toString());
    }
  }
  return refs;
}

/** 打开一份 PDF，找出能重新压缩的图片。加密或损坏时抛出 PdfError。 */
export async function openForCompression(
  bytes: Uint8Array,
  fileName?: string,
): Promise<PdfCompressor> {
  const doc = await loadPdf(bytes, fileName);
  const masks = maskRefs(doc);
  const pictures: PdfPicture[] = [];
  const refs = new Map<number, PDFRef>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || masks.has(ref.toString())) continue;
    const dict = obj.dict;
    if (lookupName(doc, dict.get(name('Subtype'))) !== 'Image') continue;
    const imageMask = dict.get(name('ImageMask'));
    if (imageMask instanceof PDFBool && imageMask.asBoolean()) continue;
    if (dict.get(name('Decode')) !== undefined) continue;
    const width = lookupNumber(doc, dict.get(name('Width')));
    const height = lookupNumber(doc, dict.get(name('Height')));
    if (!width || !height || width * height < MIN_PIXELS) continue;
    if (obj.contents.length < MIN_STORED_BYTES) continue;
    const comps = channels(doc, dict.get(name('ColorSpace')));
    if (comps === null) continue;
    const filter = singleFilter(doc, dict);
    let source: PdfPicture['source'];
    if (filter === 'DCTDecode') {
      const contents = obj.contents;
      source = () => ({ kind: 'jpeg', bytes: contents });
    } else if (filter === 'FlateDecode') {
      if (lookupNumber(doc, dict.get(name('BitsPerComponent'))) !== 8) continue;
      const predictor = decodeParm(doc, dict, 'Predictor') ?? 1;
      if (predictor !== 1 && predictor < 10) continue;
      if (predictor >= 10) {
        const colors = decodeParm(doc, dict, 'Colors') ?? 1;
        const columns = decodeParm(doc, dict, 'Columns') ?? 1;
        if (colors !== comps || columns !== width) continue;
      }
      const contents = obj.contents;
      source = () => {
        const rows = pngRows(unzlibSync(contents), width, height, comps, predictor);
        if (!rows) throw new PdfError('badImage', fileName);
        return { kind: 'png', bytes: makePng(width, height, comps === 1, rows) };
      };
    } else {
      continue;
    }
    const id = pictures.length;
    refs.set(id, ref);
    pictures.push({ id, width, height, storedBytes: obj.contents.length, source });
  }
  const pictureBytes = pictures.reduce((sum, p) => sum + p.storedBytes, 0);
  return {
    originalBytes: bytes.length,
    pictures,
    otherBytes: Math.max(0, bytes.length - pictureBytes),
    async build(replacements) {
      for (const [id, next] of replacements) {
        const ref = refs.get(id);
        const old = ref && doc.context.lookup(ref);
        if (!ref || !(old instanceof PDFRawStream) || next.bytes.length >= old.contents.length) {
          continue;
        }
        const dict = old.dict.clone(doc.context);
        dict.set(name('Filter'), name('DCTDecode'));
        dict.delete(name('DecodeParms'));
        dict.set(name('Width'), PDFNumber.of(next.width));
        dict.set(name('Height'), PDFNumber.of(next.height));
        dict.set(name('BitsPerComponent'), PDFNumber.of(8));
        // 系统编码器输出的是 RGB JPEG；原来的 ICC 描述文件不再适用。
        dict.set(name('ColorSpace'), name('DeviceRGB'));
        dict.delete(name('Length'));
        doc.context.assign(ref, PDFRawStream.of(dict, next.bytes));
      }
      return doc.save({ useObjectStreams: true });
    },
  };
}

/**
 * 把每页的图片按原来的纸张大小（pt）排成新的 PDF（「转成图片」的退路）。
 * 图片铺满整页，文字不能再选中，链接和表格也没有了。
 */
export async function picturePagesPdf(
  pages: readonly { jpeg: Uint8Array; width: number; height: number }[],
): Promise<MergeResult> {
  if (pages.length < 1) throw new PdfError('tooFew');
  const doc = await PDFDocument.create();
  for (const p of pages) {
    let image;
    try {
      image = await doc.embedJpg(p.jpeg);
    } catch {
      throw new PdfError('badImage');
    }
    const page = doc.addPage([p.width, p.height]);
    page.drawImage(image, { x: 0, y: 0, width: p.width, height: p.height });
  }
  return { bytes: await doc.save({ useObjectStreams: true }), pageCount: doc.getPageCount() };
}
