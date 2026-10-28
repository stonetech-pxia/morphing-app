import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { type ImagePageOptions, imagesToPdf, mergeDocuments } from './index';
import {
  imageDraws,
  makeEncryptedPdf,
  makePdf,
  makePng,
  pageContent,
  pageFonts,
  readJpeg,
} from './test-helpers';

const A4: ImagePageOptions = { pageSize: 'a4', orientation: 'auto', marginMm: 0, fit: 'contain' };
const MM = 72 / 25.4;

async function pageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => [p.getWidth(), p.getHeight()]);
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe('imagesToPdf', () => {
  it('puts each image on its own A4 page, landscape for landscape images', async () => {
    const result = await imagesToPdf(
      [
        { bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 },
        { bytes: makePng(20, 50), kind: 'png', width: 20, height: 50 },
      ],
      A4,
    );
    expect(result.pageCount).toBe(2);
    const [first, second] = await pageSizes(result.bytes);
    expect(first?.[0]).toBeCloseTo(841.89);
    expect(first?.[1]).toBeCloseTo(595.28);
    expect(second?.[0]).toBeCloseTo(595.28);
    expect(second?.[1]).toBeCloseTo(841.89);
  });

  it('embeds JPEG bytes unchanged', async () => {
    const jpeg = readJpeg();
    const result = await imagesToPdf([{ bytes: jpeg, kind: 'jpeg', width: 60, height: 40 }], A4);
    expect(contains(result.bytes, jpeg)).toBe(true);
  });

  it('honours forced orientation and letter size', async () => {
    const result = await imagesToPdf([{ bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 }], {
      ...A4,
      pageSize: 'letter',
      orientation: 'portrait',
    });
    expect(await pageSizes(result.bytes)).toEqual([[612, 792]]);
  });

  it('contain centres the whole image inside the margins', async () => {
    const result = await imagesToPdf([{ bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 }], {
      ...A4,
      orientation: 'portrait',
      marginMm: 10,
    });
    const [draw] = imageDraws(await pageContent(result.bytes, 0));
    const boxW = 595.28 - 20 * MM;
    expect(draw?.w).toBeCloseTo(boxW);
    expect(draw?.h).toBeCloseTo((boxW * 40) / 60);
    expect(draw?.x).toBeCloseTo(10 * MM);
    expect(draw?.y).toBeCloseTo((841.89 - (boxW * 40) / 60) / 2);
  });

  it('cover fills the area and clips to the margins', async () => {
    const result = await imagesToPdf([{ bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 }], {
      ...A4,
      orientation: 'portrait',
      marginMm: 10,
      fit: 'cover',
    });
    const content = await pageContent(result.bytes, 0);
    const [draw] = imageDraws(content);
    const boxH = 841.89 - 20 * MM;
    expect(draw?.h).toBeCloseTo(boxH);
    expect(draw?.w).toBeCloseTo((boxH * 60) / 40);
    expect(content).toMatch(/re\s+W\s+n/);
  });

  it("'fit' makes the page the image size plus margins, capped at 1700 pt", async () => {
    const small = await imagesToPdf([{ bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 }], {
      ...A4,
      pageSize: 'fit',
      marginMm: 0,
    });
    expect(await pageSizes(small.bytes)).toEqual([[60, 40]]);

    const wide = await imagesToPdf([{ bytes: makePng(3400, 100), kind: 'png' }], {
      ...A4,
      pageSize: 'fit',
      marginMm: 10,
    });
    const [size] = await pageSizes(wide.bytes);
    expect(size?.[0]).toBeCloseTo(1700 + 20 * MM);
    expect(size?.[1]).toBeCloseTo(50 + 20 * MM);
  });

  it('adds an invisible text layer where the lines were recognised, CJK lines included (D-195, D-266)', async () => {
    const result = await imagesToPdf(
      [
        {
          bytes: readJpeg(),
          kind: 'jpeg',
          width: 60,
          height: 40,
          text: {
            width: 600,
            height: 400,
            lines: [
              { text: 'Total 12,50 €', x: 60, y: 40, width: 300, height: 30 },
              { text: 'Café, élève, à côté, garçon, cœur', x: 60, y: 100, width: 200, height: 30 },
              { text: '合计 128 元', x: 60, y: 160, width: 100, height: 30 },
              { text: 'お会計 합계', x: 60, y: 220, width: 100, height: 30 },
            ],
          },
        },
        { bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 },
      ],
      A4,
    );
    const content = await pageContent(result.bytes, 0);
    // 渲染模式 3（不可见）：两行拉丁字母用 Helvetica，中日韩那两行用看不见的字体（UTF-16 十六进制）。
    expect(content.match(/3 Tr/g)).toHaveLength(4);
    expect(content.match(/\bTj\b/g)).toHaveLength(4);
    expect(content).toMatch(/\d+(\.\d+)? Tz/);
    const hex = [...content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) => m[1]!);
    const decoded = hex.map((h) =>
      String.fromCharCode(...(h.match(/..../g) ?? []).map((u) => parseInt(u, 16))),
    );
    expect(decoded).toContain('合计 128 元');
    expect(decoded).toContain('お会計 합계');
    // 字体是 Type0 + Identity-H，带 ToUnicode（搜索和复制靠它）和嵌入的字体文件。
    const fonts = await pageFonts(result.bytes, 0);
    const cjk = fonts.find((f) => f.subtype === 'Type0');
    expect(cjk).toMatchObject({ encoding: 'Identity-H', toUnicode: true, embedded: true });
    // 第二页没有文字。
    expect(await pageContent(result.bytes, 1)).not.toMatch(/Tr/);
  });

  it('writes no font when no page has text', async () => {
    const result = await imagesToPdf(
      [{ bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 }],
      A4,
    );
    expect(await pageFonts(result.bytes, 0)).toEqual([]);
  });

  it('rejects bad input', async () => {
    await expect(imagesToPdf([], A4)).rejects.toMatchObject({ code: 'tooFew' });
    await expect(
      imagesToPdf([{ bytes: readJpeg(), kind: 'jpeg' }], { ...A4, marginMm: 31 }),
    ).rejects.toMatchObject({ code: 'badOption' });
    await expect(imagesToPdf([{ bytes: makePng(4, 4), kind: 'jpeg' }], A4)).rejects.toMatchObject({
      code: 'badImage',
    });
  });
});

