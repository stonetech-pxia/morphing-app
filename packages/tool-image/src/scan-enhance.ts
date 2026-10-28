// 扫描件增强的纯算法（D-266）：在缩小的分析图上估计纸张背景、黑白两端、彩色还是灰度、文字倾斜角，
// 黑白模式再算局部阈值要用的均值和标准差。全分辨率的逐像素运算交给 App 里的 Skia 着色器，
// 这里只处理小图，在 Node 里可以直接测试。去噪点是唯一在全分辨率上跑的部分（只看黑点）。
//
// 思路参考 ScanTailor 的光照归一化（背景 → 除法）和投影法纠偏、FairScan 的纸色拉白和 Sauvola，
// 都是按论文和公开算法自己写的，没有拷贝它们的代码（两者都是 GPL）。

import type { Size } from './geometry';

/** RGBA 像素（每像素 4 字节，和 Skia 的 RGBA_8888 一致）。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type ScanLook = 'auto' | 'gray' | 'bw';

/** 输出成什么：彩色、灰度、黑白。 */
export type ScanOutput = 'color' | 'gray' | 'bw';

export interface ScanPlan {
  output: ScanOutput;
  /** 纸张背景（每格一个颜色，RGBA）。在全图上按格子中心双线性插值，像素除以它。 */
  background: RgbaImage;
  /** 除过背景之后的黑点和白点（0–1 附近）：lo 映射成黑，hi 映射成白。 */
  lo: number;
  hi: number;
  /** 文字行的倾斜角（度，图片坐标 y 向下，正数是向右下斜）；拉正要转 -skew。没把握时是 0。 */
  skew: number;
  /** 黑白模式的局部统计（R = 均值 × 255，G = 标准差 × 2 × 255），其他模式是 null。 */
  stats: RgbaImage | null;
}

/** 背景格子的长边格数。分析图长边 800 时每格约 17 像素，比字大、比阴影的变化小。 */
const GRID_LONG = 48;
/** 每格里取亮度排前 10% 的像素当纸张（字是暗的，而且一般只占一小部分）。 */
const PAPER_SHARE = 0.1;
/** 比周围的纸暗一半以上的格子当作图片或大块深色，用周围的纸色补上；没那么暗的当作阴影，照常拉白。 */
const OUTLIER_RATIO = 0.5;
/** 背景的下限（相对整页纸色），防止除法把深色区域放大成白。 */
const BACKGROUND_FLOOR = 0.3;

/** 判断彩色：颜色够浓（max − min）的块占比超过这个就是彩色（FairScan 是 0.03%，这里按 4×4 的块算，放宽一点）。 */
const COLOR_CHROMA = 0.15;
const COLOR_SHARE = 0.001;

/** 纠偏：只在 ±7° 里找，先 1° 粗搜，再在最好的角度两边 1° 内按 0.1° 细搜；小于 0.15° 不转。 */
const SKEW_RANGE = 7;
const SKEW_COARSE = 1;
const SKEW_FINE = 0.1;
const SKEW_MIN = 0.15;
/** 最好角度的分数至少是所有角度平均分的这么多倍才算有把握（只有图片、没有成行的字时不转）。 */
const SKEW_CONFIDENCE = 1.6;

/** Sauvola：k 越大越容易判成白；窗口按统计图长边的比例。 */
export const SAUVOLA_K = 0.3;
const SAUVOLA_WINDOW_SHARE = 1 / 24;

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

/** 第 i 个格子覆盖的像素范围 [start, end)：格子均匀分布，和着色器按格子中心采样一致。 */
function cellRange(i: number, cells: number, size: number): [number, number] {
  return [Math.floor((i * size) / cells), Math.floor(((i + 1) * size) / cells)];
}

export function gridSize(size: Size, long = GRID_LONG): Size {
  const k = long / Math.max(size.width, size.height);
  return {
    width: Math.max(1, Math.round(size.width * k)),
    height: Math.max(1, Math.round(size.height * k)),
  };
}

