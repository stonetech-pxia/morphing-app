// 扫描页面展平（D-274）的纯几何计算：四角拉正之后，UVDoc 模型估计纸面的弯曲（45×31 的变形网格），
// 再按文字行精修（整页去倾斜 + 逐行拉直），三步合成一张三角网格，App 里用 Skia 的 drawVertices 只重采样一次。
// 跑模型、画图在 App 里（ONNX Runtime、Skia），这里只处理小图和坐标，在 Node 里可以直接测。
//
// 坐标一律是「像素序号」：第 0 个像素的中心是 0，最后一个是 width - 1（和 OpenCV 的 remap 一样）；
// 交给 Skia 时再加 0.5（Skia 的像素中心在 0.5）。做法和参数来自 2026-10-29 的实验（side-session-notes 里的
// dewarp-exp/REPORT.md 第一、二轮：拉正 → 补边 + UVDoc → 找文字行 → 去倾斜 + 逐行拉直）。

import type { Size } from './geometry';
import type { Point } from './quad';
import type { RgbaImage } from './scan-enhance';

/** 送进 UVDoc 之前四周补的深色边（长边的 6%）：不补时模型会把拉正图当成「纸 + 背景」，往里多裁一圈。 */
export const FLATTEN_PAD_SHARE = 0.06;
/** 补边的颜色（RGB 都是 40）。 */
export const FLATTEN_PAD_GRAY = 40;
/** UVDoc 的输入大小（宽 488、高 712，不管页面是横是竖都这样缩，和官方用法一样）。 */
export const UVDOC_INPUT: Size = { width: 488, height: 712 };
/** UVDoc 输出的网格（宽 31、高 45 个点，值是 -1…1 的源图坐标，四角对齐）。 */
export const UVDOC_GRID: Size = { width: 31, height: 45 };

/** 精修：少于这么多条文字行的页不精修（只展平）。 */
export const REFINE_MIN_LINES = 5;
/** 精修：整页转正的角度上限（度）；小于 0.1° 不转。 */
export const DESKEW_LIMIT = 0.5;
const DESKEW_MIN = 0.1;
/** 精修：位移不超过长边的 2%。 */
export const SHIFT_LIMIT_SHARE = 0.02;
/** 位移网格（也是最后画图的三角网格）的步长：长边约 190 格（实验里是长边约 4500 像素时 24 像素一格）。 */
const MESH_CELLS_LONG = 190;
/** 一张网格最多这么多个顶点（索引是 16 位）。 */
const MAX_VERTICES = 65_000;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 补边的宽度（像素，四周一样宽）。 */
export function padMargin(page: Size): number {
  return Math.floor(FLATTEN_PAD_SHARE * Math.max(page.width, page.height));
}

/** 补边后的大小。 */
export function paddedSize(page: Size): Size {
  const m = padMargin(page);
  return { width: page.width + 2 * m, height: page.height + 2 * m };
}

/**
 * UVDoc 的输入张量 [1, 3, 712, 488]：BGR，÷255。image 是补过边、已经缩到 488×712 的 RGBA。
 */
export function uvdocInput(image: RgbaImage): Float32Array {
  const { width, height, data } = image;
  if (width !== UVDOC_INPUT.width || height !== UVDOC_INPUT.height) {
    throw new Error(`UVDoc input must be ${UVDOC_INPUT.width}×${UVDOC_INPUT.height}`);
  }
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  const k = 1 / 255;
  for (let o = 0, i = 0; o < plane; o++, i += 4) {
    out[o] = data[i + 2]! * k;
    out[plane + o] = data[i + 1]! * k;
    out[2 * plane + o] = data[i]! * k;
  }
  return out;
}

/** UVDoc 的结果：网格（[2, 45, 31]）和它对应的页面（拉正图）大小。 */
export interface UvdocWarp {
  grid: Float32Array;
  page: Size;
}

/**
 * 展平图上的一点（页面像素序号，展平图和拉正图一样大）在拉正图上的位置：网格按四角对齐双线性插值
 * （和官方把网格放大到输出大小一样），换算到补边后的图，再减掉边宽；落在纸外的夹到边上。
 */
