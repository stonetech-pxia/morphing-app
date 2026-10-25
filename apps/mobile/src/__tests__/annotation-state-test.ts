import { annotationPaths } from '../runtime/annotations';
import { reduceAnnotations, type AnnotationState } from '../run/local/annotation-state';

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
  for (let n = 0; n < 1200; n++)
    state = reduceAnnotations(state, { type: 'move', dx: n / 10, dy: n / 20 }, sizes);
  expect(state.draft?.points).toHaveLength(1000);
});
