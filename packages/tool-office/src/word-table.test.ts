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
    // 右边空着的填写栏留着，不并进标签格（EU 样本 006）。
    for (let r = 0; r < 4; r++) {
      const row = tables[0]!.table.cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col);
      expect(row.map((c) => c.text)).toEqual([lines[r]!.text, '']);
    }
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
  });

  it('keeps a blank item grid whose headers are printed above it, with the headers as its first row', () => {
    // 发票模板的商品栏（EU 样本 001）：网格里一个字也没有，表头在网格上边线的上面。
    const headers = [
      word('Ref', 130, 76, 60),
      word('Description', 330, 76, 160),
      word('Qty', 640, 76, 50),
      word('Total', 790, 76, 80),
    ];
    const lines = [word('Please fill in the items below', 100, 20, 400), ...headers];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 250, 600, 720, 900], [100, 140, 180, 220, 260, 300])),
      lines,
      source: 'blank-items',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    const table = tables[0]!.table;
    expect(table.rows).toBe(6);
    const rows = Array.from({ length: 6 }, (_, r) =>
      table.cells
        .filter((c) => c.row === r)
        .sort((a, b) => a.col - b.col)
        .map((c) => c.text),
    );
    expect(rows[0]).toEqual(['Ref', 'Description', 'Qty', 'Total']);
    for (const row of rows.slice(1)) expect(row).toEqual(['', '', '', '']);
  });

  it('does not take a sentence above an empty grid for its header', () => {
    const lines = [word('Please list every item you return in the grid below', 110, 76, 700)];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 250, 600, 720, 900], [100, 140, 180, 220, 260])),
      lines,
      source: 'grid-under-sentence',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
  });

  it('keeps a numbered blank grid with a header row as a table (registration form)', () => {
    // 德国的登记表（EU 样本 004）：表头一排，下面每排只有左边的编号 1–4。
    const lines = [
      word('No.', 110, 112, 30),
      word('Family name', 180, 112, 160),
      word('Previous names', 480, 112, 200),
      word('First names', 730, 112, 150),
      ...[1, 2, 3, 4].map((n) => word(String(n), 115, 112 + n * 50, 14)),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 160, 460, 710, 900], [100, 150, 200, 250, 300, 350])),
      lines,
      source: 'numbered-blank-grid',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.rows).toBe(5);
    expect(tables[0]!.table.cells.filter((c) => c.row === 2).map((c) => c.text)).toEqual([
      '2',
      '',
      '',
      '',
    ]);
  });

  it('keeps an open numbered blank grid (no outer column lines, header above the first rule) as a table (EU sample 031)', () => {
    // 德国的雇主证明（EU 样本 031）：只有横线和内部列线，外边没有竖线；表头写在第一条横线上面，
    // 内部列线从表头上边画下来。
    const lines = [
      word('Nr.', 110, 70, 30),
      word('Datum von', 180, 70, 140),
      word('Datum bis', 480, 70, 140),
      word('Tage', 730, 70, 80),
      ...[1, 2, 3, 4, 5].map((n) => word(String(n), 120, 62 + n * 50, 14)),
    ];
    const ys = [100, 150, 200, 250, 300, 350];
    const page = buildDocPage({
      image: image(lines, [
        ...gridRects([100, 160, 460, 710, 900], ys, {
          skipV: ys
            .slice(1)
            .flatMap((_, r) => [[0, r] as [number, number], [4, r] as [number, number]]),
        }),
        ...[160, 460, 710].map((x) => ({ x, y: 60, width: 2, height: 40 })),
      ]),
      lines,
      source: 'open-blank-grid',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.rows).toBe(6);
    expect(tables[0]!.table.cells.filter((c) => c.row === 2).map((c) => c.text)).toEqual([
      '2',
      '',
      '',
      '',
    ]);
  });

  it('writes a framed paragraph as one paragraph in one cell (EU sample 038)', () => {
    const lines = [
      word(
        'When you use this specific form your doctor lets you be paid for your sick leave',
        130,
        120,
        740,
      ),
      word(
        'without the usual waiting days at the start, during which nothing is normally paid',
        130,
        150,
        740,
      ),
      word(
        'to you. If your employer keeps paying your salary during the leave, the employer',
        130,
        180,
        740,
      ),
      word('is paid instead of you for every prescribed day of the leave.', 130, 210, 480),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 900], [100, 250])),
      lines,
      source: 'framed-paragraph',
      skew: 0,
    });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.table.cells).toHaveLength(1);
    expect(tables[0]!.table.cells[0]!.text).not.toContain('\n');
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
  });

  it('reflows a letter in a plain frame instead of one paragraph per line (EU sample 075)', () => {
    // 只有四条边的框里是一封信：地址一排一行，「Datum」在右边，下面两段折行的正文。
    const lines = [
      word('Absender:', 130, 120, 120),
      word('Klara Beispiel', 130, 150, 170),
      word('Lindenweg 7', 130, 180, 140),
      word('Stadtwerke laut Liefervertrag', 130, 240, 330),
      word('Datum', 800, 240, 70),
      word(
        'das Landgericht hat mit Urteil vom 12. März entschieden, dass die Gebühr',
        130,
        300,
        740,
      ),
      word(
        'für die Zusendung der Rechnung auf Papier nicht zulässig war, und das gilt',
        130,
        330,
        730,
      ),
      word('auch für alle älteren Verträge.', 130, 360, 330),
      word(
        'Ich habe seit dem 1. Januar 2019 unter der Kundennummer 4711 jeden Monat',
        130,
        420,
        735,
      ),
      word(
        'zwei Euro für die Papierrechnung gezahlt und fordere den Betrag zurück von',
        130,
        450,
        738,
      ),
      word('Ihnen bis zum Ende des Monats.', 130, 480, 320),
    ];
    const page = buildDocPage({
      image: image(lines, gridRects([100, 900], [100, 520])),
      lines,
      source: 'framed-letter',
      skew: 0,
    });
    expect(leafBlocks(page).filter((b) => b.kind === 'table')).toHaveLength(0);
    const texts = leafBlocks(page).flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    expect(texts.some((t) => t.includes('Gebühr') && t.includes('älteren Verträge'))).toBe(true);
    expect(texts.some((t) => t.includes('Januar 2019') && t.includes('Ende des Monats'))).toBe(
      true,
    );
    expect(texts.some((t) => t.includes('Klara Beispiel') && t.includes('Gebühr'))).toBe(false);
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

  it('splits a framed registration form into its blank sub-tables', () => {
    // 登记表（EU 样本 004）：外框里两张表上下叠着、列不一样，连成一张又空又大的网格；分开以后各是一张空白表格。
    const lines = [
      word('No.', 108, 108, 40),
      word('Family name', 180, 108, 150),
      word('First names', 520, 108, 150),
      word('No.', 108, 268, 40),
      word('Degree', 180, 268, 90),
      word('Born on', 320, 268, 100),
      word('Place of birth', 670, 268, 180),
      ...[1, 2, 3].map((n) => word(String(n), 112, 108 + n * 40, 14)),
      ...[1, 2, 3].map((n) => word(String(n), 112, 268 + n * 40, 14)),
    ];
    const page = buildDocPage({
      image: image(lines, [
        ...gridRects([100, 160, 500, 900], [100, 140, 180, 220, 260]),
        ...gridRects([100, 160, 300, 650, 900], [260, 300, 340, 380, 420, 460]),
      ]),
      lines,
      source: 'stacked-form',
      skew: 0,
    });
    expect(textConservation(page, lines)).toEqual({ missing: [], extra: [] });
    const tables = leafBlocks(page).filter((b) => b.kind === 'table');
    expect(tables.map((t) => t.table.cells.filter((c) => c.row === 0).map((c) => c.text))).toEqual([
      ['No.', 'Family name', 'First names'],
      ['No.', 'Degree', 'Born on', 'Place of birth'],
    ]);
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
