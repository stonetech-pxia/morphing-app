// 标注仅保存在本次运行中；AI 看不到这些文字、坐标或笔画。
export interface AnnotationPoint {
  x: number;
  y: number;
}
export type ImageAnnotation =
  | { kind: 'text'; point: AnnotationPoint; text: string; fontSize: number; color: string }
  | { kind: 'arrow' | 'box' | 'pen'; points: AnnotationPoint[]; width: number; color: string };

/** 预览和导出共用同一组原图坐标路径。 */
export function annotationPaths(
  mark: Exclude<ImageAnnotation, { kind: 'text' }>,
): AnnotationPoint[][] {
  const start = mark.points[0];
  const end = mark.points[mark.points.length - 1];
  if (!start || !end) return [];
  if (mark.kind === 'pen') return [mark.points];
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
