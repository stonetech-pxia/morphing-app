import { PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  type PageNumberOptions,
  addPageNumbers,
  canEncodeStandardText,
  stampImage,
  stampText,
} from './index';
import { imageDraws, makePdf, pageContent, readJpeg, textDraws } from './test-helpers';

let font: PDFFont;
beforeAll(async () => {
  font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
});

function expectClose(actual: number[] | undefined, expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual?.[i]).toBeCloseTo(v));
}

/** 文字框中心（在 PDF 用户空间中）。 */
function textCenter(m: number[], text: string, size: number): [number, number] {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m;
  const w = font.widthOfTextAtSize(text, size) / 2;
  const h = font.heightAtSize(size, { descender: false }) / 2;
  return [e + a * w + c * h, f + b * w + d * h];
}

const NUMBERS: PageNumberOptions = {
  position: 'bottomCenter',
  format: 'n',
  startAt: 1,
  fontSize: 12,
  marginPt: 20,
};

describe('addPageNumbers', () => {
  it('numbers every page at the bottom centre', async () => {
    const out = await addPageNumbers(await makePdf([600, 600]), NUMBERS);
    for (const [i, label] of ['1', '2'].entries()) {
      const [draw] = textDraws(await pageContent(out, i));
      expect(draw?.text).toBe(label);
      const w = font.widthOfTextAtSize(label, 12);
      expectClose(draw?.m, [1, 0, 0, 1, (600 - w) / 2, 20]);
    }
  });

  it('numbers a subset in order with the chosen format', async () => {
    const out = await addPageNumbers(await makePdf([600, 600, 600]), {
      ...NUMBERS,
      format: 'nOfTotal',
      pages: [1, 2],
    });
    expect(textDraws(await pageContent(out, 0))).toEqual([]);
    expect(textDraws(await pageContent(out, 1))[0]?.text).toBe('1 / 2');
    expect(textDraws(await pageContent(out, 2))[0]?.text).toBe('2 / 2');

    const page = await addPageNumbers(await makePdf([600]), {
      ...NUMBERS,
      format: 'pageNOfTotal',
      startAt: 3,
      position: 'topRight',
    });
    const [draw] = textDraws(await pageContent(page, 0));
    expect(draw?.text).toBe('Page 3 of 3');
    const w = font.widthOfTextAtSize('Page 3 of 3', 12);
    const h = font.heightAtSize(12, { descender: false });
    expectClose(draw?.m, [1, 0, 0, 1, 600 - 20 - w, 800 - 20 - h]);
  });

  it('keeps numbers upright on rotated pages', async () => {
    const out = await addPageNumbers(await makePdf([{ size: [600, 800], rotate: 90 }]), NUMBERS);
    const [draw] = textDraws(await pageContent(out, 0));
    const w = font.widthOfTextAtSize('1', 12);
    // 视图宽 800、高 600；视图底边 = PDF 右边 x = 600。
    expectClose(draw?.m, [0, 1, -1, 0, 600 - 20, (800 - w) / 2]);
  });

  it('rejects bad options', async () => {
    const bytes = await makePdf([600]);
    await expect(addPageNumbers(bytes, { ...NUMBERS, fontSize: 0 })).rejects.toMatchObject({
      code: 'badOption',
    });
    await expect(addPageNumbers(bytes, { ...NUMBERS, pages: [1] })).rejects.toMatchObject({
      code: 'badRange',
    });
    await expect(addPageNumbers(bytes, { ...NUMBERS, pages: [] })).rejects.toMatchObject({
      code: 'badRange',
    });
    await expect(
      addPageNumbers(bytes, { ...NUMBERS, position: 'middle' as 'topLeft' }),
    ).rejects.toMatchObject({ code: 'badOption' });
  });
});

describe('canEncodeStandardText', () => {
  it('accepts WinAnsi text only', () => {
    expect(canEncodeStandardText('CONFIDENTIAL – Café “ok” € ™ ÿ')).toBe(true);
    expect(canEncodeStandardText('机密')).toBe(false);
    expect(canEncodeStandardText('ok 😀')).toBe(false);
    expect(canEncodeStandardText('a\nb')).toBe(false);
    expect(canEncodeStandardText('Ā')).toBe(false);
  });
});