/** 在格子图上按 0–1 的位置双线性取值（边缘外取边缘值），和 Skia 的线性采样 + Clamp 一样。 */
export function sampleGrid(grid: RgbaImage, u: number, v: number, out: Float32Array): void {
  const gx = clamp(u * grid.width - 0.5, 0, grid.width - 1);
  const gy = clamp(v * grid.height - 0.5, 0, grid.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, grid.width - 1);
  const y1 = Math.min(y0 + 1, grid.height - 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const d = grid.data;
  const w = grid.width;
  for (let c = 0; c < 3; c++) {
    const a = d[(y0 * w + x0) * 4 + c]!;
    const b = d[(y0 * w + x1) * 4 + c]!;
    const e = d[(y1 * w + x0) * 4 + c]!;
    const f = d[(y1 * w + x1) * 4 + c]!;
    out[c] = ((a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy) / 255;
  }
}

/** 小格子上的加权方框模糊（权重为 0 的格子不参与，相当于用周围补上）。 */
function maskedBlur(
  values: Float32Array,
  weights: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let wsum = 0;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
          const w = weights[yy * width + xx]!;
          sum += values[yy * width + xx]! * w;
          wsum += w;
        }
      }
      out[y * width + x] = wsum > 0 ? sum / wsum : NaN;
    }
  }
  return out;
}

/**
 * 小格子上的加权中位数（只看权重不为 0 的格子；值是 0–255 的亮度，取整后用滑动直方图，
 * 每移一格只加减一列，在没有 JIT 的 Hermes 上也很快）。
 */
