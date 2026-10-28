// 扫描件去阴影、拉平光照（D-266）：经典做法，不用模型。
// 1. 整页缩到长边 PAPER_SIDE，在小图上估出「纸张背景」（这一处的纸在当前光照下是什么颜色）：
//    逐通道先取最大值再取最小值（闭运算，去掉比半径细的字迹和线条，保留大块区域的边），再中值去噪。
//    缩小时按面积平均（mipmap），噪点已经很小，所以中值只用可分离的 3 点。
// 2. 只有和最亮的纸「平缓相连」、颜色也和纸一样的地方才当作纸：从最亮的纸出发向外长，
//    相邻两格的亮度和颜色变化都很小才往前走。阴影和光照渐变是平缓的，能走到；
//    照片、色块、大印章的边是陡的（颜色也不同），走不进去，它们的背景用周围的纸补上（拉推插值）。
// 3. 原图逐像素除以背景（背景图在小尺寸上算，按原尺寸双线性放大套用，手机上用 Skia 着色器），
//    纸变成白色、手影和暖色光被去掉；照片和印章只按周围纸张的光照校正，颜色保留。最后拉对比度。
// 这里是纯算法（Node 里直接测）：`paperBackground` 在 App 里跑在小图上，`enhancePixels` 是着色器
// `ENHANCE_SKSL` 的同一套公式，测试用它比较效果，并在 CanvasKit 里核对着色器和它一致。

/** 估背景用的小图长边：A4 页面上一个正文字约 2 px，阴影的过渡有十几 px。 */
export const PAPER_SIDE = 192;
/** 闭运算半径（小图像素）：比正文和标题的笔画粗，比阴影的过渡细。 */
const CLOSE_RADIUS = 2;
/** 相邻两格亮度差超过纸张亮度的这个比例，就不当作同一张纸（阴影边缘比这平缓）。 */
const STEP_LIGHT = 0.07;
/** 相邻两格的色度（r、g、b 各占的比例）差超过这个值，就不当作同一张纸。 */
const STEP_CHROMA = 0.025;
/** 色度和最亮的纸差这么多就不是纸（彩色照片、印章、色块）；暖色光整页偏色时整页一起偏，差得不多。 */
const PAPER_CHROMA = 0.06;
/** 比最亮的纸暗这么多倍就不是纸（桌面、很深的阴影）。 */
const MIN_PAPER_LIGHT = 0.3;
/** 能当作纸的面积少于这个比例时不去阴影（整张照片、白板以外的东西），只拉对比度。 */
const MIN_PAPER_SHARE = 0.15;

export type EnhanceLook = 'auto' | 'gray' | 'bw';

export interface PaperBackground {
  width: number;
  height: number;
  /** RGBA 8 位，alpha 255。 */
  data: Uint8Array;
  /** 哪里是纸（RGBA 8 位，三个通道一样，255 = 纸，0 = 照片、印章等）：纸上拉满色阶，别处只校正光照。 */
  paper: Uint8Array;
  /** 当作纸张的面积比例（0–1）；为 0 时背景是整页一个颜色，没有去阴影。 */
  paperShare: number;
}

type Channels = [Float32Array, Float32Array, Float32Array];

// 下面的循环都写成按下标走的平铺循环（不用闭包和临时数组）：Hermes 没有 JIT，小图上几十毫秒。

/**
 * 沿一个方向的滑动最大 / 最小值（窗口 2r+1，边缘截断）。lines 条线，每条 len 个，线首相隔 gap，线内相隔 step。
 * 用倍增：先求长度 1、2、4… 的区间最值，窗口 = 两段重叠的 2^k 区间，每个元素只比较几次，和 r 无关。
 */
function slide(
  src: Float32Array,
  r: number,
  max: boolean,
  lines: number,
  len: number,
  gap: number,
  step: number,
) {
  const out = new Float32Array(src.length);
  const size = 2 * r + 1;
  let span = 1;
  while (span * 2 <= size) span *= 2;
  // 线两头各补 r 个边缘值（对最值来说和截断一样）。
  const padded = len + 2 * r;
  let a = new Float32Array(padded);
  let b = new Float32Array(padded);
  for (let j = 0; j < lines; j++) {
    const base = j * gap;
    for (let i = 0; i < padded; i++) {
      const at = i - r < 0 ? 0 : i - r > len - 1 ? len - 1 : i - r;
      a[i] = src[base + at * step]!;
    }
    // a[i] = 从 i 起长度 have 的区间最值。
    for (let have = 1; have < span; have *= 2) {
      for (let i = 0; i + have < padded; i++) {
        const x = a[i]!;
        const y = a[i + have]!;
        b[i] = max ? (x > y ? x : y) : x < y ? x : y;
      }
      const t = a;
      a = b;
      b = t;
    }
    for (let i = 0; i < len; i++) {
      const x = a[i]!;
      const y = a[i + size - span]!;
      out[base + i * step] = max ? (x > y ? x : y) : x < y ? x : y;
    }
  }
  return out;
}

