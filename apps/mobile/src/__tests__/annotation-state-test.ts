import { annotationPaths, markRect } from '../runtime/annotations';
import {
  lineFontSize,
  reduceAnnotations,
  type AnnotationState,
} from '../run/local/annotation-state';

const sizes = [
  { width: 1000, height: 500 },
  { width: 500, height: 1000 },
];
const initial = (): AnnotationState => ({
  index: 0,
  marks: [[], []],
  box: { width: 200, height: 100 },
  tool: 'arrow',
  color: '#EF4444',
  text: '',
  start: null,
  draft: null,
});
it('maps drags to original pixels, clamps them and retains independent pages with undo', () => {
  let state = reduceAnnotations(initial(), { type: 'grant', x: 20, y: 10 }, sizes);
  state = reduceAnnotations(state, { type: 'move', dx: 250, dy: 200 }, sizes);
  state = reduceAnnotations(state, { type: 'end' }, sizes);
  expect(state.marks[0]?.[0]).toMatchObject({
    kind: 'arrow',
    points: [
      { x: 100, y: 50 },
      { x: 1000, y: 500 },
    ],
  });
  const arrow = state.marks[0]![0]!;
  if (arrow.kind === 'text') throw new Error('wrong shape');
  const paths = annotationPaths(arrow);
  expect(paths).toHaveLength(2);
  expect(paths[1]![1]).toEqual({ x: 1000, y: 500 });
  state = reduceAnnotations(state, { type: 'next' }, sizes);
  state = reduceAnnotations(state, { type: 'tool', tool: 'text' }, sizes);
  state = reduceAnnotations(state, { type: 'text', text: '本地 note' }, sizes);
  state = reduceAnnotations(state, { type: 'grant', x: 5, y: 10 }, sizes);
  expect(state.marks[1]).toHaveLength(1);
  expect(state.marks[0]).toHaveLength(1);
  state = reduceAnnotations(state, { type: 'undo' }, sizes);
  expect(state.marks[1]).toEqual([]);
  expect(state.marks[0]).toHaveLength(1);
});
it('keeps outline rectangles and freehand paths, ignores tiny accidental arrows, and limits freehand memory', () => {
  let state = initial();
  state = reduceAnnotations(state, { type: 'tool', tool: 'box' }, sizes);
  state = reduceAnnotations(state, { type: 'grant', x: 80, y: 60 }, sizes);
  state = reduceAnnotations(state, { type: 'move', dx: -60, dy: -40 }, sizes);
  state = reduceAnnotations(state, { type: 'end' }, sizes);
  const box = state.marks[0]![0]!;
  if (box.kind === 'text') throw new Error('wrong shape');
  expect(annotationPaths(box)[0]).toEqual([
    { x: 400, y: 300 },
    { x: 100, y: 300 },
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 300 },
  ]);
  state = reduceAnnotations(state, { type: 'tool', tool: 'arrow' }, sizes);
  state = reduceAnnotations(state, { type: 'grant', x: 20, y: 10 }, sizes);
  state = reduceAnnotations(state, { type: 'end' }, sizes);
  expect(state.marks[0]).toHaveLength(1);
  state = reduceAnnotations(state, { type: 'tool', tool: 'pen' }, sizes);
  state = reduceAnnotations(state, { type: 'grant', x: 20, y: 10 }, sizes);
  // 先往右画、再往下画：超过上限后形状要保留（拐角还在），点数不超过上限。
  for (let n = 0; n < 900; n++)
    state = reduceAnnotations(state, { type: 'move', dx: n / 10, dy: 0 }, sizes);
  for (let n = 0; n < 900; n++)
    state = reduceAnnotations(state, { type: 'move', dx: 89.9, dy: n / 20 }, sizes);
  const points = state.draft!.points;
  expect(points.length).toBeLessThanOrEqual(1000);
  const corner = points.some((p) => Math.abs(p.x - points[points.length - 1]!.x) < 1 && p.y < 60);
  expect(corner).toBe(true);
  expect(points[points.length - 1]!.y).toBeGreaterThan(points[0]!.y + 100);
  // 末尾不能是一条从旧点直接拉到手指的直线。
  const [a, b] = points.slice(-2);
  expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeLessThan(5);
});

