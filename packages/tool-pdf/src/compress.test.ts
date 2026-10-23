import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { openForCompression, picturePagesPdf } from './compress';
import {
  brokenBytes,
  makeEncryptedPdf,
  makeNoisyPng,
  makePdf,
  pageContent,
  readJpeg,
  readNoisyJpeg,
} from './test-helpers';

/** 一页文字 + 一张大 JPEG + 一张 Flate 图 + 一张带透明的 PNG（会有 SMask）+ 一张小图。 */
async function photoPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Selectable text stays', { x: 50, y: 800, size: 14, font });
  const jpeg = await doc.embedJpg(readNoisyJpeg());
  page.drawImage(jpeg, { x: 50, y: 450, width: 400, height: 300 });
  const flate = await doc.embedPng(makeNoisyPng(200, 150));
  page.drawImage(flate, { x: 50, y: 250, width: 200, height: 150 });
  const alpha = await doc.embedPng(makeNoisyPng(120, 120, true));
  page.drawImage(alpha, { x: 300, y: 250, width: 120, height: 120 });
  const small = await doc.embedJpg(readJpeg());
  page.drawImage(small, { x: 50, y: 50, width: 60, height: 40 });
  return doc.save();
}

/** PDF 里所有图片对象的滤镜、宽高。 */
async function imagesIn(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const out: { filter: string; width: number; height: number; colorSpace: string }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (String(obj.dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    out.push({
      filter: String(obj.dict.get(PDFName.of('Filter'))),
      width: Number(String(obj.dict.get(PDFName.of('Width')))),
      height: Number(String(obj.dict.get(PDFName.of('Height')))),
      colorSpace: String(obj.dict.get(PDFName.of('ColorSpace'))),
    });
  }
  return out;
}

describe('openForCompression', () => {
  it('finds the JPEG and the Flate RGB picture, but not masks or tiny pictures', async () => {
    const c = await openForCompression(await photoPdf());
    expect(c.pictures.map((p) => [p.width, p.height])).toEqual(
      expect.arrayContaining([
        [400, 300],
        [200, 150],
        [120, 120],
      ]),
    );
    // 120×120 的 SMask（透明度）和 60×40 的小图都不算。
    expect(c.pictures).toHaveLength(3);
    expect(c.otherBytes).toBeGreaterThan(0);
    expect(c.otherBytes + c.pictures.reduce((s, p) => s + p.storedBytes, 0)).toBe(c.originalBytes);
  });

  it('gives JPEG pictures as they are and turns Flate pictures into valid PNGs', async () => {
    const c = await openForCompression(await photoPdf());
    const jpeg = c.pictures.find((p) => p.width === 400)!.source();
    expect(jpeg.kind).toBe('jpeg');
    expect(jpeg.bytes).toEqual(readNoisyJpeg());

    const png = c.pictures.find((p) => p.width === 200)!.source();
    expect(png.kind).toBe('png');
    expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.bytes.buffer, png.bytes.byteOffset);
    expect(view.getUint32(16)).toBe(200);
    expect(view.getUint32(20)).toBe(150);
    // 像素和原图一样：解开 IDAT，每行 1 个滤镜字节 + 600 个字节。
    const idatLength = view.getUint32(33);
    const rows = inflateSync(png.bytes.subarray(41, 41 + idatLength));
    expect(rows.length).toBe(150 * 601);
  });

  it('swaps in smaller JPEGs and keeps the text and the transparency mask', async () => {
    const original = await photoPdf();
    const c = await openForCompression(original);
    const small = readJpeg();
    const replacements = new Map(
      c.pictures.map((p) => [p.id, { bytes: small, width: 60, height: 40 }]),
    );
    const out = await c.build(replacements);
    expect(out.length).toBeLessThan(original.length / 2);
    const images = await imagesIn(out);
    // 换过的三张都是 60×40 的 DCT RGB；SMask 还在（原样的 Flate 灰度图）。
    expect(images.filter((i) => i.filter === '/DCTDecode' && i.width === 60)).toHaveLength(4);
    expect(images.some((i) => i.filter === '/FlateDecode' && i.colorSpace === '/DeviceGray')).toBe(
      true,
    );
    expect(await pageContent(out, 0)).toContain('Tj');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  });

  it('does not swap in a picture that is not smaller', async () => {
    const original = await photoPdf();
    const c = await openForCompression(original);
    const jpeg = c.pictures.find((p) => p.width === 400)!;
    const bigger = new Uint8Array(jpeg.storedBytes + 10);
    const out = await c.build(new Map([[jpeg.id, { bytes: bigger, width: 1, height: 1 }]]));
    expect((await imagesIn(out)).some((i) => i.width === 400)).toBe(true);
  });

  it('finds nothing to do in a PDF without pictures', async () => {
    const c = await openForCompression(await makePdf([600, 600]));
    expect(c.pictures).toEqual([]);
    expect((await c.build(new Map())).length).toBeGreaterThan(0);
  });

  it('refuses encrypted and broken PDFs', async () => {
    await expect(openForCompression(await makeEncryptedPdf(), 'x.pdf')).rejects.toMatchObject({
      code: 'encrypted',
      fileName: 'x.pdf',
    });
    await expect(openForCompression(brokenBytes)).rejects.toMatchObject({ code: 'unreadable' });
  });
});

describe('picturePagesPdf', () => {
  it('puts each picture on a page of the original size', async () => {
    const result = await picturePagesPdf([
      { jpeg: readJpeg(), width: 595, height: 842 },
      { jpeg: readJpeg(), width: 842, height: 595 },
    ]);
    expect(result.pageCount).toBe(2);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [595, 842],
      [842, 595],
    ]);
  });

  it('needs at least one page and a real JPEG', async () => {
    await expect(picturePagesPdf([])).rejects.toMatchObject({ code: 'tooFew' });
    await expect(
      picturePagesPdf([{ jpeg: brokenBytes, width: 10, height: 10 }]),
    ).rejects.toMatchObject({ code: 'badImage' });
  });
});