function morph(src: Float32Array, w: number, h: number, r: number, max: boolean) {
  return slide(slide(src, r, max, h, w, w, 1), r, max, w, h, 1, w);
}

/** 3 点中值，先横后竖（可分离的近似 3×3 中值，边缘复制）：去掉闭运算留下的单个亮点、暗点。 */
function median3(src: Float32Array, w: number, h: number) {
  const pass = (a: Float32Array, lines: number, len: number, gap: number, step: number) => {
    const out = new Float32Array(a.length);
    for (let j = 0; j < lines; j++) {
      const base = j * gap;
      for (let i = 0; i < len; i++) {
        const x = a[base + (i > 0 ? i - 1 : 0) * step]!;
        const y = a[base + i * step]!;
        const z = a[base + (i < len - 1 ? i + 1 : i) * step]!;
        // 三个数的中间值。
        out[base + i * step] = x > y ? (y > z ? y : x > z ? z : x) : x > z ? x : y > z ? z : y;
      }
    }
    return out;
  };
  return pass(pass(src, h, w, w, 1), w, h, 1, w);
}

/** 方框模糊（半径 r，边缘截断取平均），滑动求和。 */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const pass = (a: Float32Array, lines: number, len: number, gap: number, step: number) => {
    const out = new Float32Array(a.length);
    for (let j = 0; j < lines; j++) {
      const base = j * gap;
      let sum = 0;
      let count = 0;
      for (let k = 0; k <= r && k < len; k++) {
        sum += a[base + k * step]!;
        count++;
      }
      for (let i = 0; i < len; i++) {
        out[base + i * step] = sum / count;
        if (i + r + 1 < len) {
          sum += a[base + (i + r + 1) * step]!;
          count++;
        }
        if (i - r >= 0) {
          sum -= a[base + (i - r) * step]!;
          count--;
        }
      }
    }
    return out;
  };
  return pass(pass(src, h, w, w, 1), w, h, 1, w);
}

/** 拉推插值：weight 为 0 的格子用周围有值的格子补（逐级减半取加权和，再逐级放回）。 */
function pullPush(values: Channels, weight: Float32Array, w: number, h: number): Channels {
  type Level = { w: number; h: number; v: Channels; k: Float32Array };
  const first: Channels = [
    new Float32Array(w * h),
    new Float32Array(w * h),
    new Float32Array(w * h),
  ];
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) first[c]![i] = values[c]![i]! * weight[i]!;
  }
  const levels: Level[] = [{ w, h, v: first, k: weight }];
  let f = levels[0]!;
  while (f.w > 1 || f.h > 1) {
    const cw = Math.ceil(f.w / 2);
    const ch = Math.ceil(f.h / 2);
    const v: Channels = [
      new Float32Array(cw * ch),
      new Float32Array(cw * ch),
      new Float32Array(cw * ch),
    ];
    const k = new Float32Array(cw * ch);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const c = (y >> 1) * cw + (x >> 1);
        const s = y * f.w + x;
        k[c]! += f.k[s]!;
        v[0][c]! += f.v[0][s]!;
        v[1][c]! += f.v[1][s]!;
        v[2][c]! += f.v[2][s]!;
      }
    }
    f = { w: cw, h: ch, v, k };
    levels.push(f);
  }
  // 从最粗的一级往回放：权重不足 1 的格子按比例混入上一级的值。
  let coarse: Channels = [new Float32Array(1), new Float32Array(1), new Float32Array(1)];
  for (let c = 0; c < 3; c++) coarse[c]![0] = f.k[0]! > 0 ? f.v[c]![0]! / f.k[0]! : 1;
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l]!;
    const cw = levels[l + 1]!.w;
    const chh = levels[l + 1]!.h;
    const size = fine.w * fine.h;
    const next: Channels = [new Float32Array(size), new Float32Array(size), new Float32Array(size)];
    for (let y = 0; y < fine.h; y++) {
      // 上一级按像素中心双线性取值（最近邻会补出一块块的方格）。
      const fy = Math.min(chh - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(fy);
      const y1 = y0 + 1 < chh ? y0 + 1 : y0;
      const ty = fy - y0;
      for (let x = 0; x < fine.w; x++) {
        const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx);
        const x1 = x0 + 1 < cw ? x0 + 1 : x0;
        const tx = fx - x0;
        const s = y * fine.w + x;
        const weightHere = fine.k[s]!;
        const k = weightHere < 1 ? weightHere : 1;
        for (let i = 0; i < 3; i++) {
          const c = coarse[i]!;
          const up = c[y0 * cw + x0]! * (1 - tx) + c[y0 * cw + x1]! * tx;
          const down = c[y1 * cw + x0]! * (1 - tx) + c[y1 * cw + x1]! * tx;
          const own = weightHere > 0 ? fine.v[i]![s]! / weightHere : 0;
          next[i]![s] = own * k + (up * (1 - ty) + down * ty) * (1 - k);
        }
      }
    }
    coarse = next;
  }
  return coarse;
}