describe('文字：选中、拖动、改样式、删除', () => {
  const textState = () => reduceAnnotations(initial(), { type: 'tool', tool: 'text' }, sizes);
  const placed = () => {
    let state = reduceAnnotations(textState(), { type: 'text', text: '你好' }, sizes);
    state = reduceAnnotations(state, { type: 'grant', x: 100, y: 50 }, sizes);
    return reduceAnnotations(state, { type: 'end' }, sizes);
  };

  it('puts the text at the tap, selects it, and uses the default text when none was typed', () => {
    const state = placed();
    expect(state.selected).toBe(0);
    expect(state.marks[0]![0]).toMatchObject({ kind: 'text', text: '你好' });
    const empty = reduceAnnotations(
      textState(),
      { type: 'grant', x: 100, y: 50, defaultText: '文字' },
      sizes,
    );
    expect(empty.marks[0]![0]).toMatchObject({ kind: 'text', text: '文字' });
  });

  it('tapping a placed text selects and drags it instead of adding another', () => {
    let state = placed();
    const at = state.marks[0]![0] as { point: { x: number; y: number } };
    state = reduceAnnotations(state, { type: 'grant', x: 100, y: 50 }, sizes);
    expect(state.marks[0]).toHaveLength(1);
    state = reduceAnnotations(state, { type: 'move', dx: 20, dy: 10 }, sizes);
    state = reduceAnnotations(state, { type: 'move', dx: 40, dy: 10 }, sizes);
    state = reduceAnnotations(state, { type: 'end' }, sizes);
    const moved = state.marks[0]![0] as { point: { x: number; y: number } };
    // 按下时的位置加手指移动的总距离（200 点的框对应 1000 点的页：每个屏幕点 5 个页面点）。
    expect(moved.point).toEqual({ x: at.point.x + 200, y: at.point.y + 50 });
    expect(state.selected).toBe(0);
  });

  it('changes size, angle, color and text of the selected text; clamps size; angle wraps', () => {
    let state = placed();
    state = reduceAnnotations(
      state,
      { type: 'style', patch: { fontSize: 99999, rotation: -90 } },
      sizes,
    );
    state = reduceAnnotations(
      state,
      { type: 'style', patch: { color: '#2563EB', text: '再见' } },
      sizes,
    );
    expect(state.marks[0]![0]).toMatchObject({
      text: '再见',
      color: '#2563EB',
      rotation: 270,
      fontSize: 150,
    });
    state = reduceAnnotations(state, { type: 'style', patch: { fontSize: 1, rotation: 0 } }, sizes);
    const mark = state.marks[0]![0]!;
    expect(mark).toMatchObject({ fontSize: 10 });
    expect('rotation' in mark).toBe(false);
  });

  it('deletes the selected text, and a rotated text is hit where it appears', () => {
    let state = placed();
    state = reduceAnnotations(state, { type: 'remove' }, sizes);
    expect(state.marks[0]).toEqual([]);
    expect(state.selected).toBeNull();
    // 一长条文字转 90° 后竖起来：原来的位置（横着的两端）点不中，竖着的两端点得中。
    state = reduceAnnotations(textState(), { type: 'text', text: '你好你好你好' }, sizes);
    state = reduceAnnotations(state, { type: 'grant', x: 100, y: 50 }, sizes);
    state = reduceAnnotations(state, { type: 'style', patch: { rotation: 90 } }, sizes);
    state = reduceAnnotations(state, { type: 'end' }, sizes);
    const mark = state.marks[0]![0] as { point: { x: number; y: number }; fontSize: number };
    const width = 6 * mark.fontSize * 0.7 + mark.fontSize * 0.4;
    const height = mark.fontSize * 1.6;
    const cx = mark.point.x + width / 2;
    const cy = mark.point.y + height / 2;
    const tap = (x: number, y: number) =>
      reduceAnnotations(state, { type: 'grant', x: x / 5, y: y / 5 }, sizes);
    expect(tap(cx, cy + 90).drag).toBe(true);
    // 横着的一端点不中：只是取消选中，不再多放一个（2026-11-09）。
    expect(tap(cx + 90, cy).selected).toBeNull();
    expect(tap(cx + 90, cy).marks[0]).toHaveLength(1);
  });

  // 2026-11-09 用户测试：放好一段字后点空白处想「取消选中」，结果又多了一段；字以手指为中心，落不到线上。
  it('tapping an empty spot while a text is selected only deselects it; the next tap adds one', () => {
    let state = placed();
    expect(state.selected).toBe(0);
    state = reduceAnnotations(state, { type: 'grant', x: 180, y: 90 }, sizes);
    state = reduceAnnotations(state, { type: 'end' }, sizes);
    expect(state.marks[0]).toHaveLength(1);
    expect(state.selected).toBeNull();
    // 没有选中的时候再点空白处：照写好的字再放一段（同一个日期写在两处）。
    state = reduceAnnotations(state, { type: 'grant', x: 180, y: 90 }, sizes);
    expect(state.marks[0]).toHaveLength(2);
    expect(state.marks[0]![1]).toMatchObject({ text: '你好' });
  });

  it('a new text starts at the tap and sits on it (its bottom edge on the tapped line)', () => {
    let state = reduceAnnotations(textState(), { type: 'text', text: 'Date' }, sizes);
    state = reduceAnnotations(state, { type: 'grant', x: 40, y: 60, fontSize: 20 }, sizes);
    const mark = state.marks[0]![0] as { point: { x: number; y: number }; fontSize: number };
    // 200 点的框对应 1000 点的页：点在页面 (200, 300)。
    expect(mark.fontSize).toBe(20);
    expect(mark.point.x).toBe(200);
    expect(mark.point.y + 20 * 1.6).toBe(300);
  });

  it('without a size from the page, documents use about the size of body text', () => {
    const doc = reduceAnnotations(textState(), { type: 'text', text: 'x' }, sizes);
    const placedDoc = reduceAnnotations(
      doc,
      { type: 'grant', x: 40, y: 60, document: true },
      sizes,
    );
    // 短边 500：约 1.9%，接近 A4 上 11 磅的字。
    expect((placedDoc.marks[0]![0] as { fontSize: number }).fontSize).toBeCloseTo(9.5, 1);
    const photo = reduceAnnotations(doc, { type: 'grant', x: 40, y: 60 }, sizes);
    expect((photo.marks[0]![0] as { fontSize: number }).fontSize).toBeCloseTo(22.5, 1);
  });

  it('the nearest recognized line gives the size: same row first, then the closest', () => {
    const lines = [
      { x: 100, y: 100, width: 300, height: 20 },
      { x: 100, y: 160, width: 300, height: 40 },
    ];
    expect(lineFontSize(lines, { x: 450, y: 170 })).toBe(30);
    expect(lineFontSize(lines, { x: 120, y: 112 })).toBe(15);
    expect(lineFontSize(lines, { x: 120, y: 135 })).toBe(15);
    expect(lineFontSize([], { x: 0, y: 0 })).toBeUndefined();
  });

  it('erase and mosaic are boxes between two points, filled white / gray', () => {
    for (const [tool, color] of [
      ['erase', '#FFFFFF'],
      ['mosaic', '#808080'],
    ] as const) {
      let state = reduceAnnotations(initial(), { type: 'tool', tool }, sizes);
      state = reduceAnnotations(state, { type: 'grant', x: 20, y: 10 }, sizes);
      state = reduceAnnotations(state, { type: 'move', dx: 40, dy: 20 }, sizes);
      state = reduceAnnotations(state, { type: 'end' }, sizes);
      expect(state.marks[0]![0]).toMatchObject({ kind: tool, color });
      expect(markRect(state.marks[0]![0] as never)).toEqual({
        x: 100,
        y: 50,
        width: 200,
        height: 100,
      });
    }
  });
});
