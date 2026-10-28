// 找文字行的几何计算（D-269）：凸包、最小外接矩形（旋转卡壳）、矩形往外扩、四个角排顺序。
// 和 PaddleOCR 的 DB 后处理（OpenCV 的 minAreaRect、pyclipper 的 offset）结果一致，但不依赖它们。

export interface Point {
  x: number;
  y: number;
}

/** 旋转的矩形：中心、两条轴（单位向量）和两条轴方向上的长度。 */
export interface RotatedRect {
  cx: number;
  cy: number;
  u: Point;
  v: Point;
  w: number;
  h: number;
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** 凸包（Andrew 单调链），逆时针，不含共线点。 */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 面积最小的外接矩形：最小矩形一定有一条边和凸包的某条边重合，逐条边试。 */
export function minAreaRect(points: readonly Point[]): RotatedRect {
  const hull = convexHull(points);
  if (hull.length === 0) return { cx: 0, cy: 0, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, w: 0, h: 0 };
  let best: RotatedRect | null = null;
  let bestArea = Infinity;
  const n = hull.length;
  for (let i = 0; i < Math.max(1, n); i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
    const v = { x: -u.y, y: u.x };
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const pu = p.x * u.x + p.y * u.y;
      const pv = p.x * v.x + p.y * v.y;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      const mu = (minU + maxU) / 2;
      const mv = (minV + maxV) / 2;
      best = {
        cx: mu * u.x + mv * v.x,
        cy: mu * u.y + mv * v.y,
        u,
        v,
        w: maxU - minU,
        h: maxV - minV,
      };
    }
  }
  return best!;
}

/** 矩形的四个角，按左上、右上、右下、左下排（PaddleOCR 的 get_mini_boxes：先按 x 排，左右两对里各按 y 分上下）。 */
export function rectCorners(rect: RotatedRect): [Point, Point, Point, Point] {
  const { cx, cy, u, v, w, h } = rect;
  const corner = (su: number, sv: number) => ({
    x: cx + (su * w * u.x) / 2 + (sv * h * v.x) / 2,
    y: cy + (su * w * u.y) / 2 + (sv * h * v.y) / 2,
  });
  const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].sort(
    (a, b) => a.x - b.x,
  );
  const [l0, l1, r0, r1] = pts as [Point, Point, Point, Point];
  const [tl, bl] = l1.y > l0.y ? [l0, l1] : [l1, l0];
  const [tr, br] = r1.y > r0.y ? [r0, r1] : [r1, r0];
  return [tl, tr, br, bl];
}

/**
 * 文字区域往外扩（DB 的 unclip）：扩的距离 = 面积 × ratio ÷ 周长。矩形按圆角往外扩之后，
 * 最小外接矩形就是每边各加这个距离。
 */
export function unclipRect(rect: RotatedRect, ratio: number): RotatedRect {
  const perimeter = 2 * (rect.w + rect.h);
  const d = perimeter > 0 ? (rect.w * rect.h * ratio) / perimeter : 0;
  return { ...rect, w: rect.w + 2 * d, h: rect.h + 2 * d };
}
