import { describe, expect, it } from 'vitest';

import { buildDocPage, leafBlocks } from './doc';
import type { LayoutRegion } from './layout';
import { fakeLine, gridRects, renderPage, type Rect } from './test-helpers';
import type { OcrBox } from './types';

const size = { width: 1000, height: 1400 };
const hint = (
  kind: LayoutRegion['kind'],
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutRegion => ({ kind, label, score: 0.9, box: { x, y, width, height } });
const line = (text: string, x: number, y: number, width: number, height = 20): OcrBox =>
  fakeLine(text, { x, y, width, height }, size);
const text = (page: ReturnType<typeof buildDocPage>) =>
  leafBlocks(page)
    .flatMap((b) =>
      b.kind === 'paragraph'
        ? [b.text]
        : b.kind === 'list'
          ? b.items
          : b.kind === 'table'
            ? b.table.cells.map((c) => c.text)
            : [],
    )
    .join(' ');
function fixture() {
  const picture = hint('image', 'image', 100, 100, 700, 240);
  const caption = hint('text', 'figure_title', 100, 365, 700, 25);
  const labels = [
    line('Encoder', 130, 125, 90),
    line('<TR><TD>1</TD><TD colspan="2">', 400, 125, 260),
    line('Structure tags', 130, 205, 130),
    line('Output boxes', 400, 205, 120),
  ];
  const outside = [
    line('Figure 1: Pipeline overview.', 100, 365, 380),
    line('Ordinary body text remains editable after the diagram.', 100, 460, 750),
    line('The next body line remains outside the preserved picture.', 100, 490, 750),
  ];
  const rects: Rect[] = gridRects([110, 300, 520, 790], [110, 180, 250, 330], { thickness: 2 });
  return {
    picture,
    caption,
    labels,
    outside,
    image: renderPage(size.width, size.height, rects),
    lines: [...labels, ...outside],
  };
}

describe('Word figure ownership', () => {
  it('preserves a captioned sparse diagram with long labels before its grid becomes a table', () => {
    const f = fixture();
    const original = f.image.data.slice();
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [f.picture, f.caption],
      source: 'original',
      skew: 0,
    });
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    expect(text(page)).toContain('Figure 1: Pipeline overview.');
    expect(text(page)).toContain('Ordinary body text remains editable');
    expect(text(page)).not.toContain('Encoder');
    expect(text(page)).not.toContain('colspan');
    expect(f.image.data.every((v, i) => v === original[i])).toBe(true);
  });

  it.each(['Figure 1 : Vue du pipeline.', '图1：流程示意图。'])(
    'recognizes the caption role across languages: %s',
    (captionText) => {
      const f = fixture();
      f.lines[f.labels.length] = line(captionText, 100, 365, 380);
      const page = buildDocPage({
        image: f.image,
        lines: f.lines,
        regions: [f.picture, f.caption],
        source: 's',
        skew: 0,
      });
      expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(1);
      expect(text(page)).toContain(captionText);
    },
  );

  it.each([1, 5])(
    'does not rasterize %i wide prose lines even with an image hint and caption',
    (count) => {
      const f = fixture();
      const prose = Array.from({ length: count }, (_, i) =>
        line(
          `Line ${i}: ordinary prose extending across this entire text region.`,
          110,
          110 + i * 40,
          670,
        ),
      );
      const page = buildDocPage({
        image: f.image,
        lines: [...prose, ...f.outside],
        regions: [f.picture, f.caption],
        source: 's',
        skew: 0,
      });
      expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(0);
      expect(text(page)).toContain('ordinary prose');
    },
  );

  it('retains editable cells when a competing table detection covers the region', () => {
    const f = fixture();
    const table = { ...f.picture, kind: 'table' as const, label: 'table' };
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [f.picture, table, f.caption],
      source: 's',
      skew: 0,
    });
    expect(leafBlocks(page).some((b) => b.kind === 'table')).toBe(true);
    expect(text(page)).toContain('Encoder');
  });

  it('keeps the label intact when a picture edge clips the last label row', () => {
    const f = fixture();
    f.lines.push(line('Model Pipeline', 400, 332, 180));
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    const pictures = leafBlocks(page).filter((b) => b.kind === 'image');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]!.box.y + pictures[0]!.box.height).toBeGreaterThanOrEqual(352);
    expect(text(page)).not.toContain('Model Pipeline');
    expect(text(page)).toContain('Figure 1:');
  });

  it('does not remove labels if later duplicate suppression rejects the protected image', () => {
    const f = fixture();
    const competing = { ...hint('image', 'image', 80, 80, 800, 500), score: 0.99, fused: true };
    const page = buildDocPage({
      image: f.image,
      lines: f.lines,
      regions: [competing, f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(text(page)).toContain('Encoder');
    expect(text(page)).toContain('Ordinary body text remains editable');
  });

  it('does not trust an image hint plus caption when there are no graphics outside OCR boxes', () => {
    const f = fixture();
    const image = renderPage(size.width, size.height, []);
    const page = buildDocPage({
      image,
      lines: f.lines,
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(text(page)).toContain('Encoder');
  });

  it('rejects a picture boundary crossing a line of adjacent prose', () => {
    const f = fixture();
    const crossing = line(
      'An adjacent paragraph must remain editable across its complete line.',
      750,
      300,
      240,
    );
    const page = buildDocPage({
      image: f.image,
      lines: [...f.lines, crossing],
      regions: [f.picture, f.caption],
      source: 's',
      skew: 0,
    });
    expect(text(page)).toContain('Encoder');
    expect(text(page)).toContain('An adjacent paragraph must remain editable');
  });

  it('keeps two captioned figures side by side instead of making their labels a bridging table', () => {
    const left = hint('image', 'image', 80, 100, 360, 240);
    const right = hint('image', 'image', 550, 100, 360, 240);
    const captions = [
      hint('text', 'figure_title', 80, 365, 360, 25),
      hint('text', 'figure_title', 550, 365, 360, 25),
    ];
    const labels = [80, 550].flatMap((x) => [
      line('Input', x + 15, 140, 75),
      line('Output', x + 180, 140, 90),
      line('Block A', x + 15, 200, 85),
      line('Block B', x + 180, 200, 90),
      line('Weight', x + 15, 260, 85),
      line('Result', x + 180, 260, 90),
    ]);
    const image = renderPage(
      size.width,
      size.height,
      [80, 550].flatMap((x) =>
        gridRects([x + 5, x + 160, x + 345], [110, 180, 240, 330], { thickness: 2 }),
      ),
    );
    const page = buildDocPage({
      image,
      lines: [
        ...labels,
        line('Figure 1: Left diagram.', 80, 365, 320),
        line('Figure 2: Right diagram.', 550, 365, 320),
      ],
      regions: [left, right, ...captions],
      source: 's',
      skew: 0,
    });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    expect(leafBlocks(page).filter((b) => b.kind === 'image')).toHaveLength(2);
    expect(
      page.blocks.some(
        (b) =>
          b.kind === 'row' &&
          b.cells.length === 2 &&
          b.cells.every((c) => c.blocks.some((p) => p.kind === 'image')),
      ),
    ).toBe(true);
    expect(text(page)).toContain('Figure 1:');
    expect(text(page)).toContain('Figure 2:');
  });

  it.each(['no caption', 'body mention', 'distant caption', 'wrong column', 'weak fusion'])(
    'keeps ambiguous inputs on their existing path: %s',
    (mode) => {
      const f = fixture();
      const caption = {
        ...f.caption,
        label: mode === 'body mention' ? 'text' : f.caption.label,
        box: {
          ...f.caption.box,
          ...(mode === 'distant caption'
            ? { y: 900 }
            : mode === 'wrong column'
              ? { x: 850, width: 100 }
              : {}),
        },
      };
      const picture = { ...f.picture, ...(mode === 'weak fusion' ? { fused: true } : {}) };
      const page = buildDocPage({
        image: f.image,
        lines: f.lines,
        regions: mode === 'no caption' ? [picture] : [picture, caption],
        source: 's',
        skew: 0,
      });
      expect(text(page)).toContain('Encoder');
      expect(text(page)).toContain('Ordinary body text remains editable');
    },
  );
});
