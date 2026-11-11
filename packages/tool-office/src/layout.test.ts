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

describe('parseLayout: 一张图的分数被拆给几个类别 (D-524)', () => {
  const size = { width: 960, height: 960 };
  // 模型输出（480 输入）：类别、分数、框。
  const det = (name: (typeof LAYOUT_LABELS)[number], score: number, box: number[]) => [
    label(name),
    score,
    ...box,
  ];
  const slide = [100, 150, 300, 270];

  it('keeps a figure whose score is split over image / chart / header_image on the same box', () => {
    // 真实输出（s-slides-en）：chart 0.40、image 0.35、header_image 0.16 都在同一个框上，单看都不到 0.45。
    const out = [
      ...det('chart', 0.4, slide),
      ...det('image', 0.35, slide),
      ...det('header_image', 0.16, slide),
    ];
    const regions = parseLayout(out, size);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('image');
    expect(regions[0]!.score).toBeGreaterThanOrEqual(0.45);
    expect(regions[0]!.box).toEqual({ x: 200, y: 300, width: 400, height: 240 });
  });

  it('still drops a single weak class, and the same class repeated on one box does not add up', () => {
    expect(parseLayout(det('image', 0.35, slide), size)).toEqual([]);
    expect(parseLayout([...det('image', 0.3, slide), ...det('image', 0.3, slide)], size)).toEqual(
      [],
    );
  });

  it('does not add up scores of different boxes', () => {
    const out = [
      ...det('image', 0.3, [20, 20, 120, 100]),
      ...det('chart', 0.3, [300, 300, 450, 450]),
    ];
    expect(parseLayout(out, size)).toEqual([]);
  });
});

describe('parseLayout: three-class figure corroboration', () => {
  const size = { width: 960, height: 960 };
  const box = [100, 150, 300, 270];
  const det = (name: (typeof LAYOUT_LABELS)[number], score: number, bounds = box) => [
    label(name),
    score,
    ...bounds,
  ];
  const evidence = (scores = [0.3371, 0.1318, 0.1212]) => [
    ...det('image', scores[0]!),
    ...det('chart', scores[1]!),
    ...det('header_image', scores[2]!),
  ];

  it.each([
    [0.3371, 0.1318, 0.1212],
    [0.3743, 0.1427, 0.1119],
    [0.341, 0.1103, 0.1252],
  ])('recovers an unlettered figure supported by three coincident classes (%s)', (...scores) => {
    const parsed = parseLayout(evidence(scores), size);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      kind: 'image',
      fused: true,
      box: { x: 200, y: 300, width: 400, height: 240 },
    });
    expect(cleanRegions(parsed, [], size)).toEqual(parsed);
    // 弱证据不能吞字；一个短字段也会拒收。
    expect(cleanRegions(parsed, [line('Total', 250, 350, 120)], size)).toEqual([]);
  });

  it('does not count a repeated class, two classes, or sub-floor noise as corroboration', () => {
    expect(parseLayout([...det('image', 0.34), ...det('chart', 0.13)], size)).toEqual([]);
    expect(
      parseLayout([...det('image', 0.34), ...det('chart', 0.13), ...det('chart', 0.13)], size),
    ).toEqual([]);
    expect(parseLayout(evidence([0.34, 0.13, 0.099]), size)).toEqual([]);
    expect(parseLayout(evidence([0.29, 0.14, 0.14]), size)).toEqual([]);
    expect(parseLayout(evidence([0.3, 0.11, 0.11]), size)).toEqual([]);
    expect(
      parseLayout([...det('image', 0.34), ...det('chart', 0.13), ...det('seal', 0.13)], size),
    ).toEqual([]);
  });

  it('requires tighter geometry for low-score support than legacy fusion', () => {
    // IoU 约 0.82：旧融合接受的邻框，不能用于这条更弱的恢复路径。
    expect(
      parseLayout(
        [
          ...det('image', 0.34),
          ...det('chart', 0.13),
          ...det('header_image', 0.12, [120, 150, 320, 270]),
        ],
        size,
      ),
    ).toEqual([]);
  });

  it('does not let recovered evidence replace an existing seal', () => {
    const seal = det('seal', 0.5);
    expect(parseLayout([...seal, ...evidence()], size)).toEqual(parseLayout(seal, size));
  });

  it('preserves an existing figure box and score even when weak extra classes are present', () => {
    const strong = [...det('image', 0.6, [120, 150, 320, 270])];
    const legacy = [...det('image', 0.34), ...det('chart', 0.2)];
    expect(parseLayout([...strong, ...evidence()], size)).toEqual(parseLayout(strong, size));
    expect(parseLayout([...legacy, ...det('header_image', 0.12)], size)).toEqual(
      parseLayout(legacy, size),
    );
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

  it('keeps a stamp as a picture although its ring of text reads as several lines (D-463)', () => {
    // 处方右下角的印章：一圈机构名、地址认成 4 行乱字，应该原样剪成图片，不写成乱字。
    const lines = [
      line('Centre médical & dentaire', 820, 1200, 250, 40),
      line('WPANTIMN', 840, 1250, 200, 40),
      line('Centre de santé', 860, 1290, 160, 40),
      line('93500', 900, 1330, 70, 30),
    ];
    const seal = { ...region('image', 800, 1180, 300, 200), label: 'seal' };
    const logo = region('image', 800, 1180, 300, 200);
    expect(cleanRegions([seal], lines, size)).toEqual([seal]);
    // 同样多的字在普通的图片区域里：是认错了的正文。
    expect(cleanRegions([logo], lines, size)).toEqual([]);
  });

  it('a page-sized "image" does not swallow the real figure inside it as a duplicate (D-524)', () => {
    // 手机拍的 PPT（s-slides-en-photo）：整张照片被认成图片，里面的图表也认出来了。
    const whole = region('image', 40, 50, 940, 1300, 0.61);
    const chart = region('image', 300, 300, 400, 190, 0.5);
    expect(cleanRegions([whole, chart], [], size)).toEqual([chart]);
  });

  it('a figure kept only by adding up classes is dropped when any text sits inside it (D-524)', () => {
    // 表单里一格一格的字段：短字加框线，像示意图，但分数是几个类别凑出来的，不信。
    const lines = Array.from({ length: 6 }, (_, i) => line(`Field ${i}`, 120, 300 + i * 40, 150));
    const strong = region('image', 100, 280, 500, 300, 0.6);
    const fused = { ...region('image', 100, 280, 500, 300, 0.5), fused: true };
    const ink = { width: 1000, height: 1400, data: new Uint8Array(1000 * 1400 * 4).fill(0) };
    expect(cleanRegions([strong], lines, size, ink)).toEqual([strong]);
    expect(cleanRegions([fused], lines, size, ink)).toEqual([]);
    // 一个短标志字也不行（字会被吞进图里）；没有字的留下。
    expect(cleanRegions([fused], [line('Form 9465', 120, 300, 150)], size)).toEqual([]);
    expect(cleanRegions([fused], [], size)).toEqual([fused]);
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
