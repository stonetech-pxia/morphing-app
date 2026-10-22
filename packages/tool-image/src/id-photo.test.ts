import { describe, expect, it } from 'vitest';

import type { Rect } from './geometry';
import { ID_PHOTO_SPECS, layoutPrintSheet, mmToPx } from './id-photo';

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('ID_PHOTO_SPECS', () => {
  it('has unique ids and both languages', () => {
    const ids = ID_PHOTO_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of ID_PHOTO_SPECS) {
      expect(spec.label.en && spec.label.zh && spec.note.en && spec.note.zh).toBeTruthy();
    }
  });

  it('uses 300 dpi pixel sizes with the same aspect as the print size', () => {
    for (const spec of ID_PHOTO_SPECS) {
      expect(spec.widthPx).toBe(mmToPx(spec.widthMm, 300));
      expect(spec.heightPx).toBe(mmToPx(spec.heightMm, 300));
    }
  });

  it('includes the US digital spec', () => {
    const us = ID_PHOTO_SPECS.find((s) => s.id === 'us-passport');
    expect(us).toMatchObject({ widthPx: 600, heightPx: 600, maxKB: 240 });
    const one = ID_PHOTO_SPECS.find((s) => s.id === 'cn-1inch');
    expect(one).toMatchObject({ widthPx: 295, heightPx: 413 });
  });
});

describe('layoutPrintSheet', () => {
  const base = { dpi: 300, gapMm: 2, marginMm: 3, guides: false };

  it('packs 1-inch photos on a 4×6 in sheet without overlap', () => {
    const layout = layoutPrintSheet({
      ...base,
      sheet: { widthIn: 4, heightIn: 6 },
      photo: { widthMm: 25, heightMm: 35 },
    });
    expect(layout.width).toBe(1200);
    expect(layout.height).toBe(1800);
    expect(layout.rotated).toBe(false);
    expect(layout.placements).toHaveLength(12);
    const margin = mmToPx(3, 300);
    for (const [i, a] of layout.placements.entries()) {
      expect(a).toMatchObject({ width: 295, height: 413 });
      expect(a.x).toBeGreaterThanOrEqual(margin);
      expect(a.y).toBeGreaterThanOrEqual(margin);
      expect(a.x + a.width).toBeLessThanOrEqual(1200 - margin);
      expect(a.y + a.height).toBeLessThanOrEqual(1800 - margin);
      for (const b of layout.placements.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
    expect(layout.guides).toEqual([]);
  });

  it('rotates the photo when that fits more copies', () => {
    const layout = layoutPrintSheet({
      ...base,
      sheet: { widthIn: 6, heightIn: 4 },
      photo: { widthMm: 25, heightMm: 35 },
    });
    expect(layout.rotated).toBe(true);
    expect(layout.placements).toHaveLength(12);
    expect(layout.placements[0]).toMatchObject({ width: 413, height: 295 });
  });

  it('fits 2×2 in photos on a 4×6 in sheet', () => {
    const tight = layoutPrintSheet({
      sheet: { widthIn: 4, heightIn: 6 },
      dpi: 300,
      photo: { widthMm: 50.8, heightMm: 50.8 },
      gapMm: 0,
      marginMm: 0,
      guides: true,
    });
    expect(tight.placements).toHaveLength(6);
    // 两列三行：竖线 x=0,600,1200，横线 y=0,600,1200,1800
    expect(tight.guides.filter((g) => g.x1 === g.x2).map((g) => g.x1)).toEqual([0, 600, 1200]);
    expect(tight.guides.filter((g) => g.y1 === g.y2).map((g) => g.y1)).toEqual([
      0, 600, 1200, 1800,
    ]);

    const spaced = layoutPrintSheet({
      ...base,
      sheet: { widthIn: 4, heightIn: 6 },
      photo: { widthMm: 50.8, heightMm: 50.8 },
    });
    expect(spaced.placements).toHaveLength(2);
  });

  it('returns no placements when the photo is larger than the sheet', () => {
    const layout = layoutPrintSheet({
      ...base,
      guides: true,
      sheet: { widthIn: 1, heightIn: 1 },
      photo: { widthMm: 50, heightMm: 70 },
    });
    expect(layout.placements).toEqual([]);
    expect(layout.guides).toEqual([]);
  });
});