export function uvdocSource(warp: UvdocWarp, x: number, y: number): Point {
  const { grid, page } = warp;
  const gw = UVDOC_GRID.width;
  const gh = UVDOC_GRID.height;
  const gx = clamp((x / Math.max(1, page.width - 1)) * (gw - 1), 0, gw - 1);
  const gy = clamp((y / Math.max(1, page.height - 1)) * (gh - 1), 0, gh - 1);
  const x0 = Math.min(Math.floor(gx), gw - 2);
  const y0 = Math.min(Math.floor(gy), gh - 2);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (c: number, yy: number, xx: number) => grid[c * gw * gh + yy * gw + xx]!;
  const lerp = (c: number) =>
    (at(c, y0, x0) * (1 - fx) + at(c, y0, x0 + 1) * fx) * (1 - fy) +
    (at(c, y0 + 1, x0) * (1 - fx) + at(c, y0 + 1, x0 + 1) * fx) * fy;
  const padded = paddedSize(page);
  const m = padMargin(page);
  return {
    x: clamp(((lerp(0) + 1) / 2) * (padded.width - 1) - m, 0, page.width - 1),
    y: clamp(((lerp(1) + 1) / 2) * (padded.height - 1) - m, 0, page.height - 1),
  };
}

// ---------------------------------------------------------------------------------------------
// 文字行和表格线

/** 一条横向的文字行或表格线：每列的中心（页面像素）。 */
export interface PageLine {
  xs: number[];
  ys: number[];
  /** 行高（文字行）；表格线是 0。 */
  thickness: number;
  /** 左右跨度（页面像素）。 */
  length: number;
  /** 长行（长度 ≥ 8 倍行高），整页转正时用它的角度。 */
  long: boolean;
  /** 拟合直线的角度（度，y 向下，正数是往右下斜）。 */
  angle: number;
}

/** 最小二乘多项式（x 先归一化，避免大数值的病态），返回求值函数。 */
export function polyfit(xs: readonly number[], ys: readonly number[], degree: number) {
  const n = xs.length;
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= Math.max(1, n);
  let spread = 0;
  for (const x of xs) spread = Math.max(spread, Math.abs(x - mean));
  spread = spread || 1;
  const d = Math.max(0, Math.min(degree, n - 1));
  const m = d + 1;
  // 正规方程 A c = b。
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const b = new Float64Array(m);
  const pw = new Float64Array(2 * m);
  for (let i = 0; i < n; i++) {
    const t = (xs[i]! - mean) / spread;
    pw[0] = 1;
    for (let k = 1; k < 2 * m; k++) pw[k] = pw[k - 1]! * t;
    for (let r = 0; r < m; r++) {
      b[r]! += pw[r]! * ys[i]!;
      for (let c = 0; c < m; c++) A[r]![c]! += pw[r + c]!;
    }
  }
  // 高斯消元（列主元）。
  const c = new Float64Array(m);
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    [b[col], b[piv]] = [b[piv]!, b[col]!];
    const p = A[col]![col]!;
    if (Math.abs(p) < 1e-12) continue;
    for (let r = col + 1; r < m; r++) {
      const f = A[r]![col]! / p;
      for (let k = col; k < m; k++) A[r]![k]! -= f * A[col]![k]!;
      b[r]! -= f * b[col]!;
    }
  }
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < m; k++) s -= A[r]![k]! * c[k]!;
    c[r] = Math.abs(A[r]![r]!) < 1e-12 ? 0 : s / A[r]![r]!;
  }
  const evaluate = (x: number) => {
    const t = (x - mean) / spread;
    let v = 0;
    for (let k = m - 1; k >= 0; k--) v = v * t + c[k]!;
    return v;
  };
  return { evaluate, slope: m > 1 ? c[1]! / spread : 0 };
}

const angleOf = (xs: readonly number[], ys: readonly number[]) =>
  (Math.atan(polyfit(xs, ys, 1).slope) * 180) / Math.PI;