describe('mergeDocuments', () => {
  const fit: ImagePageOptions = { ...A4, pageSize: 'fit' };

  it('mixes PDFs and images in order', async () => {
    const result = await mergeDocuments(
      [
        { name: 'a.pdf', bytes: await makePdf([100]), kind: 'pdf' },
        { name: 'photo.jpg', bytes: readJpeg(), kind: 'jpeg', width: 60, height: 40 },
        { name: 'b.pdf', bytes: await makePdf([200, 300]), kind: 'pdf' },
        { name: 'shot.png', bytes: makePng(30, 70), kind: 'png' },
      ],
      fit,
    );
    expect(result.pageCount).toBe(5);
    expect((await pageSizes(result.bytes)).map(([w]) => w)).toEqual([100, 60, 200, 300, 30]);
  });

  it('accepts a single input', async () => {
    const result = await mergeDocuments([{ name: 'p.png', bytes: makePng(10, 10), kind: 'png' }]);
    expect(result.pageCount).toBe(1);
  });

  it('names the offending file', async () => {
    const good = { name: 'good.pdf', bytes: await makePdf([100]), kind: 'pdf' as const };
    await expect(mergeDocuments([])).rejects.toMatchObject({ code: 'tooFew' });
    await expect(
      mergeDocuments([good, { name: 'locked.pdf', bytes: await makeEncryptedPdf(), kind: 'pdf' }]),
    ).rejects.toMatchObject({ code: 'encrypted', fileName: 'locked.pdf' });
    await expect(
      mergeDocuments([good, { name: 'bad.pdf', bytes: makePng(4, 4), kind: 'pdf' }]),
    ).rejects.toMatchObject({ code: 'unreadable', fileName: 'bad.pdf' });
    await expect(
      mergeDocuments([good, { name: 'bad.png', bytes: readJpeg(), kind: 'png' }]),
    ).rejects.toMatchObject({ code: 'badImage', fileName: 'bad.png' });
  });
});
