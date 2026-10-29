import { describe, expect, it } from 'vitest';

import {
  LAYOUT_INPUT,
  LAYOUT_LABELS,
  assignLines,
  cleanRegions,
  layoutInput,
  parseLayout,
  readingOrder,
  type LayoutRegion,
} from './layout';
import type { OcrBox } from './types';

const label = (name: (typeof LAYOUT_LABELS)[number]) => LAYOUT_LABELS.indexOf(name);
const line = (text: string, x: number, y: number, width: number, height = 20): OcrBox => ({
  text,
  x,
  y,
  width,
  height,
});
const region = (
  kind: LayoutRegion['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
  score = 0.9,
): LayoutRegion => ({ kind, label: kind, score, box: { x, y, width, height } });

describe('layoutInput', () => {
  it('resizes to side × side without keeping the aspect ratio and normalises each channel (CHW)', () => {
    // 左半边纯红、右半边纯白的 200×100 图。
    const width = 200;
    const height = 100;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        data.set(x < 100 ? [255, 0, 0, 255] : [255, 255, 255, 255], o);
      }
    const side = 8;
    const t = layoutInput({ width, height, data }, side);
    expect(t.length).toBe(3 * side * side);
    const plane = side * side;
    // 左上角：红 → R 通道 (1 − 0.485) / 0.229，G 通道 (0 − 0.456) / 0.224。
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 3);
    expect(t[plane]).toBeCloseTo((0 - 0.456) / 0.224, 3);
    // 右上角：白（宽被压缩一半，不保持宽高比）。
    expect(t[plane + side - 1]).toBeCloseTo((1 - 0.456) / 0.224, 3);
    expect(t[2 * plane + (side - 1) * side + side - 1]).toBeCloseTo((1 - 0.406) / 0.225, 3);
  });
});

describe('parseLayout', () => {
  it('maps model boxes back to the image, keeps useful classes and drops weak detections', () => {
    const size = { width: 960, height: 1920 };
    const out = [
      // 正文：480 输入里 (48, 48)–(240, 96) → 原图 x × 2，y × 4。
      label('text'),
      0.8,
      48,
      48,
      240,
      96,
      // 低分的正文（0.3 以下）不要。
      label('text'),
      0.2,
      0,
      0,
      100,
      100,
      // 图片要 0.45 以上：0.4 的不要。
      label('image'),
      0.4,
      10,
      10,
      50,
      50,
      label('doc_title'),
      0.5,
      10,
      0,
      400,
      20,
      label('number'),
      0.6,
      230,
      460,
      250,
      470,
      // NMS 补的空行（类别 −1）。
      -1,
      0,
      0,
      0,
      0,
      0,
    ];
    const regions = parseLayout(out, size);
    expect(regions.map((r) => [r.kind, r.label])).toEqual([
      ['text', 'text'],
      ['title', 'doc_title'],
      ['pageNumber', 'number'],
    ]);
    expect(regions[0]!.box).toEqual({ x: 96, y: 192, width: 384, height: 192 });
    expect(LAYOUT_INPUT).toBe(480);
  });
});

describe('cleanRegions', () => {
  const size = { width: 1000, height: 1400 };

  it('keeps a logo but not an "image" full of body text or covering half the page', () => {
    const lines = [
      line('LCL', 60, 60, 80),
      line('Nous avons le plaisir de vous communiquer votre code', 100, 500, 700),
      line('d’accès personnel. Par téléphone ou, à tout moment', 100, 530, 700),
      line('par Internet, sur smartphone ou sur tablette', 100, 560, 700),
      line('il vous permet, en toute simplicité', 100, 590, 700),
    ];
    const logo = region('image', 50, 50, 150, 100);
    const textAsImage = region('image', 90, 490, 720, 140);
    const wholePage = region('image', 0, 0, 1000, 1300);
    const kept = cleanRegions([logo, textAsImage, wholePage], lines, size);
    expect(kept).toEqual([logo]);
  });

  it('drops table regions (tables come from ruled lines) and duplicate image regions', () => {
    const a = region('image', 50, 50, 150, 100, 0.8);
    const b = region('image', 55, 52, 150, 100, 0.7);
    const table = region('table', 0, 300, 1000, 300);
    const text = region('text', 0, 700, 1000, 100);
    expect(cleanRegions([b, a, table, text], [], size)).toEqual([a, text]);
  });
});

describe('assignLines', () => {
  it('puts each line in the region holding most of it, the smaller one on a tie, or none', () => {
    const regions = [
      { box: { x: 0, y: 0, width: 1000, height: 500 } },
      { box: { x: 0, y: 0, width: 1000, height: 60 } },
    ];
    const lines = [
      line('title', 100, 20, 300),
      line('body', 100, 200, 300),
      line('outside', 100, 800, 300),
      // 只有一小半在区域里：不算。
      line('edge', 100, 490, 300),
    ];
    expect(assignLines(lines, regions)).toEqual([1, 0, -1, -1]);
  });
});

describe('readingOrder', () => {
  const item = (id: string, x: number, y: number, width: number, height: number) => ({
    id,
    box: { x, y, width, height },
  });

  it('reads a full-width title, then two columns left before right, then the footer', () => {
    const items = [
      item('right-1', 520, 100, 400, 200),
      item('left-2', 80, 320, 400, 200),
      item('footer', 80, 1300, 840, 30),
      item('title', 80, 20, 840, 50),
      item('left-1', 80, 100, 400, 180),
      item('right-2', 520, 330, 400, 400),
    ];
    expect(readingOrder(items).map((i) => i.id)).toEqual([
      'title',
      'left-1',
      'left-2',
      'right-1',
      'right-2',
      'footer',
    ]);
  });

  it('reads blocks on the same band left to right (letter head: address left, date right)', () => {
    const items = [item('date', 600, 100, 300, 30), item('address', 80, 90, 300, 90)];
    expect(readingOrder(items).map((i) => i.id)).toEqual(['address', 'date']);
  });
});