/**
 * 找文字行的概率图（PP-OCR det 的输出，每像素概率 × 255）→ 横向的文字块：超过 0.3 的像素按 8 连通分块，
 * 宽至少是高的 4 倍、至少是图宽的 4%、平均概率至少 0.6 的块，按列取中心。坐标换算到页面像素。
 */
export function textLinesFromProb(
  prob: Uint8Array,
  width: number,
  height: number,
  page: Size,
): PageLine[] {
  const sx = page.width / width;
  const sy = page.height / height;
  const labels = new Int32Array(width * height);
  const stack: number[] = [];
  const lines: PageLine[] = [];
  let label = 0;
  // 一块里每列像素的个数和 y 之和。
  const count = new Int32Array(width);
  const sum = new Float64Array(width);
  for (let start = 0; start < prob.length; start++) {
    if (labels[start] || prob[start]! <= 76) continue;
    label++;
    labels[start] = label;
    stack.push(start);
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    let area = 0;
    let psum = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      area++;
      psum += prob[p]!;
      count[x]!++;
      sum[x]! += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (!labels[q] && prob[q]! > 76) {
            labels[q] = label;
            stack.push(q);
          }
        }
      }
    }
    const ww = x1 - x0 + 1;
    const hh = y1 - y0 + 1;
    const keep = ww >= 4 * hh && ww >= 0.04 * width && psum / area >= 0.6 * 255;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = x0; x <= x1; x++) {
      if (keep && count[x]! > 0) {
        xs.push(x * sx);
        ys.push((sum[x]! / count[x]!) * sy);
      }
      count[x] = 0;
      sum[x] = 0;
    }
    if (!keep) continue;
    const thick = area / ww;
    lines.push({
      xs,
      ys,
      thickness: thick * sy,
      length: ww * sx,
      long: ww >= 8 * hh,
      angle: angleOf(xs, ys),
    });
  }
  return lines;
}

/** 灰度（和 OpenCV 的 RGB → GRAY 一样的权重）。 */
export function grayOf(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = (data[i]! * 4899 + data[i + 1]! * 9617 + data[i + 2]! * 1868 + 8192) >> 14;
  }
  return out;
}

/**
 * 表格的长线（横线宽 ≥ 图宽 25%，竖线高 ≥ 图高 15%）：局部均值阈值找出深色像素，只留够长的横向（竖向）连续段，
 * 稍微加粗后分块，每块按列（竖线按行）取中心。参数按长边 2000 定的，别的大小按比例换算。
 * 返回页面像素；竖线的 xs / ys 也是页面坐标（angle 是相对竖直方向的偏角）。
 */