function maskedMedian(
  values: Float32Array,
  weights: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const hist = new Int32Array(256);
  const bin = (j: number) => Math.min(255, Math.max(0, Math.round(values[j]!)));
  for (let y = 0; y < height; y++) {
    const ya = Math.max(0, y - radius);
    const yb = Math.min(height - 1, y + radius);
    hist.fill(0);
    let count = 0;
    const column = (xx: number, d: number) => {
      for (let yy = ya; yy <= yb; yy++) {
        const j = yy * width + xx;
        if (weights[j]! > 0) {
          hist[bin(j)]! += d;
          count += d;
        }
      }
    };
    for (let xx = 0; xx <= Math.min(width - 1, radius); xx++) column(xx, 1);
    for (let x = 0; x < width; x++) {
      if (x > 0) {
        if (x - radius - 1 >= 0) column(x - radius - 1, -1);
        if (x + radius < width) column(x + radius, 1);
      }
      if (count === 0) {
        out[y * width + x] = NaN;
        continue;
      }
      let need = (count >> 1) + 1;
      let v = 0;
      for (; v < 255; v++) {
        need -= hist[v]!;
        if (need <= 0) break;
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

/**
 * 估计纸张背景：每格取最亮的 10% 像素的平均颜色，再去掉比周围暗很多的格子（字太密、图片、深色块），
 * 最后平滑。每个通道分开估，所以除完之后纸张也变成中性的白（顺带校正了白平衡）。
 */
export function estimateBackground(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const grid = gridSize(image);
  const gw = grid.width;
  const gh = grid.height;
  const n = gw * gh;
  const cell = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  // 每个像素的亮度只算一次（整数，Rec.601 权重 × 256）。
  const y8 = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    y8[p] = (77 * data[p * 4]! + 150 * data[p * 4 + 1]! + 29 * data[p * 4 + 2]! + 128) >> 8;
  }
  for (let gy = 0; gy < gh; gy++) {
    const [y0, y1] = cellRange(gy, gh, height);
    for (let gx = 0; gx < gw; gx++) {
      const [x0, x1] = cellRange(gx, gw, width);
      hist.fill(0);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) hist[y8[y * width + x]!]!++;
        count += x1 - x0;
      }
      const g = gy * gw + gx;
      if (count === 0) continue;
      // 亮度排前 10% 的门槛。
      let need = Math.max(1, Math.round(count * PAPER_SHARE));
      let cut = 255;
      for (; cut > 0; cut--) {
        need -= hist[cut]!;
        if (need <= 0) break;
      }
      let r = 0;
      let gr = 0;
      let b = 0;
      let m = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (y8[y * width + x]! >= cut) {
            const i = (y * width + x) * 4;
            r += data[i]!;
            gr += data[i + 1]!;
            b += data[i + 2]!;
            m++;
          }
        }
      }
      cell[0][g] = r / m;
      cell[1][g] = gr / m;
      cell[2][g] = b / m;
      lum[g] = luma(r / m, gr / m, b / m);
    }
  }

  // 去掉比周围纸色暗很多的格子（字太密、图片、黑块）：和大范围的中位数比（用中位数，
  // 旁边有反光时参照值不会被拉高，反光周围的纸不会被误删，D-266），迭代到不再变化。
  const weights = new Float32Array(n).fill(1);
  const wide = Math.max(2, Math.round(Math.max(gw, gh) / 4));
  // 大块图片从边缘往里一圈圈被去掉，所以多迭代几次（格子很少，很快）。
  for (let pass = 0; pass < 12; pass++) {
    const ref = maskedMedian(lum, weights, gw, gh, wide);
    let changed = false;
    for (let g = 0; g < n; g++) {
      const ok = !(lum[g]! < OUTLIER_RATIO * ref[g]!);
      if ((weights[g] === 1) !== ok) changed = true;
      weights[g] = ok ? 1 : 0;
    }
    if (!changed) break;
  }
  if (!weights.some((w) => w > 0)) weights.fill(1);

  // 整页纸色：有效格子亮度的中位数，用来定下限。
  const valid = Array.from(lum).filter((_, g) => weights[g]! > 0);
  valid.sort((a, b) => a - b);
  const paper = valid[Math.floor(valid.length / 2)] ?? 255;

  const out = new Uint8Array(n * 4);
  const smooth = cell.map((ch) => {
    // 先用有效格子补上无效的，再整体轻微平滑。
    const filled = maskedBlur(ch, weights, gw, gh, 1);
    // 周围一圈都无效（大块图片中间）时才需要更大范围的补法。
    let wider: Float32Array | null = null;
    for (let g = 0; g < n; g++) {
      if (weights[g]! > 0) filled[g] = ch[g]!;
      else if (Number.isNaN(filled[g]!)) {
        wider ??= maskedBlur(ch, weights, gw, gh, wide);
        filled[g] = wider[g]!;
      }
      if (Number.isNaN(filled[g]!)) filled[g] = paper;
    }
    return maskedBlur(filled, new Float32Array(n).fill(1), gw, gh, 1);
  });
  const floor = Math.max(10, paper * BACKGROUND_FLOOR);
  for (let g = 0; g < n; g++) {
    for (let c = 0; c < 3; c++) out[g * 4 + c] = Math.round(clamp(smooth[c]![g]!, floor, 255));
    out[g * 4 + 3] = 255;
  }
  return { width: gw, height: gh, data: out };
}

