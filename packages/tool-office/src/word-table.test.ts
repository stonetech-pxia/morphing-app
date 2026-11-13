import { describe, expect, it } from 'vitest';

import { buildDocPage, leafBlocks } from './doc';
import {
  fakeLine,
  glyphs,
  gridRects,
  renderPage,
  textConservation,
  type Rect,
} from './test-helpers';
import type { OcrBox } from './types';

const width = 1000;
const height = 1400;
const size = { width, height };
const word = (text: string, x: number, y: number, w: number): OcrBox =>
  fakeLine(text, { x, y, width: w, height: 20 }, size);
const image = (lines: readonly OcrBox[], rects: readonly Rect[] = []) =>
  renderPage(width, height, [...rects, ...lines.flatMap((l) => glyphs(l.x, l.y + 4, l.width, 12))]);

describe('Word table evidence', () => {
  it('keeps centred text inside a decorative frame editable rather than shrinking it into sparse cells', () => {
    const lines = [
      word('Certificate of achievement', 220, 150, 560),
      word('Presented to', 380, 210, 240),
      word('Amara Nwosu Fischer', 300, 270, 400),
      word('For outstanding completion of the programme', 200, 330, 600),
      word('Awarded on the fourth of November', 250, 390, 500),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 180, 820, 900], [100, 190, 250, 310, 370, 430])),
      lines,
      source: 'certificate',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    expect(
      leafBlocks(page)
        .filter((b) => b.kind === 'paragraph')
        .map((b) => b.text)
        .join(' '),
    ).toContain('Amara Nwosu Fischer');
  });

  it('does not turn answer lines into a table just because questions occupy a few cells', () => {
    const lines = [
      word('4. Explain the acceleration of the object.', 120, 230, 600),
      word('5. Explain why a net force of zero does not imply rest.', 120, 410, 650),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 800, 900], [180, 220, 280, 340, 400, 460, 520])),
      lines,
      source: 'exam',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    const text = leafBlocks(page)
      .flatMap((b) => (b.kind === 'paragraph' ? [b.text] : b.kind === 'list' ? b.items : []))
      .join(' ');
    expect(text).toContain('Explain the acceleration');
    expect(text).toContain('Explain why a net force');
    expect(text).toContain('4.');
    expect(text).toContain('5.');
  });

  it('keeps separate agenda rows separate after rejecting their decorative grid', () => {
    const lines = [
      word('Approval of previous minutes', 120, 120, 350),
      word('Roadmap status', 120, 150, 240),
      word('Pricing experiment results', 120, 180, 330),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 600, 900], [100, 140, 170, 210])),
      lines,
      source: 'agenda',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const paragraphs = leafBlocks(page)
      .filter((b) => b.kind === 'paragraph')
      .map((b) => b.text);
    expect(paragraphs).toContain(lines[0]!.text);
    expect(paragraphs).toContain(lines[1]!.text);
    expect(paragraphs).toContain(lines[2]!.text);
  });

  it('preserves sparse tables when the populated rows establish repeated column relationships', () => {
    const lines = [
      word('Name', 120, 120, 100),
      word('Due', 620, 120, 100),
      word('Alice', 120, 180, 100),
      word('2026-11-13', 620, 180, 150),
      word('Bob', 120, 240, 100),
      word('2026-11-16', 620, 240, 150),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 350, 600, 900], [100, 160, 220, 280])),
      lines,
      source: 'sparse-data',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(
      tables[0]!.table.cells
        .filter((c) => c.row === 1)
        .map((c) => c.text)
        .filter(Boolean),
    ).toEqual(['Alice', '2026-11-13']);
  });

  it('recovers a bounded text table with wide textual columns without swallowing nearby prose', () => {
    const texts = [
      ['Action', 'Owner', 'Due', 'Status'],
      ['Publish roadmap', 'L. Chen', '2026-11-13', 'Open'],
      ['Confirm assets', 'S. Duarte', '2026-11-16', 'Open'],
      ['Build dashboard', 'M. Okoro', '2026-11-18', 'In progress'],
    ];
    const xs = [120, 500, 660, 840];
    const widths = [240, 100, 140, 120];
    const lines = texts.flatMap((row, r) =>
      row.map((t, c) => word(t, xs[c]!, 600 + r * 40, widths[c]!)),
    );
    const heading = word('Discussion of the next quarter', 120, 480, 600);
    const footer = word('Next meeting on Tuesday', 120, 800, 500);
    const all = [heading, ...lines, footer];
    const page = buildDocPage({
      image: image(all),
      lines: all,
      source: 'minutes',
      skew: 0,
      regions: [
        {
          kind: 'table',
          label: 'table',
          score: 0.9,
          box: { x: 110, y: 590, width: 860, height: 160 },
        },
      ],
    });
    expect(textConservation(page, all)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    const table = tables[0]!.table;
    expect(table.rows).toBe(4);
    expect(table.cells.filter((c) => c.row === 1).map((c) => c.text)).toEqual([
      'Publish roadmap',
      'L. Chen',
      '2026-11-13',
      'Open',
    ]);
    const prose = leafBlocks(page)
      .filter((b) => b.kind === 'paragraph')
      .map((b) => b.text);
    expect(prose).toContain(heading.text);
    expect(prose).toContain(footer.text);
  });

  it('does not count a wholly empty shared column as sparse layout evidence in a merged data table', () => {
    const lines = [
      word('Item', 120, 120, 180),
      word('Reference', 470, 120, 180),
      word('A merged instruction row with its own content', 120, 180, 500),
      word('Another merged instruction row', 120, 240, 500),
      word('Final merged instruction row', 120, 300, 500),
    ];
    const page = buildDocPage({
      image: image(
        lines,
        gridRects([100, 450, 700, 900], [100, 160, 220, 280, 340], {
          skipV: [
            [1, 1],
            [1, 2],
            [1, 3],
          ],
        }),
      ),
      lines,
      source: 'merged-table',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.cells.filter((c) => c.text).map((c) => c.text)).toEqual(
      lines.map((l) => l.text),
    );
  });

  it('keeps a two-row signature table even when most cells are blank', () => {
    const lines = [word('Signature', 120, 120, 120), word('Date', 620, 120, 100)];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 350, 600, 900], [100, 160, 220])),
      lines,
      source: 'signature',
      skew: 0,
    });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(1);
  });

  it('does not create a table from an empty model proposal', () => {
    const page = buildDocPage({
      image: image([]),
      lines: [],
      source: 'empty',
      skew: 0,
      regions: [
        {
          kind: 'table',
          label: 'table',
          score: 0.9,
          box: { x: 100, y: 100, width: 800, height: 400 },
        },
      ],
    });
    expect(page.blocks).toHaveLength(0);
  });

  it('does not infer a table from widely separated prose columns without table evidence', () => {
    const lines = Array.from({ length: 4 }, (_, r) => [
      word('Left column prose goes on here.', 100, 200 + r * 30, 340),
      word('Right column prose goes on here.', 600, 200 + r * 30, 340),
    ]).flat();
    const page = buildDocPage({ image: image(lines), lines, source: 'columns', skew: 0 });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
  });

  it('keeps a blank fill-in form as a table', () => {
    const lines = ['Full name', 'Address', 'Phone', 'Email'].map((t, i) =>
      word(t, 120, 120 + i * 60, 140),
    );
    const page = buildDocPage({
      image: image(lines, gridRects([100, 350, 900], [100, 160, 220, 280, 340])),
      lines,
      source: 'blank-form',
      skew: 0,
    });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.rows).toBe(4);
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
  });

  it('keeps a sign-up sheet with a header row and empty rows as a table', () => {
    const lines = [
      word('Name', 120, 120, 100),
      word('Email', 420, 120, 100),
      word('Signature', 720, 120, 150),
    ];
    const page = buildDocPage({
      image: image(
        lines,
        gridRects(
          [100, 400, 700, 900],
          Array.from({ length: 9 }, (_, i) => 100 + i * 50),
        ),
      ),
      lines,
      source: 'sign-up',
      skew: 0,
    });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.rows).toBe(8);
    expect(tables[0]!.table.cols).toBe(3);
  });

  const prose = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      word(
        `Prose line ${String.fromCharCode(65 + i)} fills the column width here`,
        120,
        100 + i * 28,
        760,
      ),
    );

  it.each([1, 3, 6, 12])(
    'keeps every word exactly once when a decorative grid follows a %i-line paragraph',
    (n) => {
      const top = 100 + n * 28 + 4;
      const lines = [
        ...prose(n),
        word('Approval of previous minutes', 120, top + 10, 350),
        word('Roadmap status', 120, top + 40, 240),
        word('Pricing experiment results', 120, top + 70, 330),
      ];
      const page = buildDocPage({
        image: image(lines, gridRects([100, 600, 900], [top, top + 34, top + 64, top + 100])),
        lines,
        source: 'agenda-after-prose',
        skew: 0,
      });
      expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
      const paragraphs = leafBlocks(page)
        .filter((b) => b.kind === 'paragraph')
        .map((b) => b.text);
      expect(paragraphs).toContain('Roadmap status');
      expect(paragraphs.some((p) => p.includes('Prose line A') && p.includes('Approval'))).toBe(
        false,
      );
    },
  );

  it.each([1, 3, 8])(
    'keeps every word exactly once when a bounded text table follows a %i-line paragraph',
    (n) => {
      const y0 = 100 + n * 28 + 8;
      const rows = [
        ['Action', 'Owner', 'Due', 'Status'],
        ['Publish roadmap', 'L. Chen', '2026-11-13', 'Open'],
        ['Confirm assets', 'S. Duarte', '2026-11-16', 'Open'],
      ];
      const xs = [120, 500, 660, 840];
      const widths = [240, 100, 140, 120];
      const lines = [
        ...prose(n),
        ...rows.flatMap((row, r) => row.map((t, c) => word(t, xs[c]!, y0 + r * 30, widths[c]!))),
      ];
      const page = buildDocPage({
        image: image(lines),
        lines,
        source: 'table-after-prose',
        skew: 0,
        regions: [
          {
            kind: 'table',
            label: 'table',
            score: 0.9,
            box: { x: 110, y: y0 - 6, width: 860, height: 100 },
          },
        ],
      });
      const tables = leafBlocks(page).filter((b) => b.kind === 'table');
      expect(tables).toHaveLength(1);
      expect(tables[0]!.table.cells.filter((c) => c.row === 1).map((c) => c.text)).toEqual(rows[1]);
      expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    },
  );
});