export function ruleLines(
  gray: Uint8Array,
  width: number,
  height: number,
  page: Size,
  vertical: boolean,
): PageLine[] {
  // 竖线：转置后当横线找。
  const w = vertical ? height : width;
  const h = vertical ? width : height;
  // 转置成一块连续的内存（手机上的 JS 没有 JIT，逐像素的函数调用很贵）。
  let g = gray;
  if (vertical) {
    g = new Uint8Array(w * h);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) g[x * w + y] = gray[y * width + x]!;
    }
  }
  const s = Math.max(width, height) / 2000;
  const half = Math.max(1, Math.round((31 * s - 1) / 2));
  // 局部均值（积分图，窗口截在图内）。
  const W1 = w + 1;
  const integral = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const o = (y + 1) * W1;
    const p = y * W1;
    const r = y * w;
    for (let x = 0; x < w; x++) {
      row += g[r + x]!;
      integral[o + x + 1] = integral[p + x + 1]! + row;
    }
  }
  const xa = new Int32Array(w);
  const xb = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    xa[x] = x - half < 0 ? 0 : x - half;
    xb[x] = x + half + 1 > w ? w : x + half + 1;
  }
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = (y - half < 0 ? 0 : y - half) * W1;
    const yb = (y + half + 1 > h ? h : y + half + 1) * W1;
    const rows = yb / W1 - ya / W1;
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const a = xa[x]!;
      const b = xb[x]!;
      const total = integral[yb + b]! - integral[ya + b]! - integral[yb + a]! + integral[ya + a]!;
      const area = rows * (b - a);
      // g ≤ 均值 − 12，两边乘面积，免去除法。
      if (g[r + x]! * area <= total - 12 * area) dark[r + x] = 1;
    }
  }
  // 只留至少 L 长的横向连续段（形态学开运算），再上下各加 1 行、左右各加 reach 列。
  const L = Math.max(2, Math.floor(w / (vertical ? 14 : 12)));
  const reach = Math.max(1, Math.round(7 * s));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!dark[y * w + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && dark[y * w + e]) e++;
      if (e - x >= L) {
        const a = Math.max(0, x - reach);
        const b = Math.min(w - 1, e - 1 + reach);
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          mask.fill(1, yy * w + a, yy * w + b + 1);
        }
      }
      x = e;
    }
  }
  // 分块（8 连通）。
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const count = new Int32Array(w);
  const sum = new Float64Array(w);
  const out: PageLine[] = [];
  const maxThick = 60 * s;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      count[x]!++;
      sum[x]! += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    const keep = x1 - x0 + 1 >= (vertical ? 0.15 : 0.25) * w && y1 - y0 + 1 <= maxThick;
    const along: number[] = [];
    const across: number[] = [];
    for (let x = x0; x <= x1; x++) {
      if (keep && count[x]! > 0) {
        along.push(x);
        across.push(sum[x]! / count[x]!);
      }
      count[x] = 0;
      sum[x] = 0;
    }
    if (!keep) continue;
    const angle = angleOf(along, across);
    // 换算到页面像素。
    const kx = page.width / width;
    const ky = page.height / height;
    const xs = vertical ? across.map((v) => v * kx) : along.map((v) => v * kx);
    const ys = vertical ? along.map((v) => v * ky) : across.map((v) => v * ky);
    out.push({
      xs,
      ys,
      thickness: 0,
      length: (x1 - x0 + 1) * (vertical ? ky : kx),
      long: true,
      angle,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 精修：整页去倾斜 + 逐行拉直

/** 精修的结果：转正的角度和位移网格（在展平图的像素上，每 step 像素一个点）。 */
export interface Refinement {
  /** 整页转正的角度（度，正数表示行往右下斜、要逆时针转回来）。 */
  angle: number;
  step: number;
  cols: number;
  rows: number;
  /** 每个网格点上：输出 (x, y) 取精修前（转正后）的 (x + dx, y + dy)。 */
  dx: Float32Array;
  dy: Float32Array;
  /** 用来拉直的文字行条数；少于 REFINE_MIN_LINES 时没有拉直（位移全是 0），也不转。 */
  lines: number;
}

/** 位移网格的步长（像素）。 */
export function meshStep(page: Size): number {
  const long = Math.max(page.width, page.height);
  let step = Math.max(4, Math.round(long / MESH_CELLS_LONG));
  while ((Math.floor(page.width / step) + 2) * (Math.floor(page.height / step) + 2) > MAX_VERTICES)
    step++;
  return step;
}

/** 按长度加权的中位数（和 numpy 的 searchsorted 写法一样：累计权重第一次到一半的那个）。 */
function weightedMedian(values: readonly number[], weights: readonly number[]): number {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  let total = 0;
  for (const w of weights) total += w;
  let acc = 0;
  for (const i of order) {
    acc += weights[i]!;
    if (acc >= total / 2) return values[i]!;
  }
  return values[order.at(-1)!] ?? 0;
}

/**
 * 整页转正的角度：长文字行和表格横线的角度，按长度取加权中位数。少于 5 条、小于 0.1° 不转；
 * 限在 ±0.5° 以内；只有一条竖线时不转（拉正后残留一点剪切时，按文字转正会把这条竖线转歪）。
 */
export function deskewAngle(
  text: readonly PageLine[],
  rulesH: readonly PageLine[],
  rulesV: readonly PageLine[],
): number {
  const used = [...text.filter((l) => l.long), ...rulesH];
  if (used.length < REFINE_MIN_LINES || rulesV.length === 1) return 0;
  const a = weightedMedian(
    used.map((l) => l.angle),
    used.map((l) => l.length),
  );
  if (Math.abs(a) < DESKEW_MIN) return 0;
  return clamp(a, -DESKEW_LIMIT, DESKEW_LIMIT);
}

/** 以页面中心转 angle 度（正数：往右下斜的行变水平）。inverse 是反过来。 */
export function rotatePoint(page: Size, angle: number, p: Point, inverse = false): Point {
  if (!angle) return p;
  const a = ((inverse ? -angle : angle) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cx = page.width / 2;
  const cy = page.height / 2;
  const x = p.x - cx;
  const y = p.y - cy;
  return { x: c * x + s * y + cx, y: -s * x + c * y + cy };
}

function rotateLine(page: Size, angle: number, line: PageLine): PageLine {
  if (!angle) return line;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < line.xs.length; i++) {
    const p = rotatePoint(page, angle, { x: line.xs[i]!, y: line.ys[i]! });
    xs.push(p.x);
    ys.push(p.y);
  }
  return { ...line, xs, ys, angle: line.angle - angle };
}

/** 同一行被断开的几段接起来：左右相邻、间隔小于 4 倍行高、接口处高度差小于 0.6 倍行高、行高相近。 */
export function chainLines(lines: readonly PageLine[]): PageLine[] {
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
  };
  const lo = (v: readonly number[]) => v.reduce((a, b) => (b < a ? b : a), Infinity);
  const hi = (v: readonly number[]) => v.reduce((a, b) => (b > a ? b : a), -Infinity);
  const sorted = lines
    .map((l) => ({ l, x: lo(l.xs) }))
    .sort((a, b) => a.x - b.x)
    .map((e) => e.l);
  const starts = sorted.map((l) => lo(l.xs));
  // 每条线开头一段（3 倍行高以内）的中值高度，只算一次。
  const heads = sorted.map((l, j) => {
    const x0 = starts[j]!;
    return median(l.ys.filter((_, k) => l.xs[k]! <= x0 + 3 * l.thickness));
  });
  const used = sorted.map(() => false);
  const out: PageLine[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let xs = [...sorted[i]!.xs];
    let ys = [...sorted[i]!.ys];
    let h = sorted[i]!.thickness;
    for (;;) {
      const xe = hi(xs);
      const ye = median(ys.filter((_, k) => xs[k]! >= xe - 3 * h));
      let best: { gap: number; j: number } | null = null;
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue;
        const b = sorted[j]!;
        const gap = starts[j]! - xe;
        if (gap < -h || gap > 4 * h) continue;
        const yb = heads[j]!;
        if (
          Math.abs(yb - ye) < 0.6 * Math.min(h, b.thickness) &&
          Math.abs(b.thickness - h) < 0.5 * h &&
          (!best || gap < best.gap)
        ) {
          best = { gap, j };
        }
      }
      if (!best) break;
      const b = sorted[best.j]!;
      used[best.j] = true;
      xs = xs.concat(b.xs);
      ys = ys.concat(b.ys);
      h = (h + b.thickness) / 2;
    }
    const length = hi(xs) - lo(xs);
    out.push({ ...sorted[i]!, xs, ys, thickness: h, length, angle: angleOf(xs, ys) });
  }
  return out;
}

