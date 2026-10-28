import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { type ImagePageOptions, type TextLine, imagesToPdf } from './index';
import { makePng } from './test-helpers';
import { visualOrder } from './text-layer';

// 看不见的文字层（D-195、D-267）：用 pdf.js 从生成的 PDF 里取文字，和阅读器搜索时看到的一样。

const A4: ImagePageOptions = { pageSize: 'a4', orientation: 'auto', marginMm: 0, fit: 'contain' };
const [PAGE_W, PAGE_H] = [595.28, 841.89];

interface Found {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function textItems(bytes: Uint8Array, page = 1): Promise<Found[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const content = await (await (await task.promise).getPage(page)).getTextContent();
  await task.destroy();
  return content.items
    .filter((i) => 'str' in i && i.str.trim())
    .map((i) => {
      const item = i as { str: string; transform: number[]; width: number; height: number };
      return {
        str: item.str,
        x: item.transform[4]!,
        y: item.transform[5]!,
        width: item.width,
        height: item.height,
      };
    });
}

/** 一张 600×848 像素的图（比例和 A4 一样），放在 A4 上正好铺满，1 像素 ≈ 0.99 pt。 */
const PAGE_IMAGE = makePng(600, 848);

async function scan(lines: TextLine[][]) {
  return imagesToPdf(
    lines.map((page) => ({
      bytes: PAGE_IMAGE,
      kind: 'png' as const,
      text: { width: 600, height: 848, lines: page },
    })),
    A4,
  );
}

const line = (text: string, y: number, width = 300): TextLine => ({
  text,
  x: 60,
  y,
  width,
  height: 30,
});

describe('invisible text layer', () => {
  it('writes Chinese, Japanese, Korean and Russian lines so they can be searched', async () => {
    const lines = [
      line('合计 ¥128.00', 100),
      line('領収書 お買い上げありがとうございます', 200, 480),
      line('합계 금액', 300),
      line('Итого к оплате: 1 250 ₽', 400, 400),
      line('Total 12,50 €', 500),
      line('生僻字 𠀋𡈽 emoji 🧾', 600),
    ];
    const found = await textItems((await scan([lines])).bytes);
    expect(found.map((f) => f.str)).toEqual(lines.map((l) => l.text));
  });

  it('puts each line roughly where it was recognised', async () => {
    const lines = [line('合计 ¥128.00', 100), line('Итого к оплате', 400, 400)];
    const found = await textItems((await scan([lines])).bytes);
    const s = PAGE_W / 600;
    found.forEach((f, i) => {
      const l = lines[i]!;
      expect(f.x).toBeCloseTo(l.x * s, 0);
      // 基线在框底上方 0.2 个字高。
      expect(f.y).toBeCloseTo(PAGE_H - (l.y + l.height) * s + 0.2 * l.height * s, 0);
      expect(f.width).toBeCloseTo(l.width * s, 0);
      expect(f.height).toBeCloseTo(l.height * s, 0);
    });
  });

  it('keeps Arabic and Hebrew readable (right to left, with numbers inside)', async () => {
    const lines = [
      line('المجموع ١٢٥ ريال', 100),
      line('الفاتورة رقم 2024-17 بتاريخ', 200),
      line('סך הכול 48 ₪', 300),
    ];
    const found = await textItems((await scan([lines])).bytes);
    expect(found).toHaveLength(lines.length);
    // pdf.js 把从左往右摆的字还原成读的顺序：每个词都在，阿拉伯文、希伯来文的词按读的顺序。
    // 数字旁边的符号（₪）放在哪一边，各家取文字的程序本来就不一样，不比。
    const words = (s: string) => s.split(/\s+/).filter(Boolean);
    const rtlWords = (s: string) => words(s).filter((w) => /[\u0590-\u06ff]/.test(w));
    found.forEach((f, i) => {
      const text = lines[i]!.text;
      expect([...words(f.str)].sort()).toEqual([...words(text)].sort());
      expect(rtlWords(f.str)).toEqual(rtlWords(text));
      expect(f.x).toBeCloseTo(lines[i]!.x * (PAGE_W / 600), 0);
    });
    expect(found[1]!.str).toContain('2024-17');
  });

  it('shares one font across pages and skips empty or degenerate lines', async () => {
    const result = await scan([
      [line('第一页', 100), { ...line('   ', 200) }, { ...line('零宽', 300), width: 0 }],
      [],
      [line('第三页 page three', 100)],
    ]);
    expect((await textItems(result.bytes, 1)).map((f) => f.str)).toEqual(['第一页']);
    expect(await textItems(result.bytes, 2)).toEqual([]);
    expect((await textItems(result.bytes, 3)).map((f) => f.str)).toEqual(['第三页 page three']);
    const doc = await PDFDocument.load(result.bytes);
    const dicts = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) =>
        obj instanceof PDFDict ? obj : obj instanceof PDFRawStream ? obj.dict : null,
      );
    const subtype = (name: string) =>
      dicts.filter((d) => d?.get(PDFName.of('Subtype')) === PDFName.of(name));
    expect(subtype('Type0')).toHaveLength(1);
    expect(subtype('CIDFontType2')).toHaveLength(1);
  });

  it('leaves the font out entirely when no line has any text', async () => {
    const result = await scan([[line('   ', 100), { ...line('x', 200), height: 0 }]]);
    const doc = await PDFDocument.load(result.bytes);
    const fonts = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    expect(fonts?.keys() ?? []).toEqual([]);
    expect(await textItems(result.bytes)).toEqual([]);
  });

  it('adds about 1 KB per PDF plus a few bytes per character', async () => {
    const without = await imagesToPdf([{ bytes: PAGE_IMAGE, kind: 'png' }], A4);
    // 一页 40 行中文收据，每行 15 个字。
    const receipt = Array.from({ length: 40 }, (_, i) =>
      line(`商品${i} 单价十二元五角 数量三`, 20 * i + 10, 400),
    );
    const withText = await scan([receipt]);
    const added = withText.bytes.length - without.bytes.length;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(6000);
  });
});

describe('visualOrder', () => {
  const v = (s: string) => visualOrder([...s]).join('');

  it('leaves left-to-right lines alone', () => {
    expect(v('Total 12,50 €')).toBe('Total 12,50 €');
    expect(v('合计 ¥128')).toBe('合计 ¥128');
  });

  it('follows the Unicode bidi algorithm for right-to-left lines', () => {
    expect(v('שלום 48 ₪')).toBe('₪ 48 םולש');
    expect(v('שלום abc def')).toBe('abc def םולש');
    // 阿拉伯字母后面的数字是 AN，减号把它分成两段（W2、W4）。
    expect(v('رقم 2024-17')).toBe('17-2024 مقر');
    expect(v('التاريخ 12/05/2024')).toBe('12/05/2024 خيراتلا');
    // 从左到右的段落里夹一个阿拉伯词。
    expect(v('Invoice فاتورة 12')).toBe('Invoice 12 ةروتاف');
  });
});
