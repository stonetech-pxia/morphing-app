import { describe, expect, it } from 'vitest';

import { joinListContinuations, type DocBlock, type DocList } from './doc';
import { glyphs, renderPage, type Rect } from './test-helpers';
import type { OcrBox } from './types';
import { withBullets } from './word-bullets';

const W = 1000;
const H = 1400;
const line = (text: string, x: number, y: number, width: number, height = 28): OcrBox => ({
  text,
  x,
  y,
  width,
  height,
});

describe('list markers OCR did not read (EU sample 026, 027)', () => {
  it('puts back round bullets and dashes found left of the lines', () => {
    const rects: Rect[] = [
      // 两行圆点（8×8 的实心点，在字的半腰），两行短横。
      { x: 120, y: 110, width: 8, height: 8 },
      ...glyphs(150, 104, 400, 18),
      { x: 120, y: 170, width: 8, height: 8 },
      ...glyphs(150, 164, 300, 18),
      { x: 180, y: 313, width: 10, height: 3 },
      ...glyphs(220, 304, 400, 18),
      { x: 180, y: 373, width: 10, height: 3 },
      ...glyphs(220, 364, 300, 18),
    ];
    const lines = [
      line('Siate sintetici', 150, 100, 400),
      line('Siate chiari', 150, 160, 300),
      line('des colocations', 220, 300, 400),
      line('des locations', 220, 360, 300),
    ];
    const { lines: out, source } = withBullets(renderPage(W, H, rects), lines);
    expect(out.map((l) => l.text)).toEqual([
      '• Siate sintetici',
      '• Siate chiari',
      '- des colocations',
      '- des locations',
    ]);
    expect(out[0]!.x).toBe(120);
    expect(source.get(out[0]!)).toBe(lines[0]);
  });

  it('leaves a single stray mark and a line with a word on its left alone', () => {
    const rects: Rect[] = [
      // 只有一行左边有一个点（扫描件上的脏点）。
      { x: 120, y: 110, width: 8, height: 8 },
      ...glyphs(150, 104, 400, 18),
      // 左边是别的字（同一排前面的词）。
      ...glyphs(60, 164, 80, 18),
      ...glyphs(150, 164, 300, 18),
    ];
    const lines = [line('Siate sintetici', 150, 100, 400), line('Siate chiari', 150, 160, 300)];
    const { lines: out } = withBullets(renderPage(W, H, rects), lines);
    expect(out.map((l) => l.text)).toEqual(['Siate sintetici', 'Siate chiari']);
  });

  it('joins a hanging continuation that ended up in its own block back into the last item', () => {
    const list: DocList = {
      kind: 'list',
      ordered: false,
      items: ['Siate sintetici: il CV deve essere breve; alle volte 3'],
      box: { x: 118, y: 507, width: 1212, height: 28 },
    };
    const blocks: DocBlock[] = [
      list,
      {
        kind: 'paragraph',
        text: 'pagine possono sembrare eccessive.',
        box: { x: 148, y: 534, width: 1180, height: 53 },
      },
      {
        kind: 'paragraph',
        text: 'Un altro paragrafo.',
        box: { x: 118, y: 620, width: 400, height: 28 },
      },
    ];
    const out = joinListContinuations(blocks, 28);
    expect(out).toHaveLength(2);
    expect((out[0] as DocList).items).toEqual([
      'Siate sintetici: il CV deve essere breve; alle volte 3 pagine possono sembrare eccessive.',
    ]);
  });
});