/** 滑动中值（窗口 size，边缘取最近的值）。 */
function medianFilter(v: Float64Array, size: number): Float64Array {
  const r = size >> 1;
  const out = new Float64Array(v.length);
  const win: number[] = [];
  for (let i = 0; i < v.length; i++) {
    win.length = 0;
    for (let k = -r; k <= r; k++) win.push(v[clamp(i + k, 0, v.length - 1)]!);
    win.sort((a, b) => a - b);
    out[i] = win[r]!;
  }
  return out;
}

/** 一维高斯平滑（截到 4σ，边缘取最近的值）。 */
function gaussian1d(v: Float64Array, sigma: number): Float64Array {
  const r = Math.round(4 * sigma);
  const k = new Float64Array(2 * r + 1);
  let total = 0;
  for (let i = -r; i <= r; i++) total += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += v[clamp(i + j, 0, v.length - 1)]! * k[j + r]!;
    out[i] = s / total;
  }
  return out;
}

/** 线性插值（xp 递增；两头取端点的值，和 numpy.interp 一样）。 */
function interp(x: number, xp: ArrayLike<number>, fp: ArrayLike<number>): number {
  const n = xp.length;
  if (x <= xp[0]!) return fp[0]!;
  if (x >= xp[n - 1]!) return fp[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const span = xp[hi]! - xp[lo]!;
  return span > 0 ? fp[lo]! + ((fp[hi]! - fp[lo]!) * (x - xp[lo]!)) / span : fp[lo]!;
}

/** 一条线拉直的样本：它的目标位置（横线是高度）、左右范围和每处的位移。 */
interface Sample {
  target: number;
  from: number;
  to: number;
  shift: (along: number) => number;
}

/** 一条文字行的样本：长行（≥ 页宽 25%）滑动中值 + 高斯平滑，短行 2 次多项式；目标是它的平均高度。 */
function lineSample(line: PageLine, pageWidth: number): Sample {
  const order = line.xs.map((_, i) => i).sort((a, b) => line.xs[a]! - line.xs[b]!);
  const x = order.map((i) => line.xs[i]!);
  const y = order.map((i) => line.ys[i]!);
  if (line.length > 0.25 * pageWidth) {
    const step = Math.max(line.thickness / 3, 1);
    const n = Math.floor((x.at(-1)! + 1 - x[0]!) / step - 1e-9) + 1;
    const xs = new Float64Array(n);
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = x[0]! + i * step;
      raw[i] = interp(xs[i]!, x, y);
    }
    const ys = gaussian1d(medianFilter(raw, 7), 6);
    let mean = 0;
    for (const v of ys) mean += v;
    mean /= n;
    return {
      target: mean,
      from: xs[0]!,
      to: xs[n - 1]!,
      shift: (v) => interp(v, xs, ys) - mean,
    };
  }
  const fit = polyfit(x, y, 2);
  let mean = 0;
  for (const v of x) mean += fit.evaluate(v);
  mean /= x.length;
  return {
    target: mean,
    from: x[0]!,
    to: x.at(-1)!,
    shift: (v) => fit.evaluate(v) - mean,
  };
}

