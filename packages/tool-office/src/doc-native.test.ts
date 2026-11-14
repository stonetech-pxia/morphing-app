import { describe, expect, it } from 'vitest';
import { applyNativeGraphics, canUseNativeGraphics } from './doc-native';
import { originalArea, swapToOriginal, parseDocDoc } from './doc-edit';
import { writeDocx } from './docx';
import { unzipSync, strFromU8 } from 'fflate';
import type { DocPage } from './doc';
const box = { x: 20, y: 40, width: 100, height: 30 };
const page = (): DocPage => ({
  source: 'page.jpg',
  width: 600,
  height: 800,
  bodySize: 11,
  paper: { width: 600, height: 800 },
  blocks: [
    { kind: 'image', box, src: 'crop.jpg' },
    { kind: 'paragraph', box: { x: 20, y: 120, width: 200, height: 20 }, text: 'Editable body' },
  ],
});
describe('local source PDF graphics', () => {
  it('binds native crops to inline figures and retains editable body and text colors', () => {
    const p = applyNativeGraphics(
      page(),
      {
        owned: [box],
        colors: [{ box: { x: 20, y: 120, width: 200, height: 20 }, color: '114477' }],
      },
      ['figure.png'],
    );
    expect(p.blocks.map((b) => b.kind)).toEqual(['image', 'paragraph']);
    expect(p.blocks[0]).toMatchObject({ src: 'figure.png' });
    expect(p.blocks[0]).not.toHaveProperty('background');
    expect(p.blocks[1]).toMatchObject({ text: 'Editable body', color: '114477' });
  });
  it('does not take the colour of a big watermark letter lying across a short line (EU sample 080)', () => {
    // 「6 kVA」是黑字；斜着的大水印字母（浅灰）的框把它整个盖住，重叠面积比黑字自己的框大。
    const line = { x: 300, y: 300, width: 60, height: 14 };
    const p = applyNativeGraphics(
      {
        ...page(),
        blocks: [{ kind: 'paragraph', box: line, text: '6 kVA' }],
      },
      {
        owned: [],
        colors: [
          { box: { x: 302, y: 301, width: 40, height: 12 }, color: '000000' },
          { box: { x: 150, y: 100, width: 400, height: 500 }, color: 'D9DFDE' },
        ],
      },
      [],
    );
    expect(p.blocks[0]).toMatchObject({ text: '6 kVA', color: '000000' });
  });
  it('keeps the colour of a text run that spans two lines over a small coloured badge in the line (EU sample 068)', () => {
    // 「11 Dégâts apparents au / véhicule A」：深色字的字框跨两行，行首是一个蓝色的小编号框。
    const line = { x: 85, y: 300, width: 170, height: 20 };
    const p = applyNativeGraphics(
      { ...page(), blocks: [{ kind: 'paragraph', box: line, text: '11 Dégâts apparents au' }] },
      {
        owned: [],
        colors: [
          { box: { x: 106, y: 300, width: 150, height: 40 }, color: '2C2E35' },
          { box: { x: 85, y: 300, width: 20, height: 20 }, color: '0EB4E8' },
        ],
      },
      [],
    );
    expect(p.blocks[0]).toMatchObject({ color: '2C2E35' });
  });
  it('maps native boxes by the source PDF page size when the Word paper was fitted to A4', () => {
    // PDF 页是 2400 × 3200 点，Word 的纸缩成了 600 × 800（fitPaper）：原生框仍按 PDF 的点换成像素。
    const p = applyNativeGraphics(
      page(),
      {
        owned: [{ x: 80, y: 160, width: 400, height: 120 }],
        colors: [],
        paper: { width: 2400, height: 3200 },
      },
      ['figure.png'],
    );
    expect(p.blocks[0]).toMatchObject({ src: 'figure.png' });
  });
  it('paints the whole editable field cell only when the source fill covers that cell', () => {
    const cell = { x: 20, y: 120, width: 300, height: 60 },
      line = { x: 30, y: 135, width: 120, height: 20 };
    const p: DocPage = {
      ...page(),
      blocks: [
        {
          kind: 'table',
          box: cell,
          colWidths: [300],
          cellLayout: [{ row: 0, col: 0, lines: [line] }],
          table: {
            kind: 'table',
            box: cell,
            col: 0,
            cols: 1,
            rows: 1,
            cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'Editable value', box: cell }],
          },
        },
      ],
    };
    const filled = applyNativeGraphics(
      p,
      { owned: [], colors: [], fills: [{ box: cell, color: 'CCD7FF' }] },
      [],
    );
    const xml = strFromU8(
      unzipSync(writeDocx({ version: 4, pages: [filled] }))['word/document.xml']!,
    );
    expect(xml).toMatch(
      /<w:tcPr>[^]*?<w:shd w:val="clear" w:color="auto" w:fill="CCD7FF"\/>[^]*?<\/w:tcPr>/,
    );
    const stripe = applyNativeGraphics(
      p,
      { owned: [], colors: [], fills: [{ box: line, color: 'CCD7FF' }] },
      [],
    );
    const stripeXml = strFromU8(
      unzipSync(writeDocx({ version: 4, pages: [stripe] }))['word/document.xml']!,
    );
    expect(stripeXml.match(/<w:tcPr>[^]*?<\/w:tcPr>/)?.[0]).not.toContain('CCD7FF');
    expect(stripeXml).toContain('w:fill="CCD7FF"');
  });
  it('counts overlapping pieces of one thick edge once, so a narrow cell beside it stays unfilled (EU sample 016)', () => {
    // 25 像素宽的编号列；它左边的粗黑边画了两遍（每格一段、整张表一段），框各往外放宽了几个像素，
    // 各盖住这一格的一半多一点：加起来过了八成，其实合起来只盖住一半。
    const cell = { x: 132, y: 100, width: 25, height: 30 };
    const p: DocPage = {
      ...page(),
      blocks: [
        {
          kind: 'table',
          box: cell,
          colWidths: [25],
          table: {
            kind: 'table',
            box: cell,
            col: 0,
            cols: 1,
            rows: 1,
            cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, text: '1.', box: cell }],
          },
        },
      ],
    };
    const fill = (boxes: (typeof cell)[]) => {
      const fills = boxes.map((b) => ({ box: b, color: '000000' }));
      const out = applyNativeGraphics(p, { owned: [], colors: [], fills }, []).blocks[0]!;
      return out.kind === 'table' ? out.cellLayout?.[0]?.fill : undefined;
    };
    const edge = { x: 127, y: 95, width: 17, height: 40 };
    expect(fill([edge, { ...edge, y: 98 }])).toBeUndefined();
    // 两块同色的底并排盖满这一格：照旧是这一格的底色。
    expect(
      fill([
        { x: 120, y: 90, width: 26, height: 50 },
        { x: 146, y: 90, width: 20, height: 50 },
      ]),
    ).toBe('000000');
  });

  it('moves a dark header band with its white editable text, rather than leaving white text on white paper', () => {
    const body = { x: 20, y: 120, width: 200, height: 20 };
    const p = applyNativeGraphics(
      page(),
      {
        owned: [],
        colors: [{ box: body, color: 'FFFFFF' }],
        fills: [{ box: { x: 0, y: 115, width: 600, height: 30 }, color: '123A6B' }],
      },
      [],
    );
    expect(p.blocks[1]).toMatchObject({ text: 'Editable body', color: 'FFFFFF', fill: '123A6B' });
    const xml = strFromU8(unzipSync(writeDocx({ version: 4, pages: [p] }))['word/document.xml']!);
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="123A6B"/>');
    expect(xml).not.toContain('<wp:anchor');
    expect(
      applyNativeGraphics(page(), { owned: [], colors: [{ box: body, color: 'FFFFFF' }] }, [])
        .blocks[1],
    ).toMatchObject({ color: '000000' });
  });
  it('shades text that spans two cards of one colour with the cards, not with the page fill under them', () => {
    // 深色整页底上两张黄色圆角卡片；「DATE	DOORS」一段横跨两张卡片（各自都盖不住这一段的八成）。
    const text = { x: 60, y: 600, width: 170, height: 30 };
    const p = applyNativeGraphics(
      { ...page(), blocks: [{ kind: 'paragraph', box: text, text: 'DATE\tDOORS' }] },
      {
        owned: [],
        colors: [{ box: text, color: '1B2A49' }],
        fills: [
          { box: { x: 0, y: 0, width: 600, height: 800 }, color: '1B2A49' },
          { box: { x: 50, y: 590, width: 110, height: 50 }, color: 'FFC857' },
          { box: { x: 165, y: 590, width: 70, height: 50 }, color: 'FFC857' },
        ],
      },
      [],
      'g.png',
    );
    expect(p.blocks[1]).toMatchObject({ color: '1B2A49', fill: 'FFC857' });
  });
  it('does not shade black text with the black frame drawn around it (EU sample 062)', () => {
    // 表单的边框是 PDF 里的黑色实心框，上面再盖白色的框；标签贴着边框，白框盖不到它的八成。
    const label = { x: 60, y: 297, width: 120, height: 22 };
    const fills = [
      { box: { x: 50, y: 296, width: 500, height: 70 }, color: '000000' },
      { box: { x: 52, y: 302, width: 496, height: 62 }, color: 'FFFFFF' },
    ];
    const p = applyNativeGraphics(
      { ...page(), blocks: [{ kind: 'paragraph', box: label, text: '10. Nazwisko' }] },
      { owned: [], colors: [{ box: label, color: '000000' }], fills },
      [],
    );
    expect(p.blocks[0]).toMatchObject({ text: '10. Nazwisko', color: '000000' });
    expect(p.blocks[0]).not.toHaveProperty('fill');
  });
  it('retains the established editable layout for a rotated table', () => {
    const p = page();
    p.blocks = [
      {
        kind: 'table',
        direction: 'tbRl',
        box,
        colWidths: [100],
        table: {
          kind: 'table',
          box,
          col: 0,
          cols: 1,
          rows: 1,
          cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, text: 'Rotated body' }],
        },
      },
    ];
    expect(canUseNativeGraphics(p)).toBe(false);
    expect(canUseNativeGraphics(page())).toBe(true);
  });
  it('never removes editable text when associating crop resources', () => {
    const p = page();
    p.blocks.push({ kind: 'paragraph', box, text: 'Editable caption' });
    const next = applyNativeGraphics(p, { owned: [box], colors: [] }, ['figure.png']);
    expect(next.blocks.at(-1)).toMatchObject({ kind: 'paragraph', text: 'Editable caption' });
  });
  it('writes semantic images inline without a page-fixed drawing behind the table or body', () => {
    const p = applyNativeGraphics(page(), { owned: [box], colors: [] }, ['g.png']);
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const zip = unzipSync(
      writeDocx(
        { version: 3, pages: [p] },
        new Map([['g.png', { bytes, width: 100, height: 30 }]]),
      ),
    );
    const xml = strFromU8(zip['word/document.xml']!);
    expect(xml).toContain('<wp:inline');
    expect(xml).not.toContain('<wp:anchor');
    expect(xml).toContain('Editable body');
  });
  it('does not grow a selected original crop to the full background or remove that background', () => {
    const p = applyNativeGraphics(page(), { owned: [box], colors: [] }, ['figure.png'], 'g.png');
    const doc = { version: 3 as const, pages: [p] };
    const selected = { x: 20, y: 120, width: 200, height: 20 };
    const area = originalArea(doc, 0, [selected])!;
    expect(area.width).toBeLessThan(600);
    const next = swapToOriginal(doc, 0, [selected], { src: 'selection.jpg', box: area });
    expect(next.pages[0]!.blocks[0]).toEqual(p.blocks[0]);
  });
  it('anchors the background outside layout-table cells, including vertical text', () => {
    const p = page();
    p.blocks = [
      {
        kind: 'row',
        box,
        cells: [{ width: 200, blocks: [{ kind: 'paragraph', text: 'Editable body', box }] }],
      },
    ];
    const next = applyNativeGraphics(p, { owned: [], colors: [] }, [], 'g.png');
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const zip = unzipSync(
      writeDocx(
        { version: 3, pages: [next] },
        new Map([['g.png', { bytes: png, width: 600, height: 800 }]]),
      ),
    );
    const xml = strFromU8(zip['word/document.xml']!);
    const before = xml.slice(0, xml.indexOf('<wp:anchor'));
    expect((before.match(/<w:tc>/g) || []).length).toBe((before.match(/<\/w:tc>/g) || []).length);
  });
  it('keeps page boundaries for background-only pages with legacy default paper', () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const p = page();
    delete p.paper;
    p.blocks = [
      {
        kind: 'image',
        background: true,
        src: 'g.png',
        box: { x: 0, y: 0, width: 600, height: 800 },
      },
    ];
    const zip = unzipSync(
      writeDocx(
        { version: 3, pages: [p, p] },
        new Map([['g.png', { bytes: png, width: 600, height: 800 }]]),
      ),
    );
    const xml = strFromU8(zip['word/document.xml']!);
    expect(xml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
  });
  it.each([1, 2, 3, 4])(
    'upgrades version %s losslessly to the graphics-capable document format',
    (version) => {
      const p = page();
      const doc = parseDocDoc(JSON.stringify({ version, pages: [p] }));
      expect(doc).toEqual({ version: 5, pages: [p] });
    },
  );
});
