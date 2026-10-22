import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { PdfError, pageInfo, resolvePageRule, rotatePages, selectPages, splitPdf } from './index';
import { makePdf } from './test-helpers';

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getWidth());
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof PdfError ? e.code : 'other';
  }
  return undefined;
}

describe('pageInfo', () => {
  it('reports the size as the user sees it and the rotation', async () => {
    const bytes = await makePdf([{ size: [600, 800] }, { size: [600, 800], rotate: 90 }, 300]);
    expect(await pageInfo(bytes)).toEqual([
      { width: 600, height: 800, rotation: 0 },
      { width: 800, height: 600, rotation: 90 },
      { width: 300, height: 800, rotation: 0 },
    ]);
  });
});

describe('selectPages', () => {
  it('extracts, deletes and reorders', async () => {
    const bytes = await makePdf([100, 200, 300, 400]);
    expect(await widths(await selectPages(bytes, [2]))).toEqual([300]);
    expect(await widths(await selectPages(bytes, [0, 1, 3]))).toEqual([100, 200, 400]);
    expect(await widths(await selectPages(bytes, [3, 2, 1, 0]))).toEqual([400, 300, 200, 100]);
  });

  it('rejects empty, duplicate and out-of-range indices', async () => {
    const bytes = await makePdf([100, 200]);
    for (const indices of [[], [0, 0], [2], [-1], [0.5]]) {
      await expect(selectPages(bytes, indices)).rejects.toMatchObject({ code: 'badRange' });
    }
  });
});

describe('rotatePages', () => {
  it('adds to the existing rotation, all pages by default', async () => {
    const bytes = await makePdf([{ size: [100, 100], rotate: 270 }, 200]);
    expect((await pageInfo(await rotatePages(bytes, 180))).map((p) => p.rotation)).toEqual([
      90, 180,
    ]);
    expect((await pageInfo(await rotatePages(bytes, 90, [1]))).map((p) => p.rotation)).toEqual([
      270, 90,
    ]);
  });

  it('rejects bad rotations and indices', async () => {
    const bytes = await makePdf([100]);
    await expect(rotatePages(bytes, 45 as 90)).rejects.toMatchObject({ code: 'badOption' });
    await expect(rotatePages(bytes, 90, [1])).rejects.toMatchObject({ code: 'badRange' });
  });
});

describe('splitPdf', () => {
  it('splits every n pages', async () => {
    const parts = await splitPdf(await makePdf([100, 200, 300, 400, 500]), { kind: 'every', n: 2 });
    expect(await Promise.all(parts.map(widths))).toEqual([[100, 200], [300, 400], [500]]);
  });

  it('splits by explicit page lists', async () => {
    const parts = await splitPdf(await makePdf([100, 200, 300]), {
      kind: 'ranges',
      ranges: [[2], [0, 1]],
    });
    expect(await Promise.all(parts.map(widths))).toEqual([[300], [100, 200]]);
  });

  it('rejects bad modes', async () => {
    const bytes = await makePdf([100]);
    await expect(splitPdf(bytes, { kind: 'every', n: 0 })).rejects.toMatchObject({
      code: 'badOption',
    });
    await expect(splitPdf(bytes, { kind: 'ranges', ranges: [] })).rejects.toMatchObject({
      code: 'badRange',
    });
    await expect(splitPdf(bytes, { kind: 'ranges', ranges: [[0], [3]] })).rejects.toMatchObject({
      code: 'badRange',
    });
  });
});

describe('resolvePageRule', () => {
  it('resolves symbolic rules', () => {
    expect(resolvePageRule('all', 4)).toEqual([0, 1, 2, 3]);
    expect(resolvePageRule('odd', 5)).toEqual([0, 2, 4]);
    expect(resolvePageRule('even', 5)).toEqual([1, 3]);
    expect(resolvePageRule('first', 5)).toEqual([0]);
    expect(resolvePageRule('last', 5)).toEqual([4]);
  });

  it('parses human 1-based ranges in written order without duplicates', () => {
    expect(resolvePageRule({ range: '1-3, 5, 8-' }, 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(resolvePageRule({ range: '-2' }, 10)).toEqual([0, 1]);
    expect(resolvePageRule({ range: '5，1–2; 2 ~ 3' }, 10)).toEqual([4, 0, 1, 2]);
    expect(resolvePageRule({ range: ' 4 ' }, 4)).toEqual([3]);
  });

  it('rejects out-of-range and malformed input', () => {
    for (const range of [
      '',
      ',',
      '0',
      '11',
      '8-12',
      '3-1',
      '1-2-3',
      'a',
      '1.5',
      '1e3',
      '99999999',
    ]) {
      expect(code(() => resolvePageRule({ range }, 10))).toBe('badRange');
    }
    expect(code(() => resolvePageRule({ range: '1,'.repeat(600) }, 10))).toBe('badRange');
    expect(code(() => resolvePageRule('even', 1))).toBe('badRange');
    expect(code(() => resolvePageRule('bogus' as 'all', 3))).toBe('badRange');
  });
});