function percentile(values: Float32Array, p: number) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

const lightOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * 在小图（RGBA，长边约 PAPER_SIDE）上估出纸张背景。返回同样大小的背景图，
 * 原图每个像素除以对应位置（双线性放大）的背景，纸就是白的。
 */
export function paperBackground(rgba: Uint8Array, width: number, height: number): PaperBackground {
  const w = width;
  const h = height;
  const n = w * h;
  const src: Channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) src[c]![i] = rgba[i * 4 + c]! / 255;
  }
  // 闭运算 + 中值：去掉字迹，留下纸（和大块的照片、色块）。
  const bg = src.map((ch) =>
    median3(morph(morph(ch, w, h, CLOSE_RADIUS, true), w, h, CLOSE_RADIUS, false), w, h),
  ) as Channels;
  const light = new Float32Array(n);
  const chroma: Channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const r = bg[0][i]!;
    const g = bg[1][i]!;
    const b = bg[2][i]!;
    light[i] = lightOf(r, g, b);
    const sum = r + g + b || 1;
    chroma[0][i] = r / sum;
    chroma[1][i] = g / sum;
    chroma[2][i] = b / sum;
  }
  // 最亮的纸：亮度前 5% 的平均颜色。
  const top = percentile(light, 0.95);
  const ref = [0, 0, 0];
  let refCount = 0;
  for (let i = 0; i < n; i++) {
    if (light[i]! < top) continue;
    for (let c = 0; c < 3; c++) ref[c]! += chroma[c]![i]!;
    refCount++;
  }
  for (let c = 0; c < 3; c++) ref[c] = ref[c]! / Math.max(1, refCount);
  const [cr, cg, cb] = chroma;
  const [rr, rg, rb] = ref as [number, number, number];
  const minLight = top * MIN_PAPER_LIGHT;
  const step = top * STEP_LIGHT;
  // 像纸：够亮，色度和最亮的纸差不多。
  const paperLike = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    paperLike[i] =
      light[i]! >= minLight &&
      Math.abs(cr[i]! - rr) <= PAPER_CHROMA &&
      Math.abs(cg[i]! - rg) <= PAPER_CHROMA &&
      Math.abs(cb[i]! - rb) <= PAPER_CHROMA
        ? 1
        : 0;
  }
  // 从最亮的纸出发，平缓地往外长。
  const paper = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (paperLike[i] && light[i]! >= top * 0.92) {
      paper[i] = 1;
      queue[tail++] = i;
    }
  }
  const visit = (i: number, j: number) => {
    if (paper[j] || !paperLike[j]) return;
    if (Math.abs(light[j]! - light[i]!) > step) return;
    if (
      Math.abs(cr[j]! - cr[i]!) > STEP_CHROMA ||
      Math.abs(cg[j]! - cg[i]!) > STEP_CHROMA ||
      Math.abs(cb[j]! - cb[i]!) > STEP_CHROMA
    ) {
      return;
    }
    paper[j] = 1;
    queue[tail++] = j;
  };
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    if (x > 0) visit(i, i - 1);
    if (x < w - 1) visit(i, i + 1);
    if (i >= w) visit(i, i - w);
    if (i + w < n) visit(i, i + w);
  }
  const paperShare = tail / n;
  const data = new Uint8Array(n * 4);
  if (paperShare < MIN_PAPER_SHARE) {
    // 看起来不是一张纸：背景取整页最亮的颜色，只拉对比度，不去阴影。
    const white = [0, 0, 0];
    for (let c = 0; c < 3; c++) white[c] = percentile(bg[c]!, 0.95);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(white[c]! * 255);
      data[i * 4 + 3] = 255;
    }
    return { width: w, height: h, data, paper: new Uint8Array(n * 4).fill(255), paperShare: 0 };
  }
  // 不是纸的地方用周围的纸补上，再轻轻模糊，免得补的地方和纸接缝。
  const filled = pullPush(bg, paper, w, h).map((ch) => boxBlur(ch, w, h, 2)) as Channels;
  const soft = boxBlur(paper, w, h, 1);
  const mask = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, filled[c]![i]!)) * 255);
      mask[i * 4 + c] = Math.round(soft[i]! * 255);
    }
    data[i * 4 + 3] = 255;
    mask[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data, paper: mask, paperShare };
}

