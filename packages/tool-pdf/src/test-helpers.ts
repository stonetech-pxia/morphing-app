/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';

// 仅供测试：生成真实 PDF / PNG，读取 JPEG 样本，解出页面内容流。

/** 每页一个 [宽, 高]（或只给宽，高 800），可选旋转角。 */
export async function makePdf(
  pages: (number | { size: [number, number]; rotate?: number })[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    if (typeof spec === 'number') {
      doc.addPage([spec, 800]);
    } else {
      const page = doc.addPage(spec.size);
      if (spec.rotate) page.setRotation(degrees(spec.rotate));
    }
  }
  return doc.save();
}

/** trailer 里带 /Encrypt 的 PDF，pdf-lib 默认拒绝加载。 */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 1, R: 2 });
  return doc.save();
}

export const brokenBytes = Uint8Array.from('this is not a pdf', (c) => c.charCodeAt(0));

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** 真实的 RGB PNG（渐变色）。 */
export function makePng(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // RGB
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * row + 1 + x * 3;
      raw[o] = (x * 255) / width;
      raw[o + 1] = (y * 255) / height;
      raw[o + 2] = 128;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', new Uint8Array(0)),
    ]),
  );
}

/** 带噪点的 RGB（或 RGBA）PNG：压不小，嵌进 PDF 后够大，压缩 PDF 的测试用。 */
export function makeNoisyPng(width: number, height: number, alpha = false): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const comps = alpha ? 4 : 3;
  const row = width * comps + 1;
  const raw = Buffer.alloc(row * height);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    if (i % row === 0) continue;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (seed >>> 16) & 0xff;
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', new Uint8Array(0)),
    ]),
  );
}

/** 400×300 带噪点的 JPEG（约 90 KB，用 macOS sips 转出）。 */
export function readNoisyJpeg(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('./__fixtures__/noise-400x300.jpg', import.meta.url)));
}

/** 60×40 的真实 JPEG（用 macOS sips 从渐变 PNG 转出）。 */
export function readJpeg(): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL('./__fixtures__/gradient-60x40.jpg', import.meta.url)),
  );
}

/** 页面内容流（解压后拼成 latin1 字符串），用于检查绘制指令。 */
export async function pageContent(bytes: Uint8Array, index: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((ref) => {
      const stream = ref && doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return '';
      const filtered = stream.dict.get(PDFName.of('Filter')) !== undefined;
      return Buffer.from(filtered ? inflateSync(stream.contents) : stream.contents).toString(
        'latin1',
      );
    })
    .join('\n');
}

/** 内容流中所有文字矩阵 Tm（a b c d e f）及紧随其后的十六进制文字。 */
export function textDraws(content: string): { m: number[]; text: string }[] {
  const re = /(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) Tm\s*<([0-9A-Fa-f]*)> Tj/g;
  return [...content.matchAll(re)].map((match) => ({
    m: match.slice(1, 7).map(Number),
    text: Buffer.from(match[7] ?? '', 'hex').toString('latin1'),
  }));
}

/** 内容流中 drawImage 的平移、旋转和缩放（pdf-lib 固定的指令顺序：平移、旋转、缩放、斜切）。 */
export function imageDraws(
  content: string,
): { x: number; y: number; rot: number[]; w: number; h: number }[] {
  const n = '(-?[\\d.e-]+)';
  const re = new RegExp(
    `1 0 0 1 ${n} ${n} cm\\s+${n} ${n} ${n} ${n} 0 0 cm\\s+${n} 0 0 ${n} 0 0 cm\\s+[^\\n]* cm\\s+/\\S+ Do`,
    'g',
  );
  return [...content.matchAll(re)].map((m) => {
    const v = m.slice(1).map(Number);
    return { x: v[0] ?? 0, y: v[1] ?? 0, rot: v.slice(2, 6), w: v[6] ?? 0, h: v[7] ?? 0 };
  });
}

/** 一页用到的字体：子类型、编码、有没有 ToUnicode、有没有嵌入字体文件。 */
export async function pageFonts(
  bytes: Uint8Array,
  index: number,
): Promise<{ subtype: string; encoding: string; toUnicode: boolean; embedded: boolean }[]> {
  const doc = await PDFDocument.load(bytes);
  const resources = doc.getPage(index).node.Resources();
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) return [];
  return fonts.values().map((ref) => {
    const font = doc.context.lookup(ref, PDFDict);
    const name = (key: string, dict = font) =>
      dict.lookupMaybe(PDFName.of(key), PDFName)?.decodeText() ?? '';
    const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
    const cid = descendants ? doc.context.lookup(descendants.get(0), PDFDict) : undefined;
    const descriptor = (cid ?? font).lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    return {
      subtype: name('Subtype'),
      encoding: name('Encoding'),
      toUnicode: font.has(PDFName.of('ToUnicode')),
      embedded: !!descriptor?.has(PDFName.of('FontFile2')),
    };
  });
}
