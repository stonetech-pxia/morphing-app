import { PDF_GRAPHICS_SCRIPT } from '../packs/pages/pdf-graphics';

// 对真实固定页面中的分析函数喂独立几何；不替换 PDF.js 的绘图路径。
const plan = new Function('handlers', PDF_GRAPHICS_SCRIPT + ';return planNativeGraphics;')({});
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
      ).owned,
    ).toEqual([]);
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
});