/** 除以背景后的颜色（0–1 附近，纸张约为 1）。背景按格子中心双线性插值，和 sampleGrid 一样，只是按行预先算好。 */
export function normalizeByBackground(image: RgbaImage, background: RgbaImage): Float32Array {
  const { width, height, data } = image;
  const gw = background.width;
  const gh = background.height;
  const bd = background.data;
  const out = new Float32Array(width * height * 3);
  // 每一列在格子里的位置。
  const cx0 = new Int32Array(width);
  const cx1 = new Int32Array(width);
  const cfx = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const gx = clamp(((x + 0.5) / width) * gw - 0.5, 0, gw - 1);
    cx0[x] = Math.floor(gx);
    cx1[x] = Math.min(cx0[x]! + 1, gw - 1);
    cfx[x] = gx - cx0[x]!;
  }
  // 当前行在竖直方向插值后的格子颜色。
  const row = new Float32Array(gw * 3);
  for (let y = 0; y < height; y++) {
    const gy = clamp(((y + 0.5) / height) * gh - 0.5, 0, gh - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(y0 + 1, gh - 1);
    const fy = gy - y0;
    for (let gx = 0; gx < gw; gx++) {
      for (let c = 0; c < 3; c++) {
        row[gx * 3 + c] =
          (bd[(y0 * gw + gx) * 4 + c]! * (1 - fy) + bd[(y1 * gw + gx) * 4 + c]! * fy) / 255;
      }
    }
    for (let x = 0; x < width; x++) {
      const a = cx0[x]! * 3;
      const b = cx1[x]! * 3;
      const f = cfx[x]!;
      const i = (y * width + x) * 4;
      const o = (y * width + x) * 3;
      out[o] = data[i]! / 255 / (row[a]! + (row[b]! - row[a]!) * f);
      out[o + 1] = data[i + 1]! / 255 / (row[a + 1]! + (row[b + 1]! - row[a + 1]!) * f);
      out[o + 2] = data[i + 2]! / 255 / (row[a + 2]! + (row[b + 2]! - row[a + 2]!) * f);
    }
  }
  return out;
}

const LEVEL_BINS = 512;
const LEVEL_MAX = 2;

/**
 * 黑白两端：白点取纸张（亮度直方图在 0.6 以上的峰）稍低一点，纸上的噪点直接变白；
 * 黑点取最暗的 0.5%，但不超过白点的一半，空白页不会被拉成一片噪点。
 */
export function levelsOf(normalized: Float32Array): { lo: number; hi: number } {
  const hist = new Uint32Array(LEVEL_BINS);
  const pixels = normalized.length / 3;
  for (let p = 0; p < pixels; p++) {
    const y = luma(normalized[p * 3]!, normalized[p * 3 + 1]!, normalized[p * 3 + 2]!);
    hist[Math.min(LEVEL_BINS - 1, Math.floor((y / LEVEL_MAX) * LEVEL_BINS))]!++;
  }
  const binOf = (v: number) => Math.floor((v / LEVEL_MAX) * LEVEL_BINS);
  let peak = binOf(0.6);
  for (let b = peak; b < LEVEL_BINS; b++) if (hist[b]! > hist[peak]!) peak = b;
  const paper = ((peak + 0.5) / LEVEL_BINS) * LEVEL_MAX;
  const hi = clamp(paper * 0.94, 0.5, 1.2);
  let need = pixels * 0.005;
  let b = 0;
  for (; b < LEVEL_BINS - 1; b++) {
    need -= hist[b]!;
    if (need <= 0) break;
  }
  const lo = clamp(((b + 0.5) / LEVEL_BINS) * LEVEL_MAX, 0, hi * 0.5);
  return { lo, hi };
}

/** 按黑白两端拉伸后的亮度（0–1）。 */
export function leveledLuma(normalized: Float32Array, lo: number, hi: number): Float32Array {
  const pixels = normalized.length / 3;
  const out = new Float32Array(pixels);
  const span = hi - lo;
  for (let p = 0; p < pixels; p++) {
    const y = luma(normalized[p * 3]!, normalized[p * 3 + 1]!, normalized[p * 3 + 2]!);
    out[p] = clamp((y - lo) / span, 0, 1);
  }
  return out;
}

/**
 * 黑白模式用的「墨水深浅」：拉伸后三个通道里最暗的那个（0–1）。红字、蓝字的某个通道很暗，
 * 按亮度算会被当成浅色、二值化后消失；按最暗的通道算就和黑字一样。白纸三个通道都亮，不受影响。
 */
