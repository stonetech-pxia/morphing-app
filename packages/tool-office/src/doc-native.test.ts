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
  it.each([1, 2, 3])(
    'upgrades version %s losslessly to the graphics-capable document format',
    (version) => {
      const p = page();
      const doc = parseDocDoc(JSON.stringify({ version, pages: [p] }));
      expect(doc).toEqual({ version: 4, pages: [p] });
    },
  );
});
