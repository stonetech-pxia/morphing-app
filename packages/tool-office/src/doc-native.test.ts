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
  it('uses real spaces for old figure flow and retains editable body and native text colors', () => {
    const p = applyNativeGraphics(
      page(),
      {
        owned: [box],
        colors: [{ box: { x: 20, y: 120, width: 200, height: 20 }, color: 'FFFFFF' }],
      },
      'graphics.png',
    );
    expect(p.blocks.map((b) => b.kind)).toEqual(['image', 'space', 'paragraph']);
    expect(p.blocks[0]).toMatchObject({ background: true, src: 'graphics.png' });
    expect(p.blocks[2]).toMatchObject({ text: 'Editable body', color: 'FFFFFF' });
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
  it('does not suppress a paragraph mixing figure labels with body text', () => {
    const p = page();
    p.blocks = [
      {
        kind: 'paragraph',
        box: { x: 20, y: 40, width: 100, height: 100 },
        text: 'Seal\nThis is the body',
      },
    ];
    expect(applyNativeGraphics(p, { owned: [box], colors: [] }, 'g.png').blocks[1]).toMatchObject({
      kind: 'paragraph',
      text: 'Seal\nThis is the body',
    });
  });
  it('suppresses a wholly owned graphic label without replacing its text line with a taller image space', () => {
    const p = page();
    p.blocks = [
      { kind: 'paragraph', text: 'BADGE', size: 8, box },
      { kind: 'paragraph', text: 'Body', box: { ...box, y: 150 } },
    ];
    const next = applyNativeGraphics(p, { owned: [box], colors: [] }, 'g.png');
    expect(next.blocks[1]).toMatchObject({ kind: 'paragraph', text: '', size: 8, box });
  });
  it('trims only trailing graphic labels and spaces, including an otherwise empty final layout row', () => {
    const p = page();
    p.blocks.push({
      kind: 'row',
      box: { ...box, y: 700 },
      cells: [
        { width: 200, blocks: [{ kind: 'paragraph', text: 'BADGE', box: { ...box, y: 700 } }] },
      ],
    });
    const next = applyNativeGraphics(p, { owned: [{ ...box, y: 700 }], colors: [] }, 'g.png');
    expect(next.blocks.at(-1)).toMatchObject({ kind: 'paragraph', text: 'Editable body' });
  });
  it('writes a page-sized drawing behind editable body, without consuming a page of flow', () => {
    const p = applyNativeGraphics(page(), { owned: [box], colors: [] }, 'g.png');
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const zip = unzipSync(
      writeDocx(
        { version: 3, pages: [p] },
        new Map([['g.png', { bytes, width: 600, height: 800 }]]),
      ),
    );
    const xml = strFromU8(zip['word/document.xml']!);
    expect(xml).toContain('behindDoc="1"');
    expect(xml).toContain('<wp:posOffset>0</wp:posOffset>');
    expect(xml).toContain('cx="7620000" cy="10160000"');
    expect(xml).toContain('Editable body');
    expect(xml).not.toContain('crop.jpg');
  });
  it('does not grow a selected original crop to the full background or remove that background', () => {
    const p = applyNativeGraphics(page(), { owned: [box], colors: [] }, 'g.png');
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
    const next = applyNativeGraphics(p, { owned: [], colors: [] }, 'g.png');
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
  it.each([1, 2])(
    'upgrades version %s losslessly to the graphics-capable document format',
    (version) => {
      const p = page();
      const doc = parseDocDoc(JSON.stringify({ version, pages: [p] }));
      expect(doc).toEqual({ version: 3, pages: [p] });
    },
  );
});