export function leveledInk(normalized: Float32Array, lo: number, hi: number): Float32Array {
  const pixels = normalized.length / 3;
  const out = new Float32Array(pixels);
  const span = hi - lo;
  for (let p = 0; p < pixels; p++) {
    const m = Math.min(normalized[p * 3]!, normalized[p * 3 + 1]!, normalized[p * 3 + 2]!);
    out[p] = clamp((m - lo) / span, 0, 1);
  }
  return out;
}

/**
 * 彩色还是灰度：除过背景（纸已经是中性白）后，按 4×4 的块取平均（压掉噪点和摩尔纹），
 * 不太暗也不太亮、颜色够浓的块占比超过 0.1% 就保留彩色。
 */
export function looksColored(
  normalized: Float32Array,
  width: number,
  height: number,
  lo: number,
  hi: number,
): boolean {
  const B = 4;
  const span = hi - lo;
  let colored = 0;
  let blocks = 0;
  for (let by = 0; by + B <= height; by += B) {
    for (let bx = 0; bx + B <= width; bx += B) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = by; y < by + B; y++) {
        for (let x = bx; x < bx + B; x++) {
          const o = (y * width + x) * 3;
          r += normalized[o]!;
          g += normalized[o + 1]!;
          b += normalized[o + 2]!;
        }
      }
      const k = 1 / (B * B);
      r = clamp((r * k - lo) / span, 0, 1);
      g = clamp((g * k - lo) / span, 0, 1);
      b = clamp((b * k - lo) / span, 0, 1);
      blocks++;
      const y = luma(r, g, b);
      if (y < 0.12 || y > 0.9) continue;
      if (Math.max(r, g, b) - Math.min(r, g, b) > COLOR_CHROMA) colored++;
    }
  }
  return blocks > 0 && colored / blocks > COLOR_SHARE;
}

/**
 * 投影法找文字倾斜（ScanTailor 的思路）：把暗点按候选角度剪切后逐行计数，
 * 文字行对齐时相邻行的计数差最大。返回 0 表示没把握或不需要转。
 */
export function findSkew(lumaImage: Float32Array, width: number, height: number): number {
  // 暗点坐标；太多时隔点取样。
  let dark = 0;
  for (let p = 0; p < lumaImage.length; p++) if (lumaImage[p]! < 0.5) dark++;
  // 字太少（或者几乎全是黑的）都不转。
  if (dark < 200 || dark > lumaImage.length * 0.5) return 0;
  const step = Math.max(1, Math.ceil(dark / 40_000));
  const xs: number[] = [];
  const ys: number[] = [];
  let seen = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (lumaImage[y * width + x]! < 0.5 && seen++ % step === 0) {
        xs.push(x - width / 2);
        ys.push(y);
      }
    }
  }
  const pad = Math.ceil((width / 2) * Math.tan((SKEW_RANGE * Math.PI) / 180)) + 2;
  const rows = new Float64Array(height + pad * 2);
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    rows.fill(0);
    for (let i = 0; i < xs.length; i++) rows[Math.round(ys[i]! - xs[i]! * t) + pad]!++;
    let s = 0;
    for (let r = 1; r < rows.length; r++) {
      const d = rows[r]! - rows[r - 1]!;
      s += d * d;
    }
    return s;
  };
  let best = 0;
  let bestScore = -1;
  let total = 0;
  let tried = 0;
  for (let deg = -SKEW_RANGE; deg <= SKEW_RANGE + 1e-9; deg += SKEW_COARSE) {
    const s = score(deg);
    total += s;
    tried++;
    if (s > bestScore) {
      bestScore = s;
      best = deg;
    }
  }
  if (bestScore < (total / tried) * SKEW_CONFIDENCE) return 0;
  const center = best;
  for (let deg = center - SKEW_COARSE; deg <= center + SKEW_COARSE + 1e-9; deg += SKEW_FINE) {
    const s = score(deg);
    if (s > bestScore) {
      bestScore = s;
      best = deg;
    }
  }
  best = Math.round(best * 100) / 100;
  return Math.abs(best) < SKEW_MIN ? 0 : best;
}