/** 表格线的样本：2 次多项式（竖线是 x 关于 y 的多项式）。 */
function ruleSample(line: PageLine, vertical: boolean): Sample {
  const along = vertical ? line.ys : line.xs;
  const across = vertical ? line.xs : line.ys;
  const fit = polyfit(along, across, 2);
  let mean = 0;
  for (const v of along) mean += fit.evaluate(v);
  mean /= along.length;
  return {
    target: mean,
    from: Math.min(...along),
    to: Math.max(...along),
    shift: (v) => fit.evaluate(v) - mean,
  };
}

/**
 * 样本 → 位移场（rows × cols，按行存）：沿线方向的每一列，把覆盖它的线按目标位置排好，在线与线之间线性插值，
 * 两头取常数；没有线的列从左右相邻的列插值。transpose 时 major 是 y（竖线）。
 */
function field(
  samples: readonly Sample[],
  nMajor: number,
  nMinor: number,
  step: number,
  spread: number,
): Float32Array {
  const F = new Float64Array(nMinor * nMajor).fill(NaN);
  const filled: number[] = [];
  for (let j = 0; j < nMajor; j++) {
    const x = j * step;
    const pts: { d: number; u: number }[] = [];
    for (const s of samples) {
      if (s.from - spread <= x && x <= s.to + spread) {
        pts.push({ d: s.shift(clamp(x, s.from, s.to)), u: s.target });
      }
    }
    if (!pts.length) continue;
    pts.sort((a, b) => a.u - b.u);
    const us = pts.map((p) => p.u);
    const ds = pts.map((p) => p.d);
    for (let i = 0; i < nMinor; i++) F[i * nMajor + j] = interp(i * step, us, ds);
    filled.push(j);
  }
  const out = new Float32Array(nMinor * nMajor);
  if (!filled.length) return out;
  const vals = new Float64Array(filled.length);
  for (let i = 0; i < nMinor; i++) {
    for (let k = 0; k < filled.length; k++) vals[k] = F[i * nMajor + filled[k]!]!;
    for (let j = 0; j < nMajor; j++) out[i * nMajor + j] = interp(j, filled, vals);
  }
  return out;
}

