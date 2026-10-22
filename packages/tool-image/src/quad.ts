import type { Size } from './geometry';

// 扫描用的四边形：纸张的四个角（原图像素坐标）。找边由扫描包完成，这里只做和平台无关的几何计算，
// 供四角调整界面和透视矫正共用。

export interface Point {
  x: number;
  y: number;
}

export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export const QUAD_CORNERS = ['tl', 'tr', 'br', 'bl'] as const;
export type QuadCorner = (typeof QUAD_CORNERS)[number];

/** 找不到纸张时的默认框：四边各向内缩一点。 */
export function defaultQuad(size: Size, inset = 0.06): Quad {
  const x0 = size.width * inset;
  const y0 = size.height * inset;
  const x1 = size.width * (1 - inset);
  const y1 = size.height * (1 - inset);
  return { tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, br: { x: x1, y: y1 }, bl: { x: x0, y: y1 } };
}

export function scaleQuad(q: Quad, k: number): Quad {
  const s = (p: Point) => ({ x: p.x * k, y: p.y * k });
  return { tl: s(q.tl), tr: s(q.tr), br: s(q.br), bl: s(q.bl) };
}

/** 把每个角限制在图片范围内。 */
export function clampQuad(q: Quad, size: Size): Quad {
  const c = (p: Point) => ({
    x: Math.min(Math.max(0, p.x), size.width),
    y: Math.min(Math.max(0, p.y), size.height),
  });
  return { tl: c(q.tl), tr: c(q.tr), br: c(q.br), bl: c(q.bl) };
}

/** 任意顺序的四个点 → 左上、右上、右下、左下（x+y 最小的是左上，最大的是右下）。 */
export function orderQuad(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new Error('a quad needs 4 points');
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = bySum[0]!;
  const br = bySum[3]!;
  const [p, q] = [bySum[1]!, bySum[2]!];
  // 剩下两个点里，y - x 小的在右上。
  const [tr, bl] = p.y - p.x < q.y - q.x ? [p, q] : [q, p];
  return { tl, tr, br, bl };
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** 四边形是凸的、按顺时针排列、面积不为零（拖乱了的角不能用来矫正）。 */
export function isConvexQuad(q: Quad, minArea = 1): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  for (let i = 0; i < 4; i++) {
    if (cross(pts[i]!, pts[(i + 1) % 4]!, pts[(i + 2) % 4]!) <= 0) return false;
  }
  return quadArea(q) >= minArea;
}

export function quadArea(q: Quad): number {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** 拉正后的输出尺寸：对边取较长的一条，长边不超过 maxSide。 */
export function warpSize(q: Quad, maxSide: number): Size {
  const width = Math.max(dist(q.tl, q.tr), dist(q.bl, q.br));
  const height = Math.max(dist(q.tl, q.bl), dist(q.tr, q.br));
  const k = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}