/** 旋转 deg 度后能放下整张图的画布大小（四个角不会被裁掉）。 */
export function rotatedSize(size: Size, deg: number): Size {
  const a = Math.abs((deg * Math.PI) / 180);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    width: Math.ceil(size.width * c + size.height * s - 1e-6),
    height: Math.ceil(size.width * s + size.height * c - 1e-6),
  };
}

/**
 * 黑白模式的局部统计：墨水深浅（leveledInk）先 2×2 缩小，再用积分图算窗口内的均值和标准差（Sauvola 用）。
 * 窗口很大（约长边的 1/24），统计图在全图上插值，误差可以忽略。
 */
export function localStats(lumaImage: Float32Array, width: number, height: number): RgbaImage {
  const sw = Math.max(1, Math.floor(width / 2));
  const sh = Math.max(1, Math.floor(height / 2));
  const small = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const x0 = Math.min(width - 1, x * 2);
      const y0 = Math.min(height - 1, y * 2);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      small[y * sw + x] =
        (lumaImage[y0 * width + x0]! +
          lumaImage[y0 * width + x1]! +
          lumaImage[y1 * width + x0]! +
          lumaImage[y1 * width + x1]!) /
        4;
    }
  }
  const W = sw + 1;
  const sum = new Float64Array(W * (sh + 1));
  const sq = new Float64Array(W * (sh + 1));
  for (let y = 0; y < sh; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < sw; x++) {
      const v = small[y * sw + x]!;
      rs += v;
      rq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1]! + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1]! + rq;
    }
  }
  const half = Math.max(3, Math.round((Math.max(sw, sh) * SAUVOLA_WINDOW_SHARE) / 2));
  const out = new Uint8Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const ya = Math.max(0, y - half);
    const yb = Math.min(sh, y + half + 1);
    for (let x = 0; x < sw; x++) {
      const xa = Math.max(0, x - half);
      const xb = Math.min(sw, x + half + 1);
      const area = (yb - ya) * (xb - xa);
      const s = sum[yb * W + xb]! - sum[ya * W + xb]! - sum[yb * W + xa]! + sum[ya * W + xa]!;
      const q = sq[yb * W + xb]! - sq[ya * W + xb]! - sq[yb * W + xa]! + sq[ya * W + xa]!;
      const mean = s / area;
      const sd = Math.sqrt(Math.max(0, q / area - mean * mean));
      const o = (y * sw + x) * 4;
      out[o] = Math.round(clamp(mean, 0, 1) * 255);
      out[o + 1] = Math.round(clamp(sd * 2, 0, 1) * 255);
      out[o + 3] = 255;
    }
  }
  return { width: sw, height: sh, data: out };
}

/** Sauvola 阈值（墨水深浅都是 0–1，R = 0.5）：低于它的是黑。着色器里是同一个公式。 */
export function sauvolaThreshold(mean: number, sd: number, k = SAUVOLA_K): number {
  return mean * (1 + k * (sd / 0.5 - 1));
}

/** 从缩小的分析图算出整页的增强参数。 */
export function planScanEnhance(image: RgbaImage, look: ScanLook): ScanPlan {
  const background = estimateBackground(image);
  const normalized = normalizeByBackground(image, background);
  const { lo, hi } = levelsOf(normalized);
  const leveled = leveledLuma(normalized, lo, hi);
  const skew = findSkew(leveled, image.width, image.height);
  const output: ScanOutput =
    look === 'bw'
      ? 'bw'
      : look === 'gray'
        ? 'gray'
        : looksColored(normalized, image.width, image.height, lo, hi)
          ? 'color'
          : 'gray';
  const stats =
    output === 'bw' ? localStats(leveledInk(normalized, lo, hi), image.width, image.height) : null;
  return { output, background, lo, hi, skew, stats };
}

/**
 * 黑白页去噪点（全分辨率，RGBA，R < 128 算黑）：8 连通的小黑块（宽和高都不超过 maxSide），
 * 如果 reach 像素内没有别的大块（字），就涂白；挨着字的小点（i 的点、句号）保留。返回去掉了几个。
 */
