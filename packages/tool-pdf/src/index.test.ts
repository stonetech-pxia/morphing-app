import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { PdfError, countPages, mergePdfs } from './index';

/** 生成真实 PDF：每页宽度不同，用来验证合并顺序。 */
async function makePdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 800]);
  return doc.save();
}

async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getWidth());
}

describe('mergePdfs', () => {
  it('merges real PDFs in the given order', async () => {
    const a = await makePdf([100]);
    const b = await makePdf([200, 300]);
    const result = await mergePdfs([
      { name: 'a.pdf', bytes: a },
      { name: 'b.pdf', bytes: b },
    ]);
    expect(result.pageCount).toBe(3);
    expect(await pageWidths(result.bytes)).toEqual([100, 200, 300]);
    expect(await countPages(result.bytes)).toBe(3);

    const reversed = await mergePdfs([
      { name: 'b.pdf', bytes: b },
      { name: 'a.pdf', bytes: a },
    ]);
    expect(await pageWidths(reversed.bytes)).toEqual([200, 300, 100]);
  });

  it('requires at least two files', async () => {
    await expect(mergePdfs([{ name: 'a.pdf', bytes: await makePdf([100]) }])).rejects.toMatchObject(
      {
        code: 'tooFew',
      },
    );
  });

  it('names the file that cannot be read', async () => {
    const good = await makePdf([100]);
    const broken = Uint8Array.from('this is not a pdf', (c) => c.charCodeAt(0));
    const error = await mergePdfs([
      { name: 'good.pdf', bytes: good },
      { name: 'broken.pdf', bytes: broken },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfError);
    expect(error).toMatchObject({ code: 'unreadable', fileName: 'broken.pdf' });
  });
});
