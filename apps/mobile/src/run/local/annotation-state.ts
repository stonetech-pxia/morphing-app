import type { ImageAnnotation, AnnotationPoint } from '../../runtime/annotations';

export type AnnotationTool = ImageAnnotation['kind'] | 'note';
type TextMark = Extract<ImageAnnotation, { kind: 'text' }>;
/** 文字框的大小（原图点）：排版交给调用方（Skia），没给时按字数估一个。 */
export type Measure = (text: string, fontSize: number) => Size;
const estimate: Measure = (text, fontSize) => ({
  width: [...text].length * fontSize * 0.7 + fontSize * 0.4,
  height: fontSize * 1.6,
});
export const NOTE_FILL = '#FDE68A';

type Size = { width: number; height: number };
/** 页面上认出的一行字的框（原图点）。 */
export type LineBox = { x: number; y: number; width: number; height: number };

/** 文件页上新写的字默认多大：约是短边的 1.9%，A4、Letter 上接近 11 磅的正文。 */
const DOCUMENT_FONT = 0.019;

/**
 * 点附近那一行字（原图点）：同一行的优先（竖直距离算两倍），再看左右离得多远。没有认出字时是 undefined。
 */
export function nearestLine(lines: readonly LineBox[], p: AnnotationPoint): LineBox | undefined {
  let best: LineBox | undefined;
  let bestScore = Infinity;
  for (const line of lines) {
    const dy = Math.max(line.y - p.y, 0, p.y - (line.y + line.height));
    const dx = Math.max(line.x - p.x, 0, p.x - (line.x + line.width));
    const score = dy * 2 + dx;
    if (score < bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return best;
}

/** 照着点附近那一行字定新文字的字号：认出的行框比字号高一些（上下留白），取行高的 3/4。 */
export function lineFontSize(lines: readonly LineBox[], p: AnnotationPoint): number | undefined {
  const line = nearestLine(lines, p);
  return line ? line.height * 0.75 : undefined;
}

export interface AnnotationState {
  index: number;
  marks: ImageAnnotation[][];
  box: Size;
  tool: AnnotationTool;
  color: string;
  text: string;
  start: AnnotationPoint | null;
  /** 选中的文字（这一页第几个标注）和是不是正在拖它。 */
  selected?: number | null;
  drag?: boolean;
  /** 开始拖时文字的位置（拖动是从这里加上手指移动的距离）。 */
  dragFrom?: AnnotationPoint | null;
  draft: Exclude<ImageAnnotation, { kind: 'text' }> | null;
  /** 每页认出的行（原图点），新写的字照最近的一行定字号；还在认或认不出时是空的。 */
  lines?: Record<number, readonly LineBox[]>;
}
export type AnnotationAction =
  | { type: 'layout'; width: number; height: number }
  | { type: 'tool'; tool: AnnotationTool }
  | { type: 'color'; color: string }
  | { type: 'text'; text: string }
  | {
      type: 'grant';
      x: number;
      y: number;
      defaultText?: string;
      /** 新写的字的字号（原图点）；不给时照 lines 里最近的那一行，再没有时按页面大小。 */
      fontSize?: number;
      /** 这一页认出的行（原图点），用来定字号。 */
      lines?: readonly LineBox[];
      /** 是文件的页面（PDF）：没认出字时按正文大小写，不按照片上的标签大小。 */
      document?: boolean;
    }
  | { type: 'style'; patch: Partial<Pick<TextMark, 'text' | 'fontSize' | 'color' | 'rotation'>> }
  | { type: 'remove' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'next' }
  | { type: 'lines'; index: number; lines: readonly LineBox[] };
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
  measure: Measure = estimate,
): AnnotationState {
  const size = sizes[state.index]!;
  const { scale } = annotationLayout(state.box, size);
  const pageMarks = state.marks[state.index]!;
  const append = (mark: ImageAnnotation) =>
    state.marks.map((marks, i) => (i === state.index ? [...marks, mark] : marks));
  const replace = (at: number, mark: ImageAnnotation | null) =>
    state.marks.map((marks, i) =>
      i === state.index
        ? mark
          ? marks.map((m, j) => (j === at ? mark : m))
          : marks.filter((_, j) => j !== at)
        : marks,
    );
  const selectedMark = (): { at: number; mark: TextMark } | null => {
    const at = state.selected ?? -1;
    const mark = pageMarks[at];
    return mark?.kind === 'text' ? { at, mark } : null;
  };
  /** 点中了哪个文字（从最上面一个找起）：把点转回文字框没转之前的位置再比。 */
  const hitText = (p: AnnotationPoint): number => {
    for (let i = pageMarks.length - 1; i >= 0; i--) {
      const mark = pageMarks[i]!;
      if (mark.kind !== 'text') continue;
      const box = measure(mark.text, mark.fontSize);
      const cx = mark.point.x + box.width / 2;
      const cy = mark.point.y + box.height / 2;
      const rad = (-(mark.rotation ?? 0) * Math.PI) / 180;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const x = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      const y = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
      const slack = 8 / scale;
      if (
        x >= mark.point.x - slack &&
        x <= mark.point.x + box.width + slack &&
        y >= mark.point.y - slack &&
        y <= mark.point.y + box.height + slack
      )
        return i;
    }
    return -1;
  };
  switch (action.type) {
    case 'layout':
      return { ...state, box: { width: action.width, height: action.height } };
    case 'tool':
      return { ...state, tool: action.tool, start: null, draft: null, selected: null, drag: false };
    case 'color':
      return { ...state, color: action.color };
    case 'text':
      return { ...state, text: action.text.replace(/[\r\n]/g, ' ').slice(0, 160) };
    case 'style': {
      const sel = selectedMark();
      if (!sel) return state;
      const { patch } = action;
      const text =
        patch.text === undefined ? sel.mark.text : patch.text.replace(/[\r\n]/g, ' ').slice(0, 160);
      const fontSize =
        patch.fontSize === undefined
          ? sel.mark.fontSize
          : Math.max(10, Math.min(Math.min(size.width, size.height) * 0.3, patch.fontSize));
      const rotation =
        patch.rotation === undefined
          ? sel.mark.rotation
          : ((Math.round(patch.rotation) % 360) + 360) % 360;
      const next: TextMark = {
        ...sel.mark,
        text,
        fontSize,
        color: patch.color ?? sel.mark.color,
        ...(rotation ? { rotation } : {}),
      };
      if (!rotation) delete next.rotation;
      return { ...state, marks: replace(sel.at, next) };
    }
    case 'remove': {
      const sel = selectedMark();
      if (!sel) return state;
      return { ...state, marks: replace(sel.at, null), selected: null, drag: false };
    }
    case 'grant': {
      if (!scale) return state;
      const point = {
        x: clamp(action.x / scale, size.width),
        y: clamp(action.y / scale, size.height),
      };
      const texty = state.tool === 'text' || state.tool === 'note';
      const hit = texty || state.selected != null ? hitText(point) : -1;
      if (hit >= 0 && (texty || hit === state.selected)) {
        const mark = pageMarks[hit] as TextMark;
        return {
          ...state,
          selected: hit,
          drag: true,
          dragFrom: mark.point,
          start: null,
          draft: null,
        };
      }
      // 选着一段字时点空白处：只是取消选中，不再放一段（2026-11-09 用户测试：想「点一下完成」却多了一段）。
      if (texty && state.selected != null)
        return { ...state, selected: null, drag: false, start: null, draft: null };
      if (pageMarks.length >= 100) return state;
      if (texty) {
        const text = state.text.trim() || action.defaultText || '';
        if (!text) return state;
        const short = Math.min(size.width, size.height);
        const fontSize =
          action.fontSize ??
          lineFontSize(action.lines ?? state.lines?.[state.index] ?? [], point) ??
          (action.document ? short * DOCUMENT_FONT : Math.max(12, short * 0.045));
        const box = measure(text, fontSize);
        // 字从点的地方开始、底边落在点上：点在一条横线上，字就写在这条线上，手指也不挡住要写的地方。
        const mark: TextMark = {
          kind: 'text',
          point: {
            x: clamp(point.x, Math.max(0, size.width - box.width)),
            y: clamp(point.y - box.height, Math.max(0, size.height - box.height)),
          },
          text,
          fontSize,
          color: state.tool === 'note' ? '#111827' : state.color,
          ...(state.tool === 'note' ? { fill: NOTE_FILL } : {}),
        };
        return {
          ...state,
          marks: append(mark),
          selected: pageMarks.length,
          drag: false,
          start: null,
          draft: null,
        };
      }
      const tool = state.tool as Exclude<ImageAnnotation, { kind: 'text' }>['kind'];
      const highlight = tool === 'highlight';
      return {
        ...state,
        selected: null,
        drag: false,
        start: point,
        draft: {
          kind: tool,
          points: [point, { x: point.x + 0.01, y: point.y + 0.01 }],
          // 荧光笔：粗一些、半透明，盖在文字上还看得见字。
          width: Math.max(2, Math.min(size.width, size.height) * (highlight ? 0.028 : 0.007)),
          color: highlight
            ? `${state.color}66`
            : tool === 'erase'
              ? '#FFFFFF'
              : tool === 'mosaic'
                ? '#808080'
                : state.color,
        },
      };
    }
    case 'move': {
      if (state.drag && state.selected != null) {
        const sel = selectedMark();
        if (!sel || !scale) return state;
        const box = measure(sel.mark.text, sel.mark.fontSize);
        // 起点是按下时的位置：这里用「按下时文字的位置 + 手指移动」，所以先还原按下时的位置。
        const origin = state.dragFrom ?? sel.mark.point;
        const point = {
          x: clamp(origin.x + action.dx / scale, Math.max(0, size.width - box.width)),
          y: clamp(origin.y + action.dy / scale, Math.max(0, size.height - box.height)),
        };
        return {
          ...state,
          dragFrom: origin,
          marks: replace(sel.at, { ...sel.mark, point }),
        };
      }
      if (!state.start || !state.draft || !scale) return state;
      const point = {
        x: clamp(state.start.x + action.dx / scale, size.width),
        y: clamp(state.start.y + action.dy / scale, size.height),
      };
      const points =
        state.draft.kind === 'pen' || state.draft.kind === 'highlight'
          ? [...thin(state.draft.points), point]
          : [state.start, point];
      return { ...state, draft: { ...state.draft, points } };
    }
    case 'end': {
      if (state.drag) return { ...state, drag: false, dragFrom: null };
      const draft = state.draft;
      const points = draft?.points;
      const first = points?.[0];
      const last = points?.[points.length - 1];
      const keep =
        draft &&
        first &&
        last &&
        (draft.kind === 'pen' ||
          draft.kind === 'highlight' ||
          Math.hypot(last.x - first.x, last.y - first.y) * scale >= 6);
      return { ...state, marks: keep ? append(draft) : state.marks, start: null, draft: null };
    }
    case 'undo':
      return {
        ...state,
        selected: null,
        drag: false,
        marks: state.marks.map((marks, i) => (i === state.index ? marks.slice(0, -1) : marks)),
      };
    case 'lines':
      return { ...state, lines: { ...state.lines, [action.index]: action.lines } };
    case 'next':
      return {
        ...state,
        index: Math.min(sizes.length - 1, state.index + 1),
        selected: null,
        drag: false,
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