export function despeckle(
  image: RgbaImage,
  { maxSide, reach }: { maxSide: number; reach: number },
): number {
  const { width, height, data } = image;
  const labels = new Int32Array(width * height);
  // 并查集（0 号不用）。
  let parent = new Int32Array(1024);
  let next = 1;
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (data[p * 4]! >= 128) continue;
      let label = 0;
      const look = (q: number) => {
        const l = labels[q]!;
        if (l === 0) return;
        if (label === 0) label = l;
        else if (l !== label) union(label, l);
      };
      if (x > 0) look(p - 1);
      if (y > 0) {
        if (x > 0) look(p - width - 1);
        look(p - width);
        if (x < width - 1) look(p - width + 1);
      }
      if (label === 0) {
        if (next >= parent.length) {
          const grown = new Int32Array(parent.length * 2);
          grown.set(parent);
          parent = grown;
        }
        parent[next] = next;
        label = next++;
      }
      labels[p] = label;
    }
  }
  const count = next;
  const minX = new Int32Array(count).fill(width);
  const minY = new Int32Array(count).fill(height);
  const maxX = new Int32Array(count).fill(-1);
  const maxY = new Int32Array(count).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (labels[p] === 0) continue;
      const r = find(labels[p]!);
      labels[p] = r;
      if (x < minX[r]!) minX[r] = x;
      if (x > maxX[r]!) maxX[r] = x;
      if (y < minY[r]!) minY[r] = y;
      if (y > maxY[r]!) maxY[r] = y;
    }
  }
  const small = (r: number) => maxX[r]! - minX[r]! < maxSide && maxY[r]! - minY[r]! < maxSide;
  let removed = 0;
  for (let r = 1; r < count; r++) {
    if (parent[r] !== r || maxX[r]! < 0 || !small(r)) continue;
    const x0 = Math.max(0, minX[r]! - reach);
    const x1 = Math.min(width - 1, maxX[r]! + reach);
    const y0 = Math.max(0, minY[r]! - reach);
    const y1 = Math.min(height - 1, maxY[r]! + reach);
    let near = false;
    for (let y = y0; y <= y1 && !near; y++) {
      for (let x = x0; x <= x1; x++) {
        const l = labels[y * width + x]!;
        if (l !== 0 && l !== r && !small(l)) {
          near = true;
          break;
        }
      }
    }
    if (near) continue;
    for (let y = minY[r]!; y <= maxY[r]!; y++) {
      for (let x = minX[r]!; x <= maxX[r]!; x++) {
        const p = y * width + x;
        if (labels[p] === r) {
          data[p * 4] = 255;
          data[p * 4 + 1] = 255;
          data[p * 4 + 2] = 255;
        }
      }
    }
    removed++;
  }
  return removed;
}

/**
 * 在增强前的图上识别出的框，换算到增强后的图上（D-267）：增强时先缩放到 base，
 * 再以中心转 -skew 度、放进 canvas 中间（和 Skia 里画的顺序一样）。转的角度很小，框只移动中心、宽高照旧。
 */
export function boxesToEnhanced<T extends { x: number; y: number; width: number; height: number }>(
  boxes: readonly T[],
  from: Size,
  base: Size,
  skew: number,
  canvas: Size,
): T[] {
  const kx = base.width / from.width;
  const ky = base.height / from.height;
  const a = (-skew * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return boxes.map((box) => {
    const w = box.width * kx;
    const h = box.height * ky;
    const cx = (box.x + box.width / 2) * kx - base.width / 2;
    const cy = (box.y + box.height / 2) * ky - base.height / 2;
    const x = cx * cos - cy * sin + canvas.width / 2;
    const y = cx * sin + cy * cos + canvas.height / 2;
    return { ...box, x: x - w / 2, y: y - h / 2, width: w, height: h };
  });
}
