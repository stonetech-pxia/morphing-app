import { PDF_GRAPHICS_SCRIPT } from '../packs/pages/pdf-graphics';

// 对真实固定页面中的分析函数喂独立几何；不替换 PDF.js 的绘图路径。
const plan = new Function('handlers', PDF_GRAPHICS_SCRIPT + ';return planNativeGraphics;')({});
const decoration = new Function('handlers', PDF_GRAPHICS_SCRIPT + ';return decorativeOperation;')(
  {},
);
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const text = (i: number, b: ReturnType<typeof box>, value = 'Editable body') => ({
  i,
  box: b,
  text: value,
  color: 'FFFFFF',
  alpha: 1,
  mode: 0,
});
const input = {
  width: 600,
  height: 800,
  lines: [{ ...box(20, 40, 160, 20), chars: 12 }],
  figures: [],
};
describe('digital PDF graphics ownership', () => {
  it('keeps the bounding-box quantization margin without owning the adjacent caption', () => {
    const pad = new Function('handlers', PDF_GRAPHICS_SCRIPT + ';return padGraphicBoxes;')({});
    const b = box(100, 200, 200, 100),
      caption = { ...box(100, 302, 200, 12), chars: 20 };
    const [crop] = pad([b], [caption], 600, 800);
    expect(crop.x).toBeLessThan(b.x);
    expect(crop.y).toBeLessThan(b.y);
    expect(crop.x + crop.width).toBeGreaterThan(b.x + b.width);
    expect(Math.max(0, crop.y + crop.height - caption.y) / caption.height).toBeLessThan(0.4);
  });
  it('does not leave a form grid or an internal colored header in a page-fixed background', () => {
    const full = box(0, 0, 600, 800);
    expect(decoration({ rectangle: true, fill: true, box: box(0, 0, 600, 800) }, full)).toBe(true);
    expect(decoration({ rectangle: true, box: box(25, 150, 550, 620) }, full)).toBe(false);
    expect(decoration({ fill: true, rectangle: true, box: box(20, 220, 550, 16) }, full)).toBe(
      false,
    );
    expect(decoration({ name: 'constructPath', box: full }, full)).toBe(false);
  });
  it('joins the bitmap pieces of a confirmed diagram while leaving its caption editable', () => {
    const figure = box(300, 150, 250, 180),
      caption = box(300, 340, 250, 20);
    const result = plan(
      [
        text(1, box(20, 40, 160, 20)),
        { i: 2, image: true, box: box(330, 200, 30, 30) },
        { i: 3, image: true, box: box(450, 230, 30, 30) },
        text(4, box(320, 165, 100, 15), 'Encoder'),
        text(5, caption, 'Figure: editable caption'),
      ],
      { ...input, candidates: [figure] },
    );
    expect(result.owned).toEqual([figure]);
    expect([...result.keep]).toEqual([4]);
  });
  it('keeps body text out of the background and passes native text colors', () => {
    const result = plan(
      [text(1, box(20, 40, 160, 20)), { i: 2, image: true, box: box(50, 150, 200, 120) }],
      input,
    );
    expect(result.keep.size).toBe(0);
    expect(result.colors).toEqual([{ box: box(20, 40, 160, 20), color: 'FFFFFF' }]);
    expect(result.owned).toContainEqual(box(50, 150, 200, 120));
  });
  it('declines scans with invisible text and mixed pages with uncovered OCR', () => {
    expect(
      plan(
        [
          { ...text(1, box(20, 40, 160, 20)), mode: 3 },
          { i: 2, image: true, box: box(0, 0, 600, 800) },
        ],
        input,
      ),
    ).toBeNull();
    expect(plan([text(1, box(20, 300, 160, 20))], input)).toBeNull();
    expect(plan([{ ...text(1, box(20, 40, 160, 20)), alpha: 0 }], input)).toBeNull();
  });
  it('accepts a proved flat decorative bitmap but refuses a full-page scan', () => {
    const body = text(1, box(20, 40, 160, 20));
    const image = { i: 2, image: true, box: box(0, 0, 600, 800), safeBackdrop: true };
    const data = { ...input, lines: [...input.lines, { ...box(20, 700, 80, 20), chars: 8 }] };
    expect(plan([body, image], data).owned).toContainEqual(box(18, 698, 84, 24));
    expect(plan([body, { ...image, safeBackdrop: false }], data)).toBeNull();
    expect(
      plan([body, image], {
        ...data,
        lines: [...data.lines, { ...box(20, 300, 450, 20), chars: 80 }],
      }),
    ).toBeNull();
  });
  it('removes a luminosity-mask text effect but retains an unrelated image mask', () => {
    const records = [
      text(1, box(20, 40, 160, 20)),
      { i: 2, image: true, mask: 'shadow', box: box(18, 38, 164, 24) },
      { i: 3, image: true, mask: 'photo', box: box(200, 200, 200, 200) },
    ];
    const result = plan(records, input);
    expect([...result.shadows]).toEqual(['shadow']);
    expect(result.owned).toEqual([]);
  });
  it('keeps short stamp lettering but does not rasterize a circled year', () => {
    const seal = box(300, 500, 100, 100);
    const result = plan(
      [
        text(1, box(20, 40, 160, 20)),
        { i: 2, ellipse: true, box: seal },
        text(3, box(315, 525, 70, 16), 'OFFICIAL'),
        text(4, box(315, 548, 70, 16), 'SEAL 2026'),
      ],
      input,
    );
    expect([...result.keep]).toEqual([3, 4]);
    expect(
      plan(
        [
          text(1, box(20, 40, 160, 20)),
          { i: 2, ellipse: true, box: seal },
          text(3, box(315, 525, 70, 16), '2026'),
        ],
        input,
      ),
    ).toBeNull();
  });
  it('falls back for a landscape page whose native words are predominantly rotated', () => {
    const words = Array.from({ length: 4 }, (_, i) =>
      text(i, box(50 + i * 40, 40, 16, 160), 'Rotated body'),
    );
    const records = [...words, { i: 8, image: true, box: box(300, 100, 200, 150) }];
    expect(
      plan(records, {
        width: 800,
        height: 600,
        figures: [],
        lines: words.map((t) => ({ ...t.box, chars: t.text.length })),
      }),
    ).toBeNull();
  });
  it('does not turn repeated colored numeric data fields into pictures', () => {
    const records: any[] = [text(1, box(20, 40, 160, 20))];
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        records.push({
          i: 10 + row * 2 + col,
          rectangle: true,
          fill: true,
          color: 'EEDDCC',
          box: box(30 + col * 260, 160 + row * 240, 200, 120),
        });
        records.push(
          text(20 + row * 2 + col, box(100 + col * 260, 200 + row * 240, 40, 20), '125'),
        );
      }
    const result = plan(records, input);
    expect(result.owned).toEqual([]);
    expect(result.keep.size).toBe(0);
  });
  it('recognizes a repeated picture grid without owning the captions beneath it', () => {
    const records = [text(1, box(20, 40, 160, 20))];
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        records.push({
          i: 10 + row * 2 + col,
          rectangle: true,
          fill: true,
          box: box(30 + col * 260, 160 + row * 240, 200, 120),
        } as never);
        records.push(text(20 + row * 2 + col, box(100 + col * 260, 200 + row * 240, 20, 20), 'A'));
        records.push(
          text(
            30 + row * 2 + col,
            box(30 + col * 260, 290 + row * 240, 160, 20),
            'Editable caption',
          ),
        );
      }
    const result = plan(records, input);
    expect(result.owned).toHaveLength(4);
    expect([...result.keep]).toEqual([20, 21, 22, 23]);
  });
  it('reads a rounded card as a fill under its text, but not a circle or a slanted shape', () => {
    const shape = new Function('handlers', PDF_GRAPHICS_SCRIPT + ';return pathShape;')({});
    // 浏览器把每个圆角拆成好几段曲线；四条边横平竖直。
    const corner = (x: number, y: number) => [2, x, y, x, y, x, y, 2, x, y, x, y, x, y];
    const card = [
      ...[0, 68, 909, 1, 68, 874],
      ...corner(76, 866),
      ...[1, 190, 866],
      ...corner(198, 874),
      ...[1, 198, 909],
      ...corner(190, 917),
      ...[1, 76, 917],
      ...corner(68, 909),
      4,
    ];
    expect(shape(card, [68, 866, 198, 917])).toMatchObject({ rounded: true, rectangle: false });
    const circle = [0, 100, 50, ...corner(150, 100), ...corner(100, 150), ...corner(50, 100), 4];
    expect(shape(circle, [50, 50, 150, 150]).rounded).toBe(false);
    const slanted = [0, 0, 0, 1, 100, 10, ...corner(100, 60), 1, 0, 50, 4];
    expect(shape(slanted, [0, 0, 100, 60]).rounded).toBe(false);
    const result = plan(
      [
        text(1, box(20, 40, 160, 20)),
        {
          i: 2,
          name: 'constructPath',
          fill: true,
          rounded: true,
          alpha: 1,
          color: 'FFC857',
          box: box(20, 35, 170, 30),
        },
        {
          i: 3,
          name: 'constructPath',
          fill: true,
          rectangle: true,
          alpha: 1,
          color: '1B2A49',
          box: box(0, 0, 600, 800),
        },
      ],
      input,
    );
    expect(result.fills).toContainEqual({ box: box(20, 35, 170, 30), color: 'FFC857' });
  });
  it('passes a semi-transparent tint as the pale colour it shows on white paper (EU sample 048)', () => {
    const result = plan(
      [
        text(1, box(20, 40, 160, 20)),
        {
          i: 2,
          name: 'constructPath',
          fill: true,
          rectangle: true,
          alpha: 0.2,
          color: '88C946',
          box: box(20, 35, 300, 30),
        },
        {
          i: 3,
          name: 'constructPath',
          fill: true,
          rectangle: true,
          alpha: 0.02,
          color: 'FF0000',
          box: box(20, 100, 300, 30),
        },
      ],
      input,
    );
    expect(result.fills).toEqual([{ box: box(20, 35, 300, 30), color: 'E7F4DA' }]);
  });
  it('treats glyph runs without Unicode as text, never as drawing in the background or crops', () => {
    const script = (name: string) =>
      new Function('handlers', PDF_GRAPHICS_SCRIPT + `;return ${name};`)({});
    const cropOperation = script('cropOperation');
    const backgroundOperation = script('backgroundOperation');
    const figure = box(300, 150, 250, 180);
    const inside = {
      i: 6,
      name: 'showText',
      text: '',
      alpha: 1,
      mode: 0,
      box: box(320, 200, 60, 15),
    };
    const outside = {
      i: 7,
      name: 'showText',
      text: '',
      alpha: 1,
      mode: 0,
      box: box(20, 70, 60, 15),
    };
    const result = plan(
      [
        text(1, box(20, 40, 160, 20)),
        { i: 2, image: true, box: box(330, 200, 30, 30) },
        { i: 3, image: true, box: box(450, 230, 30, 30) },
        inside,
        outside,
      ],
      { ...input, candidates: [figure] },
    );
    expect(result.owned).toEqual([figure]);
    // 图里的无编码字形跟着这张图；图外的是正文，由可编辑文字承载。
    expect(result.keep.has(6)).toBe(true);
    expect(result.keep.has(7)).toBe(false);
    expect(cropOperation(inside, result)).toBe(true);
    expect(cropOperation(outside, result)).toBe(false);
    expect(backgroundOperation(outside, box(0, 0, 600, 800))).toBe(false);
    expect(backgroundOperation({ i: 8, name: 'setFont' }, box(0, 0, 600, 800))).toBe(true);
  });
});
