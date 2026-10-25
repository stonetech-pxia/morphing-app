import type { ImageAnnotation, AnnotationPoint } from '../../runtime/annotations';

export type AnnotationTool = ImageAnnotation['kind'];
type Size = { width: number; height: number };
export interface AnnotationState {
  index: number;
  marks: ImageAnnotation[][];
  box: Size;
  tool: AnnotationTool;
  color: string;
  text: string;
  start: AnnotationPoint | null;
  draft: Exclude<ImageAnnotation, { kind: 'text' }> | null;
}
export type AnnotationAction =
  | { type: 'layout'; width: number; height: number }
  | { type: 'tool'; tool: AnnotationTool }
  | { type: 'color'; color: string }
  | { type: 'text'; text: string }
  | { type: 'grant'; x: number; y: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'next' };
export function annotationLayout(box: Size, size: Size) {
  const scale =
    box.width && box.height ? Math.min(box.width / size.width, box.height / size.height) : 0;
  return {
    scale,
    width: size.width * scale,
    height: size.height * scale,
    left: (box.width - size.width * scale) / 2,
    top: (box.height - size.height * scale) / 2,
  };
}
const clamp = (x: number, max: number) => Math.max(0, Math.min(max, x));
export function reduceAnnotations(
  state: AnnotationState,
  action: AnnotationAction,
  sizes: Size[],
): AnnotationState {
  const size = sizes[state.index]!;
  const { scale } = annotationLayout(state.box, size);
  const append = (mark: ImageAnnotation) =>
    state.marks.map((marks, i) => (i === state.index ? [...marks, mark] : marks));
  switch (action.type) {
    case 'layout':
      return { ...state, box: { width: action.width, height: action.height } };
    case 'tool':
      return { ...state, tool: action.tool, start: null, draft: null };
    case 'color':
      return { ...state, color: action.color };
    case 'text':
      return { ...state, text: action.text.replace(/[\r\n]/g, ' ').slice(0, 160) };
    case 'grant': {
      if (!scale || state.marks[state.index]!.length >= 100) return state;
      const point = {
        x: clamp(action.x / scale, size.width),
        y: clamp(action.y / scale, size.height),
      };
      if (state.tool === 'text') {
        if (!state.text.trim()) return state;
        const fontSize = Math.max(12, Math.min(size.width, size.height) * 0.045);
        point.x = Math.min(point.x, Math.max(0, size.width - fontSize));
        point.y = Math.min(point.y, Math.max(0, size.height - fontSize * 1.4));
        return {
          ...state,
          marks: append({
            kind: 'text',
            point,
            text: state.text.trim(),
            fontSize,
            color: state.color,
          }),
        };
      }
      return {
        ...state,
        start: point,
        draft: {
          kind: state.tool,
          points: [point, { x: point.x + 0.01, y: point.y + 0.01 }],
          width: Math.max(2, Math.min(size.width, size.height) * 0.007),
          color: state.color,
        },
      };
    }
    case 'move': {
      if (!state.start || !state.draft || !scale) return state;
      const point = {
        x: clamp(state.start.x + action.dx / scale, size.width),
        y: clamp(state.start.y + action.dy / scale, size.height),
      };
      const points =
        state.draft.kind === 'pen' ? [...thin(state.draft.points), point] : [state.start, point];
      return { ...state, draft: { ...state.draft, points } };
    }
    case 'end': {
      const draft = state.draft;
      const points = draft?.points;
      const first = points?.[0];
      const last = points?.[points.length - 1];
      const keep =
        draft &&
        first &&
        last &&
        (draft.kind === 'pen' || Math.hypot(last.x - first.x, last.y - first.y) * scale >= 6);
      return { ...state, marks: keep ? append(draft) : state.marks, start: null, draft: null };
    }
    case 'undo':
      return {
        ...state,
        marks: state.marks.map((marks, i) => (i === state.index ? marks.slice(0, -1) : marks)),
      };
    case 'next':
      return {
        ...state,
        index: Math.min(sizes.length - 1, state.index + 1),
        start: null,
        draft: null,
      };
  }
}

/** 一笔最多这么多点；到了就隔一个丢一个（保留首尾），笔画形状不变，不会把后半段拉成直线。 */
const MAX_PEN_POINTS = 1000;
function thin<T>(points: readonly T[]): readonly T[] {
  if (points.length < MAX_PEN_POINTS) return points;
  return points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
}