/** 二维高斯平滑（可分离，边缘按 OpenCV 的 BORDER_REFLECT_101），sx / sy 是两个方向的 σ（网格单位）。 */
function blur2d(f: Float32Array, cols: number, rows: number, sx: number, sy: number): Float32Array {
  const kernel = (sigma: number) => {
    const r = Math.floor((Math.round(sigma * 8 + 1) | 1) / 2);
    const k = new Float64Array(2 * r + 1);
    let t = 0;
    for (let i = -r; i <= r; i++) t += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
    for (let i = 0; i < k.length; i++) k[i]! /= t;
    return { r, k };
  };
  const reflect = (i: number, n: number) => {
    if (n === 1) return 0;
    while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
    return i;
  };
  const kx = kernel(sx);
  const ky = kernel(sy);
  const tmp = new Float32Array(f.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let j = -kx.r; j <= kx.r; j++)
        s += f[y * cols + reflect(x + j, cols)]! * kx.k[j + kx.r]!;
      tmp[y * cols + x] = s;
    }
  }
  const out = new Float32Array(f.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let j = -ky.r; j <= ky.r; j++)
        s += tmp[reflect(y + j, rows) * cols + x]! * ky.k[j + ky.r]!;
      out[y * cols + x] = s;
    }
  }
  return out;
}

/**
 * 精修的计划：先算整页转正的角度，把行和表格线按它转过去（不用再找一遍），再逐行拉直：
 * 每条行（≥ 页宽 6%，断开的先接起来）的目标是一条水平线，竖直位移 = 中心线 − 目标；
 * 表格横线一样；有两条以上竖线时，同样的办法算水平位移让竖线变直。位移网格平滑后限幅在长边的 2% 以内。
 */
export function planRefinement(
  page: Size,
  text: readonly PageLine[],
  rulesH: readonly PageLine[] = [],
  rulesV: readonly PageLine[] = [],
): Refinement {
  const step = meshStep(page);
  const cols = Math.floor(page.width / step) + 2;
  const rows = Math.floor(page.height / step) + 2;
  const zero = {
    angle: 0,
    step,
    cols,
    rows,
    dx: new Float32Array(cols * rows),
    dy: new Float32Array(cols * rows),
  };
  const W = page.width;
  const H = page.height;
  const counted = chainLines(text.filter((l) => l.length >= 0.02 * W)).filter(
    (l) => l.length >= 0.06 * W,
  );
  if (counted.length < REFINE_MIN_LINES) return { ...zero, lines: 0 };
  const angle = deskewAngle(text, rulesH, rulesV);
  const turn = (l: PageLine) => rotateLine(page, angle, l);
  const lines = chainLines(text.map(turn).filter((l) => l.length >= 0.02 * W)).filter(
    (l) => l.length >= 0.06 * W,
  );
  const hs = [
    ...lines.map((l) => lineSample(l, W)),
    ...rulesH.map(turn).map((l) => ruleSample(l, false)),
  ];
  let dy: Float32Array = field(hs, cols, rows, step, 0.03 * W);
  let dx: Float32Array = new Float32Array(cols * rows);
  if (rulesV.length >= 2) {
    const vs = rulesV.map(turn).map((l) => ruleSample(l, true));
    const t = field(vs, rows, cols, step, 0.03 * H);
    // field 按 [cols 行, rows 列] 排（major 是 y），转回 [rows, cols]。
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) dx[j * cols + i] = t[i * rows + j]!;
  }
  dy = blur2d(dy, cols, rows, 1.5, 0.7);
  dx = blur2d(dx, cols, rows, 0.7, 1.5);
  const lim = SHIFT_LIMIT_SHARE * Math.max(W, H);
  for (let i = 0; i < dy.length; i++) {
    dy[i] = clamp(dy[i]!, -lim, lim);
    dx[i] = clamp(dx[i]!, -lim, lim);
  }
  return { angle, step, cols, rows, dx, dy, lines: lines.length };
}