describe('stampText', () => {
  const base = { text: 'DRAFT', fontSize: 48, color: '#FF0000', opacity: 0.3 };

  it('stamps a rotated watermark centred on every page', async () => {
    const out = await stampText(await makePdf([600, 600]), {
      ...base,
      position: 'center',
      rotateDeg: 45,
    });
    for (const i of [0, 1]) {
      const content = await pageContent(out, i);
      const [draw] = textDraws(content);
      expect(draw?.text).toBe('DRAFT');
      const s = Math.SQRT1_2;
      expectClose(draw?.m.slice(0, 4), [s, s, -s, s]);
      expectClose(textCenter(draw?.m ?? [], 'DRAFT', 48), [300, 400]);
      expect(content).toContain('1 0 0 rg');
      expect(content).toMatch(/\/GS-\S+ gs/);
    }
  });

  it('centres upright on a page rotated 270°', async () => {
    const out = await stampText(await makePdf([{ size: [600, 800], rotate: 270 }]), {
      ...base,
      position: 'center',
      pages: [0],
    });
    const [draw] = textDraws(await pageContent(out, 0));
    expectClose(draw?.m.slice(0, 4), [0, -1, 1, 0]);
    expectClose(textCenter(draw?.m ?? [], 'DRAFT', 48), [300, 400]);
  });

  it('refuses text the standard font cannot encode', async () => {
    const bytes = await makePdf([600]);
    await expect(
      stampText(bytes, { ...base, text: '机密', position: 'center' }),
    ).rejects.toMatchObject({ code: 'unsupportedText' });
    await expect(
      stampText(bytes, { ...base, color: 'red', position: 'center' }),
    ).rejects.toMatchObject({ code: 'badOption' });
    await expect(
      stampText(bytes, { ...base, opacity: 2, position: 'center' }),
    ).rejects.toMatchObject({ code: 'badOption' });
  });
});

describe('stampImage', () => {
  const image = { bytes: readJpeg(), kind: 'jpeg' as const };

  it('places the image by page fractions from the top-left', async () => {
    const out = await stampImage(await makePdf([600]), {
      image,
      pageIndex: 0,
      x: 0.5,
      y: 0.25,
      width: 0.2,
    });
    const [draw] = imageDraws(await pageContent(out, 0));
    expectClose(
      [draw?.x ?? NaN, draw?.y ?? NaN, draw?.w ?? NaN, draw?.h ?? NaN],
      [300, 520, 120, 80],
    );
    expectClose(draw?.rot, [1, 0, 0, 1]);
  });

  it('places it at the visible top-left of a rotated page', async () => {
    const out = await stampImage(await makePdf([600, { size: [600, 800], rotate: 90 }]), {
      image,
      pageIndex: 1,
      x: 0,
      y: 0,
      width: 0.5,
    });
    expect(imageDraws(await pageContent(out, 0))).toEqual([]);
    const [draw] = imageDraws(await pageContent(out, 1));
    // 视图宽 800：图片宽 400、高 266.67；旋转 90° 后从 PDF (266.67, 0) 向上画。
    expectClose(
      [draw?.x ?? NaN, draw?.y ?? NaN, draw?.w ?? NaN, draw?.h ?? NaN],
      [800 / 3, 0, 400, 800 / 3],
    );
    expectClose(draw?.rot, [0, 1, -1, 0]);
  });

  it('rejects bad placement and images', async () => {
    const bytes = await makePdf([600]);
    const opts = { image, pageIndex: 0, x: 0, y: 0, width: 0.5 };
    await expect(stampImage(bytes, { ...opts, pageIndex: 1 })).rejects.toMatchObject({
      code: 'badRange',
    });
    await expect(stampImage(bytes, { ...opts, x: 1.5 })).rejects.toMatchObject({
      code: 'badOption',
    });
    await expect(
      stampImage(bytes, { ...opts, image: { bytes: image.bytes, kind: 'png' } }),
    ).rejects.toMatchObject({ code: 'badImage' });
  });
});
