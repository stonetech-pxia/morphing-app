// 标注仅保存在本次运行中；AI 看不到这些文字、坐标或笔画。
export interface AnnotationPoint {
  x: number;
  y: number;
}
export type ImageAnnotation =
  | {
      kind: 'text';
      point: AnnotationPoint;
      text: string;
      fontSize: number;
      color: string;
      /** 顺时针转的角度，绕文字框中心。 */
      rotation?: number;
      /** 注释：文字后面的底色（黄色便签）。 */
      fill?: string;
    }
  | {
      // erase：涂白；mosaic：打码（只用起止两点围成的框）。
      kind: 'arrow' | 'box' | 'pen' | 'highlight' | 'erase' | 'mosaic';
      points: AnnotationPoint[];
      width: number;
      color: string;
    };

/** 起止两点围成的框（erase、mosaic）。 */
export function markRect(mark: { points: AnnotationPoint[] }) {
  const a = mark.points[0]!;
  const b = mark.points[mark.points.length - 1]!;
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** 预览和导出共用同一组原图坐标路径。 */
export function annotationPaths(
  mark: Exclude<ImageAnnotation, { kind: 'text' }>,
): AnnotationPoint[][] {
  if (mark.kind === 'erase' || mark.kind === 'mosaic') return [];
  const start = mark.points[0];
  const end = mark.points[mark.points.length - 1];
  if (!start || !end) return [];
  if (mark.kind === 'pen' || mark.kind === 'highlight') return [mark.points];
  if (mark.kind === 'box')
    return [[start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }, start]];
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.min(Math.hypot(end.x - start.x, end.y - start.y) * 0.4, mark.width * 5);
  return [
    [start, end],
    [
      { x: end.x - length * Math.cos(angle - 0.55), y: end.y - length * Math.sin(angle - 0.55) },
      end,
      { x: end.x - length * Math.cos(angle + 0.55), y: end.y - length * Math.sin(angle + 0.55) },
    ],
  ];
}
export const annotationSvg = (points: AnnotationPoint[]) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

/** 标注按页面放大缩小 k 倍（预览图上画的，换到更大的图上用）。 */
export function scaleMarks(marks: readonly ImageAnnotation[], k: number): ImageAnnotation[] {
  const pt = (p: AnnotationPoint) => ({ x: p.x * k, y: p.y * k });
  return marks.map((m) =>
    m.kind === 'text'
      ? { ...m, point: pt(m.point), fontSize: m.fontSize * k }
      : { ...m, points: m.points.map(pt), width: m.width * k },
  );
}
