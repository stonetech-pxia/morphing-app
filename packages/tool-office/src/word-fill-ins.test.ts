import { describe, expect, it } from 'vitest';

import { buildDocPage, leafBlocks } from './doc';
import { findLines } from './lines';
import { fakeLine, glyphs, renderPage, type Rect } from './test-helpers';
import { findFillIns, leaderDots, withFillIns } from './word-fill-ins';

const W = 1000;
const H = 1400;
const page = { width: W, height: H };
/** 一串点：每隔 pitch 一个 3×3 的点。 */
const dotRow = (x: number, y: number, width: number, pitch = 8): Rect[] =>
  Array.from({ length: Math.floor(width / pitch) }, (_, i) => ({
    x: x + i * pitch,
    y,
    width: 3,
    height: 3,
  }));

describe('fill-in lines of forms (EU sample 021, 030)', () => {
  it('finds a dotted leader after a label, but not a dashed separator', () => {
    const image = renderPage(W, H, [
      ...glyphs(100, 200, 150, 18),
      ...dotRow(260, 215, 600),
      // 虚线的短划（扁的）：分隔线。
      ...Array.from({ length: 60 }, (_, i) => ({ x: 100 + i * 12, y: 400, width: 7, height: 2 })),
    ]);
    const { dots } = leaderDots(image, [], 24);
    expect(dots).toHaveLength(1);
    expect(dots[0]!.x).toBeCloseTo(260, -1);
    expect(dots[0]!.x + dots[0]!.width).toBeGreaterThan(850);
  });

  it('puts the leader after its label and a leader inside a line in its place', () => {
    const label = fakeLine('Name ...', { x: 100, y: 200, width: 180, height: 24 }, page, true);
    // 「from」在 100–180、「to」在 480–520：中间的点识别成两个空格（字的位置按 CTC 给）。
    const xs = [110, 130, 150, 170, 300, 400, 490, 510];
    const inner = {
      text: 'from  to',
      x: 100,
      y: 300,
      width: 420,
      height: 24,
      chars: [...'from  to'].map((text, i) => ({ text, at: (xs[i]! - 100) / 420 })),
    };
    const fills = [
      { kind: 'dots' as const, x: 240, y: 218, width: 600, height: 3 },
      // 「from」和「to」之间的点（识别读成两个空格）。
      { kind: 'dots' as const, x: 260, y: 318, width: 200, height: 3 },
      // 一排里没有字的点线自成一行。
      { kind: 'dots' as const, x: 100, y: 418, width: 700, height: 3 },
    ];
    const { lines, source } = withFillIns([label, inner], fills, 24);
    const named = lines.find((l) => l.text.startsWith('Name'))!;
    expect(named.text).toMatch(/^Name \.{20,}$/);
    expect(named.x + named.width).toBeCloseTo(840, 0);
    expect(named.height).toBe(24);
    expect(source.get(named)).toBe(label);
    expect(lines.find((l) => l.text.startsWith('from'))!.text).toMatch(/^from \.{10,} to$/);
    const alone = lines.find((l) => !source.has(l) && l !== label && l !== inner)!;
    expect(alone.text).toMatch(/^\.{20,}$/);
  });

  it('takes a solid answer line right of a label, not a text underline or a frame edge', () => {
    const rects: Rect[] = [
      // 标签和它右边的答题线（L 形：左边一小截竖线）。
      ...glyphs(100, 200, 120, 18),
      { x: 400, y: 219, width: 450, height: 2 },
      { x: 400, y: 211, width: 2, height: 10 },
      // 字的下划线。
      ...glyphs(100, 300, 300, 18),
      { x: 100, y: 321, width: 300, height: 2 },
      // 一节的外框：标题压在上边上，两头连着竖线。
      ...glyphs(100, 492, 150, 18),
      { x: 260, y: 500, width: 600, height: 2 },
      { x: 858, y: 500, width: 2, height: 200 },
    ];
    const image = renderPage(W, H, rects);
    const lines = [
      fakeLine('Street', { x: 100, y: 198, width: 120, height: 22 }, page),
      fakeLine('Underlined title', { x: 100, y: 298, width: 300, height: 22 }, page),
      fakeLine('Section', { x: 100, y: 490, width: 150, height: 22 }, page),
    ];
    const fills = findFillIns(image, [], findLines(image, { light: true }), lines, 22, []);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.kind).toBe('rule');
    expect(fills[0]!.x).toBeCloseTo(400, -1);
    const out = withFillIns(lines, fills, 22).lines;
    expect(out[0]!.text).toMatch(/^Street _{10,}$/);
  });

  it('takes the last answer line of a framed row that runs into the right side of the frame (EU sample 046)', () => {
    // 一节表单的外框（左右两条竖边）；一排「Localidad ____ C.P. ____ Provincia ____」，最后一条线画到框的右边。
    const rects: Rect[] = [
      { x: 60, y: 150, width: 2, height: 200 },
      { x: 940, y: 150, width: 2, height: 200 },
      { x: 60, y: 150, width: 882, height: 2 },
      { x: 60, y: 348, width: 882, height: 2 },
      ...glyphs(80, 200, 100, 18),
      { x: 200, y: 219, width: 300, height: 2 },
      ...glyphs(520, 200, 50, 18),
      { x: 590, y: 219, width: 120, height: 2 },
      ...glyphs(730, 200, 100, 18),
      { x: 850, y: 219, width: 91, height: 2 },
    ];
    const image = renderPage(W, H, rects);
    const lines = [
      fakeLine('Localidad', { x: 80, y: 198, width: 100, height: 22 }, page),
      fakeLine('C.P.', { x: 520, y: 198, width: 50, height: 22 }, page),
      fakeLine('Provincia', { x: 730, y: 198, width: 100, height: 22 }, page),
    ];
    const fills = findFillIns(image, [], findLines(image, { light: true }), lines, 22, []);
    expect(fills.map((f) => Math.round(f.x / 10) * 10).sort((a, b) => a - b)).toEqual([
      200, 590, 850,
    ]);
  });

  it('takes a light grey answer line, but not the edge of a shaded row (EU sample 001, 025)', () => {
    const rects: Rect[] = [
      // 浅灰（#bbb）的填写线，左边是标签。
      ...glyphs(100, 200, 120, 18),
      { x: 300, y: 219, width: 300, height: 2, shade: 187 },
      // 浅色底纹的一排（绿底接着灰底），左边也有字：底纹的边不是填写线。
      ...glyphs(100, 400, 120, 18),
      { x: 300, y: 380, width: 600, height: 40, shade: 237 },
      { x: 300, y: 420, width: 600, height: 40, shade: 187 },
    ];
    const image = renderPage(W, H, rects);
    const lines = [
      fakeLine('Subtotal', { x: 100, y: 198, width: 120, height: 22 }, page),
      fakeLine('Total HT', { x: 100, y: 398, width: 120, height: 22 }, page),
    ];
    const fills = findFillIns(image, [], findLines(image, { light: true }), lines, 22, []);
    expect(fills.map((f) => Math.round(f.y / 10) * 10)).toEqual([220]);
  });

  it('keeps label lines with leaders as separate lines, before the captions under them', () => {
    // 两行「标签 + 点线」，第一行下面居中一行说明；点线不见了时两行标签会接成一段、说明排到后面。
    const rects: Rect[] = [
      ...glyphs(100, 200, 160, 18),
      ...dotRow(270, 215, 620),
      ...glyphs(400, 250, 220, 18),
      ...glyphs(100, 300, 100, 18),
      ...dotRow(210, 315, 680),
    ];
    const image = renderPage(W, H, rects);
    const lines = [
      fakeLine('Parents names', { x: 100, y: 198, width: 160, height: 22 }, page, true),
      fakeLine('(first name, surname)', { x: 400, y: 248, width: 220, height: 22 }, page, true),
      fakeLine('Born on', { x: 100, y: 298, width: 100, height: 22 }, page, true),
    ];
    const doc = buildDocPage({ image, lines, source: 'x' });
    const texts = leafBlocks(doc).flatMap((b) => (b.kind === 'paragraph' ? [b.text] : []));
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/^Parents names \.{20,}$/);
    expect(texts[1]).toBe('(first name, surname)');
    expect(texts[2]).toMatch(/^Born on \.{20,}$/);
  });
});