/** 位移网格在一点上的值（双线性，边缘取边缘值）。 */
function shiftAt(r: Refinement, x: number, y: number): Point {
  const gx = clamp(x / r.step, 0, r.cols - 1);
  const gy = clamp(y / r.step, 0, r.rows - 1);
  const x0 = Math.min(Math.floor(gx), r.cols - 2);
  const y0 = Math.min(Math.floor(gy), r.rows - 2);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (f: Float32Array, yy: number, xx: number) => f[yy * r.cols + xx]!;
  const lerp = (f: Float32Array) =>
    (at(f, y0, x0) * (1 - fx) + at(f, y0, x0 + 1) * fx) * (1 - fy) +
    (at(f, y0 + 1, x0) * (1 - fx) + at(f, y0 + 1, x0 + 1) * fx) * fy;
  return { x: lerp(r.dx), y: lerp(r.dy) };
}

/**
 * 输出图上一点 → 拉正图上的位置（三步合成）：先加精修的位移，再按转正的角度转回去，最后查 UVDoc 网格。
 * 没有 UVDoc（只精修）或没有精修（只展平）时跳过那一步。
 */
export function flattenSource(
  page: Size,
  warp: UvdocWarp | null,
  refine: Refinement | null,
  x: number,
  y: number,
): Point {
  let p = { x, y };
  if (refine) {
    const d = shiftAt(refine, x, y);
    p = rotatePoint(page, refine.angle, { x: x + d.x, y: y + d.y }, true);
  }
  return warp
    ? uvdocSource(warp, p.x, p.y)
    : { x: clamp(p.x, 0, page.width - 1), y: clamp(p.y, 0, page.height - 1) };
}

/**
 * 拉正图上的一点 → 输出图上的位置（flattenSource 反过来，用于把找到的文字行换算到展平后的图上）：
 * 不动点迭代，位移场很平滑，几次就收敛。只在没有 UVDoc 的那一步（精修）上用。
 */
export function refinedPosition(page: Size, refine: Refinement, p: Point): Point {
  const q = rotatePoint(page, refine.angle, p);
  let out = q;
  for (let i = 0; i < 6; i++) {
    const d = shiftAt(refine, out.x, out.y);
    out = { x: q.x - d.x, y: q.y - d.y };
  }
  return out;
}

/** 给 Skia 的 drawVertices：三角形的顶点（输出图上的位置）、纹理坐标（源图上的位置）和索引。 */
export interface WarpMesh {
  positions: Float32Array;
  texcoords: Float32Array;
  indices: Uint16Array;
}

/**
 * 三步合成的三角网格：顶点在输出图上均匀分布（每 step 像素一个，四边贴着画布边缘），纹理坐标来自 flattenSource。
 * out 是要画出来的大小（可以比页面小，例如给找文字行用的小图），坐标按比例换算；Skia 的像素中心在 0.5。
 */
export function flattenMesh(
  page: Size,
  warp: UvdocWarp | null,
  refine: Refinement | null,
  out: Size = page,
  step = meshStep(page),
): WarpMesh {
  const xs: number[] = [];
  for (let v = 0; v < page.width; v += step) xs.push(v);
  xs.push(page.width);
  const ys: number[] = [];
  for (let v = 0; v < page.height; v += step) ys.push(v);
  ys.push(page.height);
  const nx = xs.length;
  const ny = ys.length;
  const positions = new Float32Array(nx * ny * 2);
  const texcoords = new Float32Array(nx * ny * 2);
  const kx = out.width / page.width;
  const ky = out.height / page.height;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 2;
      positions[o] = xs[i]! * kx;
      positions[o + 1] = ys[j]! * ky;
      // 画布边缘（连续坐标）对应的像素序号：中心在 +0.5。
      const s = flattenSource(page, warp, refine, xs[i]! - 0.5, ys[j]! - 0.5);
      texcoords[o] = s.x + 0.5;
      texcoords[o + 1] = s.y + 0.5;
    }
  }
  const indices = new Uint16Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }
  return { positions, texcoords, indices };
}