// 除以背景之后的色阶：纸（≈1）推到纯白，字迹压深。三种效果的数值和着色器里的一样。
// 自动和灰度只在纸上拉满色阶；照片、印章这些地方只除以背景（校正光照），不再拉，免得浅色被拉成白。
const LEVELS = {
  auto: { black: 0.1, white: 0.88 },
  gray: { black: 0.1, white: 0.86 },
} as const;
/** 黑白：在这两个值之间从黑过渡到白（纸已经是 1，所以一个全局阈值就够了）。 */
const BW_EDGE = [0.58, 0.72] as const;
/** 背景的下限，避免除以很暗的背景把噪点放大。 */
const BG_FLOOR = 0.08;

/**
 * 扫描增强的着色器（Skia SkSL）：`image` 是原图，`background` 和 `paper` 是放大到同样大小的背景和纸张图。
 * `mode`：0 自动（保留颜色）、1 灰度、2 黑白。公式和 `enhancePixels` 完全一样。
 */
export const ENHANCE_SKSL = `
uniform shader image;
uniform shader background;
uniform shader paper;
uniform float mode;

float levels(float v, float black, float white) {
  return clamp((v - black) / (white - black), 0.0, 1.0);
}

half4 main(float2 p) {
  float3 c = image.eval(p).rgb;
  float3 b = max(background.eval(p).rgb, float3(${BG_FLOOR}));
  float3 f = min(c / b, float3(1.0));
  float m = paper.eval(p).r;
  float l = dot(f, float3(0.299, 0.587, 0.114));
  float3 o;
  if (mode < 0.5) {
    o = mix(f, float3(levels(f.r, ${LEVELS.auto.black}, ${LEVELS.auto.white}),
                      levels(f.g, ${LEVELS.auto.black}, ${LEVELS.auto.white}),
                      levels(f.b, ${LEVELS.auto.black}, ${LEVELS.auto.white})), m);
  } else if (mode < 1.5) {
    o = float3(mix(l, levels(l, ${LEVELS.gray.black}, ${LEVELS.gray.white}), m));
  } else {
    o = float3(smoothstep(${BW_EDGE[0]}, ${BW_EDGE[1]}, l));
  }
  return half4(half3(o), 1.0);
}
`;

export const ENHANCE_SHADER_MODE: Record<EnhanceLook, number> = { auto: 0, gray: 1, bw: 2 };

const levels = (v: number, black: number, white: number) =>
  Math.min(1, Math.max(0, (v - black) / (white - black)));
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 着色器的同一套公式（Node 里用）：原图 RGBA 除以双线性放大的背景，再按效果拉色阶（纸上拉满，别处不拉）。
 * 放大和 Skia 一样按像素中心对齐、边缘截断。
 */
export function enhancePixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  background: PaperBackground,
  mode: EnhanceLook,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const { width: bw, height: bh, data: bd, paper: pd } = background;
  const sx = bw / width;
  const sy = bh / height;
  const b = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const sample = (img: Uint8Array, c: number) => {
        const at = (xx: number, yy: number) => img[(yy * bw + xx) * 4 + c]! / 255;
        const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
        const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
        return top * (1 - ty) + bottom * ty;
      };
      for (let c = 0; c < 3; c++) b[c] = Math.max(BG_FLOOR, sample(bd, c));
      const m = sample(pd, 0);
      const i = (y * width + x) * 4;
      const f = [0, 1, 2].map((c) => Math.min(1, rgba[i + c]! / 255 / b[c]!));
      const l = lightOf(f[0]!, f[1]!, f[2]!);
      const mix = (a: number, z: number) => a * (1 - m) + z * m;
      let o: number[];
      if (mode === 'auto')
        o = f.map((v) => mix(v, levels(v, LEVELS.auto.black, LEVELS.auto.white)));
      else if (mode === 'gray')
        o = [0, 0, 0].fill(mix(l, levels(l, LEVELS.gray.black, LEVELS.gray.white)));
      else o = [0, 0, 0].fill(smoothstep(BW_EDGE[0], BW_EDGE[1], l));
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(o[c]! * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
