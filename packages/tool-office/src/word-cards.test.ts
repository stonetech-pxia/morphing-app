import { describe, expect, it } from 'vitest';
import { buildDocPage, leafBlocks } from './doc';
import { gridRects, renderPage } from './test-helpers';
import { recoverPictureCards } from './word-cards';
import type { DocPage } from './doc';
import type { OcrBox } from './types';

function fixture(textOnFill = false, gray = false) {
  const image = renderPage(1000, 1400, gridRects([50, 350, 650, 950], [100, 600, 1100]));
  const lines: OcrBox[] = [];
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 3; col++) {
      const x = 50 + col * 300,
        y = 100 + row * 500;
      for (let yy = y + 20; yy < y + 250; yy++)
        for (let xx = x + 20; xx < x + 280; xx++) {
          const i = (yy * image.width + xx) * 4;
          image.data[i] = gray ? 220 : 55;
          image.data[i + 1] = gray ? 220 : 130;
          image.data[i + 2] = gray ? 220 : 210;
        }
      lines.push({
        text: `Item ${row * 3 + col + 1}`,
        x: x + 20,
        y: y + (textOnFill ? 80 : 300),
        width: 180,
        height: 20,
      });
      lines.push({
        text: `Code ${100 + row * 3 + col}`,
        x: x + 20,
        y: y + 335,
        width: 180,
        height: 20,
      });
    }
  return { image, lines };
}

describe('unlettered picture cards', () => {
  it.each([-100, 0, Number.NaN])(
    'does not infer pictures from uncertain shared-cell bounds (%s)',
    (width) => {
      const f = fixture();
      const box = { x: 50, y: 100, width, height: 500 };
      const page: DocPage = {
        source: 's',
        width: 1000,
        height: 1400,
        bodySize: 10,
        blocks: [
          {
            kind: 'table',
            box: { x: 50, y: 100, width: 900, height: 1000 },
            colWidths: [300, 300, 300],
            table: {
              kind: 'table',
              box,
              col: 0,
              cols: 3,
              rows: 2,
              cells: [0, 1, 2, 3].map((i) => ({
                row: Math.floor(i / 2),
                col: i % 2,
                rowSpan: 1,
                colSpan: 1,
                text: `Entry ${i}`,
                box,
              })),
            },
          },
        ],
      };
      expect(recoverPictureCards(page, f.image, f.lines, 20)).toBe(page);
    },
  );
  it('also keeps neutral pictures; grayscale is not evidence that an unlettered region is empty', () => {
    const page = buildDocPage({ ...fixture(false, true), source: 's', skew: 0 });
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(6);
  });
  it('keeps repeated pictures and their editable labels in the same source cards without image-model proposals', () => {
    const f = fixture();
    const page = buildDocPage({ ...f, source: 's', skew: 0 });
    const leaves = leafBlocks(page);
    expect(leaves.filter((b) => b.kind === 'image')).toHaveLength(6);
    expect(page.blocks.filter((b) => b.kind === 'row')).toHaveLength(2);
    for (let i = 1; i <= 6; i++)
      expect(
        leaves.filter((b) => b.kind === 'paragraph' && b.text.includes(`Item ${i}`)),
      ).toHaveLength(1);
    for (const row of page.blocks.filter((b) => b.kind === 'row'))
      for (const cell of row.cells) {
        expect(cell.blocks[0]?.kind).toBe('image');
        expect(cell.blocks[1]?.kind).toBe('paragraph');
      }
  });
  it('keeps colored fields editable instead of copying text as a picture', () => {
    const page = buildDocPage({ ...fixture(true), source: 's', skew: 0 });
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(0);
    expect(JSON.stringify(page)).toContain('Item 6');
  });
});
